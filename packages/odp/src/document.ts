import { createHash, randomBytes } from 'node:crypto';
import {
  hasShapeOutline,
  isPresetPolygon,
  nativeFill,
  notesText,
  NEW_LINES,
  NEW_SHAPES,
  type FillLayer,
  type EditableElement,
  type EditableElementKind,
  type EditableSlide,
  type ElementFlip,
  type ElementTilt,
  type ImageCredit,
  type SlideOperation,
  type NotesParagraph,
  type NotesRun,
  type ShapeOutline,
  type SlideTransition,
} from '@slider/shared';
import { ODP_MIME, OTP_MIME, OdpArchive } from './archive';
import { framesShowing, readCredit, writeCredit } from './credit';
import { OdpError } from './errors';
import { imageSize } from './image-size';
import { boxOf, frameOf, moveBy, setFrame, type CmBox } from './geometry';
import { explainLive, graphicPropsOf, liveShapeOf, readLook } from './live';
import {
  blankText,
  newElement,
  newImageFrame,
  readLocked,
  writeLock,
  writeRichText,
  writeShapeStyle,
  type StyleSink,
} from './live-write';
import { renameStyleReferences, sameNode, styleReferencesOf } from './merge';
import { readFlip, writeFlip } from './flip';
import { readCornerRadius, writeCornerRadius } from './corners';
import { paintOf, picturePaintOf, sliderDash } from './paint';
import {
  ARROW_MARKER,
  arrowMarker,
  linePaintOf,
  placeLine,
  readHeads,
  readLineFlip,
} from './lines';
import {
  needsPictureSize,
  pictureCmSize,
  framePicture,
  readPicture,
  refitPicture,
  resetPicture,
  writePictureFit,
} from './image-fit';
import { readTiltMark, writeTiltMark } from './tilt';
import { readTransition, writeTransitionFilters, writeTransitionProperties } from './transition';
import {
  LOEXT_NS,
  SLIDER_NS,
  fillProperties,
  fillsMarkPictures,
  readFills,
  writeFillsMark,
} from './fills';
import { readNotesRich, writeNotesRich } from './notes';
import { placeholderPicture } from './placeholder';
import { StyleIndex, type Properties } from './styles';
import { inlineNodes, readParagraphs, writeParagraphs } from './text';
import { lengthToCm } from './units';
import {
  attr,
  attributeNames,
  buildPart,
  childrenOf,
  decode,
  descendants,
  element,
  elementChildren,
  findDescendant,
  firstChild,
  parentsOf,
  parsePart,
  removeAttr,
  removeChild,
  setAttr,
  tagOf,
  type XmlNode,
  type XmlPart,
} from './xml';

/**
 * How an element is drawn alone for the layers view (`toLayerBytes`): a point p (0–1 of the page)
 * where it lies is drawn at `scale · p + shift`.
 */
export interface LayerPlacement {
  scale: { x: number; y: number };
  shift: { x: number; y: number };
}

/** A box of an element's layer picture (drawn as `placement` says) back where the element lies. */
export const placedBox = (
  box: { x: number; y: number; w: number; h: number },
  { scale, shift }: LayerPlacement,
) => ({
  x: (box.x - shift.x) / scale.x,
  y: (box.y - shift.y) / scale.y,
  w: box.w / scale.x,
  h: box.h / scale.y,
});

/** Where a picture goes in the package: named by its content, so the same picture is there once. */
export function picturePath(bytes: Uint8Array, mediaType: string): string {
  const extension = IMAGE_EXTENSIONS[mediaType];
  if (!extension)
    throw new OdpError('operation', 'Dieses Bildformat geht nicht (PNG, JPEG, GIF, WebP).');
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  return `Pictures/${hash}.${extension}`;
}

/** An image for {@link OdpDocument.apply}'s `replaceImage`, measured by the caller. */
export interface OdpImage {
  bytes: Uint8Array;
  /** `image/png`, `image/jpeg`, `image/gif` or `image/webp`. */
  mediaType: string;
  width: number;
  height: number;
  /** A stock photo's credit, kept as the frame's description (see `credit.ts`). */
  credit?: ImageCredit | null;
}

/** A picture in the package, see {@link OdpDocument.pictures}. */
export interface OdpPicture {
  path: string;
  bytes: number;
  mediaType: string | null;
  /** Pixels, when the header tells (PNG, JPEG, GIF, WebP). */
  width: number | null;
  height: number | null;
  /** `slide n` and style names that refer to it. */
  usedBy: string[];
}

export interface OdpSlide extends EditableSlide {
  /** Text of the title placeholder, else the slide's name. */
  title: string;
  /** Changes whenever anything on the slide changes (see {@link OdpDocument.fingerprints}). */
  fingerprint: string;
  /** The page's `xml:id`, which stays with the slide when it moves (see {@link OdpDocument.ensureIds}). */
  pageId: string | null;
}

const SHAPE_TAGS = new Set([
  'draw:frame',
  'draw:g',
  'draw:custom-shape',
  'draw:rect',
  'draw:ellipse',
  'draw:circle',
  'draw:polygon',
  'draw:polyline',
  'draw:path',
  'draw:regular-polygon',
  'draw:caption',
  'draw:line',
  'draw:connector',
  'draw:measure',
  'draw:control',
  'dr3d:scene',
]);

/** Shapes that carry their text themselves (no `draw:text-box`). */
const TEXT_SHAPES = new Set([
  'draw:custom-shape',
  'draw:rect',
  'draw:ellipse',
  'draw:circle',
  'draw:polygon',
  'draw:polyline',
  'draw:path',
  'draw:regular-polygon',
  'draw:caption',
]);

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** Elements whose links are only followed on a click – they may go to the web or to mail. */
const KEEPS_EXTERNAL_LINK = new Set([
  'text:a',
  'draw:a',
  'office:event-listener',
  'presentation:event-listener',
]);
/**
 * A template's file to take layouts from in {@link OdpDocument.apply} (`addSlide` with a
 * `design`), its styles' pictures read ahead – see {@link OdpDocument.design}.
 */
export interface OdpDesign {
  readonly document: OdpDocument;
  readonly pictures: ReadonlyMap<string, { bytes: Uint8Array; mediaType: string }>;
}

/**
 * An element no longer in a file, as an earlier state of it had it – cut, or deleted after it was
 * copied – to copy back in (`copyElement`): that file, with the pictures the element and the
 * styles it names show read ahead ({@link OdpDocument.elementSource}).
 */
export interface OdpElementSource {
  readonly document: OdpDocument;
  readonly pictures: ReadonlyMap<string, { bytes: Uint8Array; mediaType: string }>;
}

/** A short name part made of what a node says, the same for the same node. */
const contentHash = (node: XmlNode): string =>
  createHash('sha256').update(xmlOf(node)).digest('hex').slice(0, 8);

/** Width / height that still counts as the same page shape (cm rounded in the files). */
const SAME_SHAPE = 0.01;

/** The parts of styles.xml in the order ODF gives them. */
const STYLES_ORDER = [
  'office:font-face-decls',
  'office:styles',
  'office:automatic-styles',
  'office:master-styles',
];

/** A master page of {@link OdpDocument.masterPages}. */
export interface OdpMasterPage {
  /** `style:name`, which a page names in `draw:master-page-name`. */
  name: string;
  /** The name LibreOffice shows, when it differs. */
  displayName: string | null;
  placeholders: {
    /** `picture`: where a picture goes – Slider's own mark on a layout designed in Slider. */
    kind: 'title' | 'subtitle' | 'outline' | 'picture';
    x: string;
    y: string;
    width: string;
    height: string;
    /** The common presentation style a page's placeholder of this kind takes, if there is one. */
    style: string | null;
    /**
     * Its own look over `style` – an automatic presentation style of styles.xml, which a layout
     * designed in Slider gives each placeholder after the first of its kind; `null`: none.
     */
    look: string | null;
    /** What it asks for, typed into it in Slider's template editor; `null`: not designed there. */
    prompt: string | null;
  }[];
}

/**
 * The placeholders a new slide of master page `master` gets. LibreOffice gives every master a
 * text frame, which a title master's subtitle stands for; a layout designed in Slider has just
 * the placeholders laid out on it, each of them.
 */
export function slidePlaceholders(master: OdpMasterPage): OdpMasterPage['placeholders'] {
  const designed = master.placeholders.some((frame) => frame.prompt !== null);
  const subtitled = master.placeholders.some((frame) => frame.kind === 'subtitle');
  return master.placeholders.filter(
    (frame) => designed || !(subtitled && frame.kind === 'outline'),
  );
}

/** What a placeholder of a layout designed in Slider holds. */
export type OdpPlaceholderKind = 'title' | 'subtitle' | 'outline' | 'picture';

/** A slide of a presentation to become a layout of a template ({@link OdpDocument.toTemplate}). */
export interface OdpTemplateLayout {
  pageId: string;
  /** What the layout is shown as. */
  name: string;
  /** The slide's elements that become placeholders, by element id. */
  placeholders: Readonly<Record<string, OdpPlaceholderKind>>;
  /** The layout's own guides – each layout has its own. */
  guides: readonly OdpGuide[];
}

/** A guide line across the page, `position` a fraction of its width or height. */
export interface OdpGuide {
  orientation: 'horizontal' | 'vertical';
  position: number;
}

/** A face of a font to embed for drawing (`embedFonts`). */
export interface EmbeddedFont {
  family: string;
  weight: 400 | 700;
  italic: boolean;
  format: 'ttf' | 'otf';
  bytes: Uint8Array;
}

/** A font file the document brings along (ODF's embedded fonts), under the family it is declared as. */
export interface OdpFontFile {
  family: string;
  path: string;
}

/** Embedded font files larger than this are not read (a whole CJK font is about 20 MB). */
const MAX_FONT_BYTES = 40 * 1024 * 1024;

/** Attributes naming a font family: in font declarations (`svg:`) and in styles (`fo:`, `style:`). */
const FONT_FAMILY_ATTRIBUTES = [
  'svg:font-family',
  'fo:font-family',
  'style:font-family-asian',
  'style:font-family-complex',
] as const;
const LINK_ELEMENTS_TO_DROP = new Set([
  'office:dde-source',
  'table:dde-link',
  'table:dde-links',
  'text:dde-connection-decl',
  'text:dde-connection-decls',
  'text:dde-connection',
  'office:scripts',
]);

/** An embedded object's own content or styles (`Object 1/content.xml`), not the file's. */
const isEmbeddedPart = (path: string): boolean =>
  path.includes('/') && !path.startsWith('META-INF/') && /\/(content|styles)\.xml$/.test(path);

/** A relative path inside the package – everything else is a link out. */
export const isPackagePath = (href: string): boolean =>
  // Blanks or control characters around it could hide a scheme (" http://…") – a link out then.
  href.trim() === href &&
  !(href.charCodeAt(0) < 32 || href.charCodeAt(href.length - 1) < 32) &&
  !/^[a-z][a-z0-9+.-]*:/i.test(href) &&
  !href.startsWith('/') &&
  !href.startsWith('\\') &&
  !href.replace(/\\/g, '/').split('/').includes('..');

/** Attributes that point at a shape by its `xml:id` or `draw:id`. */
const ID_REFERENCES = ['smil:targetElement', 'draw:start-shape', 'draw:end-shape'] as const;

const PICTURE_REF = /Pictures\/[^"'<>\s)&]+/g;
/** Every `xlink:href` of a part, as written (entities still encoded). */
const HREF = /xlink:href="([^"]*)"/g;

/**
 * The package's pictures XML shows: whatever reads as a path into `Pictures/`, and every
 * `xlink:href` there with its entities decoded – a name with `&` in it (`&amp;` in the XML) is
 * only found by the latter.
 */
function picturePathsIn(...xml: readonly string[]): Set<string> {
  const paths = new Set<string>();
  for (const part of xml) {
    for (const match of part.matchAll(PICTURE_REF)) paths.add(match[0]);
    for (const match of part.matchAll(HREF)) {
      const href = decode(match[1] as string);
      if (href.startsWith('Pictures/')) paths.add(href);
    }
  }
  return paths;
}
/** Pictures larger than this are listed but not read (shown, measured). */
const MAX_PICTURE_BYTES = 20 * 1024 * 1024;

/** A picture of the package (`Pictures/…`), `null` for any other part or one too large. */
async function pictureIn(archive: OdpArchive, path: string): Promise<Uint8Array | null> {
  if (!path.startsWith('Pictures/') || !isPackagePath(path) || !archive.has(path)) return null;
  if (archive.size(path) > MAX_PICTURE_BYTES) return null;
  return archive.readBinary(path, MAX_PICTURE_BYTES);
}
/** XML shown around a search hit, on each side. */
const SEARCH_CONTEXT = 120;

/** XML written from outside loses these too: events, embedded data, plug-ins. */
const AUTHORED_ELEMENTS_TO_DROP = new Set([
  ...LINK_ELEMENTS_TO_DROP,
  'office:event-listeners',
  'office:binary-data',
  'draw:plugin',
  'draw:applet',
  'draw:floating-frame',
]);
/** Hyperlinks written from outside may only go to the web or to mail. */
const SAFE_LINK = /^(https?:|mailto:)/i;

/** Named things of the design, not of a slide: a slide's styles never bring them along. */
const NOT_SLIDE_STYLES = new Set(['style:master-page', 'style:page-layout']);

/** Styles written from outside that go to content.xml's automatic styles (and `number:*`). */
/** What a style's own attributes say that is not its identity: taken over from a parent. */
const STYLE_IDENTITY = new Set([
  'style:name',
  'style:display-name',
  'style:family',
  'style:parent-style-name',
]);

/**
 * Takes the properties of `style`'s parents among the automatic styles into it, nearest first,
 * under its own: LibreOffice ignores such a parent (only common styles can be parents), so the
 * style would be drawn without what it was meant to inherit. Its parent becomes the first common
 * one up the line, or none.
 */
function inheritAutomaticParents(
  style: XmlNode,
  automaticOf: (family: string, name: string) => XmlNode | undefined,
  isCommon: (family: string, name: string) => boolean,
): void {
  const family = attr(style, 'style:family') ?? '';
  const seen = new Set<XmlNode>([style]);
  for (;;) {
    const name = attr(style, 'style:parent-style-name');
    if (!name || isCommon(family, name)) return;
    const parent = automaticOf(family, name);
    if (!parent || seen.has(parent)) {
      removeAttr(style, 'style:parent-style-name');
      return;
    }
    seen.add(parent);
    for (const key of attributeNames(parent)) {
      if (!STYLE_IDENTITY.has(key) && attr(style, key) === undefined) {
        setAttr(style, key, attr(parent, key) ?? '');
      }
    }
    for (const properties of elementChildren(parent)) {
      const tag = tagOf(properties) ?? '';
      const own = firstChild(style, tag);
      if (!own) {
        childrenOf(style).push(structuredClone(properties));
        continue;
      }
      for (const key of attributeNames(properties)) {
        if (attr(own, key) === undefined) setAttr(own, key, attr(properties, key) ?? '');
      }
      for (const inner of elementChildren(properties)) {
        if (!firstChild(own, tagOf(inner) ?? '')) childrenOf(own).push(structuredClone(inner));
      }
    }
    const next = attr(parent, 'style:parent-style-name');
    if (next) setAttr(style, 'style:parent-style-name', next);
    else removeAttr(style, 'style:parent-style-name');
  }
}

const AUTOMATIC_STYLE_TAGS = new Set(['style:style', 'text:list-style']);
/** … and those that go to styles.xml's common styles – every named kind ODF has there. */
const COMMON_STYLE_TAGS = new Set([
  'draw:gradient',
  'draw:hatch',
  'draw:marker',
  'draw:stroke-dash',
  'draw:opacity',
  // A picture filling a shape – how a photo gets rounded corners or a circle.
  'draw:fill-image',
  'svg:linearGradient',
  'svg:radialGradient',
  'style:presentation-page-layout',
]);

const isStyleReference = (name: string): boolean =>
  name.endsWith('style-name') ||
  name === 'draw:master-page-name' ||
  name === 'presentation:presentation-page-layout-name';

/** Every style, master page and page layout name used in `root`. */
function styleReferences(root: XmlNode): string[] {
  return [root, ...descendants(root)].flatMap((node) =>
    attributeNames(node)
      .filter(isStyleReference)
      .map((name) => attr(node, name) ?? '')
      .filter(Boolean),
  );
}

/** Between a named thing's kind and its name in a {@link styleKey}. */
const KEY_SEPARATOR = '\u0000';

/** The gradients ODF has: `draw:fill-gradient-name` may name either kind. */
const GRADIENT_TAGS = new Set(['draw:gradient', 'svg:linearGradient', 'svg:radialGradient']);

/**
 * What kind of named thing a node is, as references tell them apart: a style by its family
 * (`style:paragraph`, `style:graphic`, …), a number style as one kind whatever it formats, a
 * gradient as one kind of either notation, anything else by its element.
 */
function styleKind(node: XmlNode): string | null {
  const tag = tagOf(node);
  if (!tag) return null;
  if (tag === 'style:style') return `style:${attr(node, 'style:family') ?? ''}`;
  if (tag.startsWith('number:')) return 'number';
  if (GRADIENT_TAGS.has(tag)) return 'gradient';
  return tag;
}

/** A named thing of the styles as a reference finds it – its kind and name – or `null`. */
function styleKey(node: XmlNode): string | null {
  const kind = styleKind(node);
  const name = attr(node, 'style:name') ?? attr(node, 'draw:name');
  return kind && name ? `${kind}${KEY_SEPARATOR}${name}` : null;
}

/** The keys ({@link styleKey}) of the styles in `container`. */
function styleKeysIn(container: XmlNode | undefined): string[] {
  return (container ? elementChildren(container) : []).flatMap((node) => {
    const key = styleKey(node);
    return key ? [key] : [];
  });
}

/** The style family `text:style-name` names, by the element it is on. */
const TEXT_STYLE_FAMILY: Record<string, string> = {
  'text:p': 'style:paragraph',
  'text:h': 'style:paragraph',
  'text:list': 'text:list-style',
  'text:numbered-paragraph': 'text:list-style',
  'text:span': 'style:text',
  'text:a': 'style:text',
  'text:ruby-text': 'style:text',
  'text:list-level-style-number': 'style:text',
  'text:list-level-style-bullet': 'style:text',
  'text:list-level-style-image': 'style:text',
  'text:outline-level-style': 'style:text',
};

/**
 * The kinds ({@link styleKind}) of what attribute `attribute` of `node` names: `[]` for names a
 * slide's styles never bring along (master pages, page layouts, font declarations), `null` for
 * an attribute this does not know – then whatever has that name. `family` is the family of the
 * style `node` is part of: a parent, next or conditional style is one of the same family.
 */
function referencedKinds(
  node: XmlNode,
  attribute: string,
  family: string | undefined,
): readonly string[] | null {
  const tag = tagOf(node) ?? '';
  if (attribute.startsWith('style:font-name')) return [];
  switch (attribute) {
    case 'draw:master-page-name':
    case 'style:master-page-name':
    case 'style:page-layout-name':
      return [];
    case 'presentation:presentation-page-layout-name':
      return ['style:presentation-page-layout'];
    case 'style:parent-style-name':
    case 'style:next-style-name':
    case 'style:apply-style-name':
      return family === undefined ? null : [`style:${family}`];
    case 'style:list-style-name':
    case 'text:style-override':
      return ['text:list-style'];
    case 'style:data-style-name':
    case 'style:percentage-data-style-name':
      return ['number'];
    case 'draw:fill-gradient-name':
      return ['gradient'];
    case 'draw:opacity-name':
      return ['draw:opacity'];
    case 'draw:fill-hatch-name':
      return ['draw:hatch'];
    case 'draw:fill-image-name':
      return ['draw:fill-image'];
    case 'draw:marker-start':
    case 'draw:marker-end':
      return ['draw:marker'];
    case 'draw:stroke-dash':
    case 'draw:stroke-dash-names':
      return ['draw:stroke-dash'];
    case 'draw:style-name':
      return [tag === 'draw:page' ? 'style:drawing-page' : 'style:graphic'];
    case 'presentation:style-name':
      return [tag === 'draw:page' ? 'style:drawing-page' : 'style:presentation'];
    case 'draw:text-style-name':
    case 'text:cond-style-name':
      return ['style:paragraph'];
    case 'text:visited-style-name':
      return ['style:text'];
    case 'text:style-name': {
      const kind = TEXT_STYLE_FAMILY[tag];
      return kind ? [kind] : null;
    }
    case 'table:style-name':
      return tag.startsWith('table:') ? [`style:${tag.slice('table:'.length)}`] : null;
    case 'table:default-cell-style-name':
      return ['style:table-cell'];
    case 'chart:style-name':
      return ['style:chart'];
    default:
      return null;
  }
}

/** A family name as written, without the quotes around one with spaces. */
const unquoteFamily = (value: string): string => value.replace(/^\s*['"]|['"]\s*$/g, '').trim();

/** Nodes as XML, without a declaration. */
const xmlOf = (...nodes: XmlNode[]): string => buildPart({ declaration: '', nodes });

/**
 * A hash over a page's XML without our element ids (they differ between saves) – and without what
 * is not drawn: its speaker notes and whose variant it is.
 */
const pageHash = (page: XmlNode, ...also: string[]): string => {
  const xml = xmlOf(page)
    .replace(/ xml:id="[^"]*"/g, '')
    .replace(/ slider:variant-of="[^"]*"/g, '')
    .replace(
      /<presentation:notes\b[^>]*\/>|<presentation:notes\b[\s\S]*?<\/presentation:notes>/g,
      '',
    );
  const hash = createHash('sha256').update(xml);
  for (const more of also) hash.update(more);
  return hash.digest('hex').slice(0, 32);
};

/**
 * A page's (or group's) children without `node` and every shape over it – also for `node` in a
 * group, at any depth: the groups holding it keep only their parts under it (copies; the page's
 * nodes are not changed). `null` when `node` is not among them.
 */
const withoutElementIn = (children: XmlNode[], node: XmlNode): XmlNode[] | null => {
  for (let at = 0; at < children.length; at += 1) {
    const child = children[at] as XmlNode;
    let kept: XmlNode[];
    if (child === node) kept = [];
    else {
      const tag = tagOf(child);
      if (tag !== 'draw:g') continue;
      const inner = withoutElementIn(childrenOf(child), node);
      if (!inner) continue;
      // A group with nothing left under it draws nothing: left out (grouping changes nothing).
      kept = inner.some((part) => SHAPE_TAGS.has(tagOf(part) ?? ''))
        ? [{ ...child, [tag]: inner }]
        : [];
    }
    return [
      ...children.slice(0, at),
      ...kept,
      ...children.slice(at + 1).filter((over) => !tagOf(over)?.startsWith('draw:')),
    ];
  }
  return null;
};

/** A page's children without `node` (also one in a group) and every shape over it. */
const withoutElement = (children: XmlNode[], node: XmlNode): XmlNode[] =>
  withoutElementIn(children, node) ?? children;

/** Slider's mark of a shape's fill layers (`fills.ts`). */
const MARK_ATTR = 'slider:fills';

/** An element whose fill is to be baked anew for its backdrop blur ({@link OdpDocument.backdropWork}). */
export interface BackdropWork {
  elementId: string;
  pageIndex: number;
  /** Points; 0: none any more – its picture of the layers alone. */
  radius: number;
  source: string;
  /** Fingerprint of the slide under it alone (`''` for `radius` 0). */
  backdrop: string;
  /** Unturned, in cm; `rotation` clockwise in degrees about its centre. */
  box: CmBox;
  rotation: number;
  flip: ElementFlip;
  fills: FillLayer[];
}

/** The frame of a notes page that holds the speaker notes. */
const notesFrameOf = (notes: XmlNode): XmlNode | undefined =>
  elementChildren(notes).find(
    (node) => tagOf(node) === 'draw:frame' && attr(node, 'presentation:class') === 'notes',
  );

/** A page's speaker notes as plain text, a paragraph per line. */
/** The text box of a page's notes frame, if it has one. */
function notesBoxOf(page: XmlNode): XmlNode | undefined {
  const notes = firstChild(page, 'presentation:notes');
  const frame = notes && notesFrameOf(notes);
  return frame ? firstChild(frame, 'draw:text-box') : undefined;
}

function notesOf(page: XmlNode): string {
  const box = notesBoxOf(page);
  return box ? readParagraphs(box).join('\n').replace(/\s+$/, '') : '';
}

/**
 * Formatted notes as `readNotesRich` gives them back: runs merged, plain looks left out, no
 * trailing empty paragraphs.
 */
function trimNotes(paragraphs: readonly NotesParagraph[]): NotesParagraph[] {
  const out = paragraphs.map((paragraph) => {
    const runs: NotesRun[] = [];
    for (const run of paragraph.runs) {
      if (!run.text) continue;
      const looks = {
        ...(run.bold && { bold: true }),
        ...(run.italic && { italic: true }),
        ...(run.underline && { underline: true }),
        ...(run.strike && { strike: true }),
      };
      const last = runs.at(-1);
      if (last && JSON.stringify({ ...last, text: '' }) === JSON.stringify({ text: '', ...looks }))
        last.text += run.text;
      else runs.push({ text: run.text, ...looks });
    }
    return paragraph.list ? { runs, list: paragraph.list } : { runs };
  });
  while (out.length > 0 && !out.at(-1)!.list && out.at(-1)!.runs.every((run) => !run.text.trim()))
    out.pop();
  return out;
}

/** A box given relative to the slide (0–1), in cm. */
const toCm = (box: CmBox, size: { width: number; height: number }): CmBox => ({
  x: box.x * size.width,
  y: box.y * size.height,
  w: box.w * size.width,
  h: box.h * size.height,
});

/** The largest box of the picture's proportions that fits into `box`, centred in it. */
function fitted(box: CmBox, image: { width: number; height: number }): CmBox {
  const scale = Math.min(box.w / image.width, box.h / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/** An operation that does not fit the deck (as opposed to a file that cannot be read, a bug). */
const isMisfit = (error: unknown): error is OdpError =>
  error instanceof OdpError && error.code === 'operation';

/** Removes the ids from a node and everything below it (a copy that is to name nothing). */
function removeIds(node: XmlNode): void {
  removeAttr(node, 'xml:id');
  removeAttr(node, 'draw:id');
  for (const child of childrenOf(node)) if (tagOf(child)) removeIds(child);
}

/**
 * A page style showing its master's background alone: no fill of its own, the master's shapes,
 * footer, date and page number left out (`masterGround`).
 */
const masterGroundStyle = (sink: StyleSink): string =>
  sink.add(
    element('style:style', { 'style:family': 'drawing-page' }, [
      element('style:drawing-page-properties', {
        'presentation:background-visible': 'true',
        'presentation:background-objects-visible': 'false',
        'presentation:display-header': 'false',
        'presentation:display-footer': 'false',
        'presentation:display-page-number': 'false',
        'presentation:display-date-time': 'false',
      }),
    ]),
  );

/** A page style of one colour, without the master's background and shapes (layers). */
const solidPage = (sink: StyleSink, color: string): string =>
  sink.add(
    element('style:style', { 'style:family': 'drawing-page' }, [
      element('style:drawing-page-properties', {
        'draw:fill': 'solid',
        'draw:fill-color': color,
        'presentation:background-visible': 'true',
        'presentation:background-objects-visible': 'false',
      }),
    ]),
  );

/** Every element of a part below its roots, in document order. */
function* elementsOf(part: XmlPart): Generator<XmlNode> {
  for (const root of part.nodes) yield* descendants(root);
}

const MAX_AUTHORED_XML = 400_000;

/** The elements of an XML fragment; malformed XML is an operation error naming the fault. */
function parsedNodes(xml: string, name: string): XmlNode[] {
  if (xml.length > MAX_AUTHORED_XML) {
    throw new OdpError('operation', `The ${name} XML is too long.`);
  }
  // A fragment may hold several elements (styles one after another): parse it under a root.
  const body = xml.trim().replace(/^<\?xml[^>]*\?>\s*/, '');
  try {
    const [root] = parsePart(`<fragment>${body}</fragment>`, name).nodes;
    return root ? elementChildren(root) : [];
  } catch (error) {
    if (error instanceof OdpError) throw new OdpError('operation', error.message);
    throw error;
  }
}

/**
 * An XML fragment written from outside, cleaned: no namespace declarations (the file's own
 * apply), no scripts, events, embedded data or plug-ins, no links LibreOffice could follow and
 * no hyperlinks but to the web or mail.
 */
function authoredNodes(xml: string, name: string): XmlNode[] {
  const nodes = parsedNodes(xml, name);
  const clean = (node: XmlNode) => {
    for (const attribute of attributeNames(node)) {
      if (attribute === 'xmlns' || attribute.startsWith('xmlns:')) removeAttr(node, attribute);
    }
    const href = attr(node, 'xlink:href');
    const tag = tagOf(node) ?? '';
    if (
      href !== undefined &&
      !isPackagePath(href) &&
      !(KEEPS_EXTERNAL_LINK.has(tag) && SAFE_LINK.test(href.trim()))
    ) {
      removeAttr(node, 'xlink:href');
    }
    const children = childrenOf(node);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i] as XmlNode;
      const childTag = tagOf(child);
      if (childTag === null) continue;
      if (AUTHORED_ELEMENTS_TO_DROP.has(childTag)) children.splice(i, 1);
      else clean(child);
    }
  };
  for (const node of nodes) clean(node);
  return nodes.filter((node) => !AUTHORED_ELEMENTS_TO_DROP.has(tagOf(node) ?? ''));
}

interface Located {
  node: XmlNode;
  page: XmlNode;
  pageIndex: number;
  /** What it lies in: its page, or the group (`draw:g`) it is part of. */
  parent: XmlNode;
}

/** A group's elements (`draw:g`), bottom first. */
const groupShapes = (group: XmlNode): XmlNode[] =>
  childrenOf(group).filter((child) => SHAPE_TAGS.has(tagOf(child) ?? ''));

/** Element `elementId` among `shapes` or in one of their groups, at any depth, with what holds it. */
function findShape(
  shapes: readonly XmlNode[],
  parent: XmlNode,
  elementId: string,
): { node: XmlNode; parent: XmlNode } | null {
  for (const shape of shapes) {
    if (attr(shape, 'xml:id') === elementId) return { node: shape, parent };
    if (tagOf(shape) !== 'draw:g') continue;
    const inner = findShape(groupShapes(shape), shape, elementId);
    if (inner) return inner;
  }
  return null;
}

/** What an operation can change of an {@link OdpDocument}, kept to go back to (`snapshot`). */
interface DocumentState {
  content: XmlNode[];
  styles: XmlNode[];
  manifest: XmlNode[] | null;
  entries: ReturnType<OdpArchive['entries']>;
  dirty: { content: boolean; styles: boolean; manifest: boolean };
  dirtyEmbedded: Set<string>;
  idsEnsured: boolean;
}

const DEFAULT_PAGE = { width: 28, height: 15.75 };

/** Where a picture goes on a layout designed in Slider – LibreOffice passes it by. */
const PICTURE_PLACEHOLDER = 'slider:picture-placeholder';
/** On a placeholder of a layout designed in Slider: its text is the prompt of empty ones. */
const PROMPT_MARK = 'slider:prompt';
/**
 * On a slide's placeholder made from such a layout ({@link OdpDocument.addSlide}): what it asks
 * for while empty – each its own, also where a layout has several of a kind.
 */
const ASKS_MARK = 'slider:asks';
/**
 * A layout's own guides on its master page, written as LibreOffice's snap lines are (`V…H…`, 1/100
 * mm from the page's corner) – LibreOffice's snap lines are the whole file's, a layout's are not.
 */
const GUIDES_MARK = 'slider:guides';
/** On a variant's `draw:page`: the page id of the slide it is a variant of (`addVariant`). */
const VARIANT_MARK = 'slider:variant-of';
/** On an element: who it is across slides (`EditableElement.morphKey`). */
const MORPH_KEY = 'slider:morph-key';

export class OdpDocument {
  private dirty = { content: false, styles: false, manifest: false };
  /** Pictures' own sizes (cm) read ahead for `setImageFit` ({@link preparePictures}), by path. */
  private pictureSizes = new Map<string, { w: number; h: number }>();
  /** Embedded objects' own parts (`Object 1/content.xml`, …) changed by `removeExternalLinks`. */
  private dirtyEmbedded = new Set<string>();
  /**
   * Every slide and element had its id when {@link ensureIds} last ran, and nothing without one
   * came in since: {@link slideIndexOf}, asked for every operation that names a slide, need not
   * walk the whole file again. Whatever puts in a page without its id clears it.
   */
  private idsEnsured = false;
  /**
   * How ids given from now on begin. The ids of a file as it is come with `sl` (the same for
   * every reader); a change made beside others (an AI request) gives the elements it adds ids
   * of its own, so they never meet another change's when both go in.
   */
  idPrefix = 'sl';

  private constructor(
    private readonly archive: OdpArchive,
    private readonly content: XmlPart,
    private readonly styles: XmlPart,
    private readonly manifest: XmlPart | null,
    /** The XML parts of embedded objects (charts, OLE documents), by path. */
    private readonly embedded: Map<string, XmlPart>,
  ) {}

  static async open(bytes: Uint8Array): Promise<OdpDocument> {
    const archive = await OdpArchive.open(bytes);
    const content = parsePart(await archive.readText('content.xml'), 'content.xml');
    const styles = archive.has('styles.xml')
      ? parsePart(await archive.readText('styles.xml'), 'styles.xml')
      : { declaration: '', nodes: [] };
    const manifest = archive.has('META-INF/manifest.xml')
      ? parsePart(await archive.readText('META-INF/manifest.xml'), 'META-INF/manifest.xml')
      : null;
    const embedded = new Map<string, XmlPart>();
    for (const path of archive.paths().filter(isEmbeddedPart)) {
      embedded.set(path, parsePart(await archive.readText(path), path));
    }
    const document = new OdpDocument(archive, content, styles, manifest, embedded);
    if (!document.presentation())
      throw new OdpError('unsupported', 'The file holds no presentation.');
    return document;
  }

  // ── Structure ───────────────────────────────────────────────────────────

  private root(part: XmlPart, tag: string): XmlNode | undefined {
    return part.nodes.find((node) => tagOf(node) === tag);
  }

  /** Every element of content.xml and styles.xml below their roots, in document order. */
  private elements(): XmlNode[] {
    return [...elementsOf(this.content), ...elementsOf(this.styles)];
  }

  private presentation(): XmlNode | undefined {
    const body = this.root(this.content, 'office:document-content');
    const officeBody = body && firstChild(body, 'office:body');
    return officeBody && firstChild(officeBody, 'office:presentation');
  }

  private pages(): XmlNode[] {
    return childrenOf(this.presentation() ?? {}).filter((node) => tagOf(node) === 'draw:page');
  }

  /** The slide's elements, bottom first – a tilted element's picture is no element of its own. */
  private shapesOf(page: XmlNode, tiltPictures = this.tiltPicturesOf(page)): XmlNode[] {
    const pictures = new Set(tiltPictures.values());
    return this.allShapesOf(page).filter((node) => !pictures.has(node));
  }

  /** Every shape on the slide, tilted elements' pictures too. */
  private allShapesOf(page: XmlNode): XmlNode[] {
    return childrenOf(page).filter((node) => SHAPE_TAGS.has(tagOf(node) ?? ''));
  }

  /**
   * The pictures of the slide's tilted elements (`setTilt`), by the element's id – a picture
   * whose element is gone is an ordinary picture again.
   */
  private tiltPicturesOf(page: XmlNode): Map<string, XmlNode> {
    const shapes = this.allShapesOf(page);
    const ids = new Set(shapes.map((node) => attr(node, 'xml:id')).filter(Boolean));
    const pictures = new Map<string, XmlNode>();
    for (const node of shapes) {
      const mark = readTiltMark(node);
      if (mark && ids.has(mark.of) && !pictures.has(mark.of)) pictures.set(mark.of, node);
    }
    return pictures;
  }

  /** Page size in cm, from the first slide's master page (all slides of a deck share it). */
  pageSize(): { width: number; height: number } {
    const first = this.pages()[0];
    const masterName = first && attr(first, 'draw:master-page-name');
    const styles = this.root(this.styles, 'office:document-styles');
    if (!styles) return DEFAULT_PAGE;
    const masters = firstChild(styles, 'office:master-styles');
    const master =
      masters &&
      (childrenOf(masters).find(
        (node) => tagOf(node) === 'style:master-page' && attr(node, 'style:name') === masterName,
      ) ??
        childrenOf(masters).find((node) => tagOf(node) === 'style:master-page'));
    const layoutName = master && attr(master, 'style:page-layout-name');
    const automatic = firstChild(styles, 'office:automatic-styles');
    const layouts = automatic
      ? childrenOf(automatic).filter((node) => tagOf(node) === 'style:page-layout')
      : [];
    const layout = layouts.find((node) => attr(node, 'style:name') === layoutName) ?? layouts[0];
    const properties = layout && firstChild(layout, 'style:page-layout-properties');
    const width = lengthToCm(properties && attr(properties, 'fo:page-width'));
    const height = lengthToCm(properties && attr(properties, 'fo:page-height'));
    return width && height ? { width, height } : DEFAULT_PAGE;
  }

  private hiddenStyles(): Set<string> {
    const hidden = new Set<string>();
    const scan = (container: XmlNode | undefined) => {
      for (const style of container ? childrenOf(container) : []) {
        if (tagOf(style) !== 'style:style' || attr(style, 'style:family') !== 'drawing-page')
          continue;
        const properties = firstChild(style, 'style:drawing-page-properties');
        if (properties && attr(properties, 'presentation:visibility') === 'hidden') {
          hidden.add(attr(style, 'style:name') ?? '');
        }
      }
    };
    const content = this.root(this.content, 'office:document-content');
    scan(content && firstChild(content, 'office:automatic-styles'));
    const styles = this.root(this.styles, 'office:document-styles');
    scan(styles && firstChild(styles, 'office:automatic-styles'));
    scan(styles && firstChild(styles, 'office:styles'));
    return hidden;
  }

  // ── Reading ─────────────────────────────────────────────────────────────

  slides(): OdpSlide[] {
    // Each slide's page style is looked up several times: all of them found once, not per look.
    this.pageStyles = new Map();
    for (const style of this.namedStyles()) {
      if (
        tagOf(style.node) === 'style:style' &&
        attr(style.node, 'style:family') === 'drawing-page' &&
        !this.pageStyles.has(style.name)
      )
        this.pageStyles.set(style.name, style.node);
    }
    try {
      return this.readSlides();
    } finally {
      this.pageStyles = null;
    }
  }

  /**
   * Whose variant each page is (its main slide's page id), by position: only where that slide is
   * in the file and no variant itself – a variant whose slide went is a hidden slide like others.
   */
  private variantLinks(): (string | null)[] {
    const pages = this.pages();
    const ids = new Map(pages.map((page) => [attr(page, 'xml:id'), page]));
    return pages.map((page) => {
      const of = attr(page, VARIANT_MARK);
      const main = of === undefined ? undefined : ids.get(of);
      return main && main !== page && attr(main, VARIANT_MARK) === undefined
        ? (of as string)
        : null;
    });
  }

  /** The drawing-page styles by name while `slides()` reads (nothing changes meanwhile). */
  private pageStyles: Map<string, XmlNode> | null = null;

  private readSlides(): OdpSlide[] {
    const size = this.pageSize();
    const hidden = this.hiddenStyles();
    const fingerprints = this.fingerprints();
    const styles = this.styleIndex();
    const prompts = this.layoutPrompts();
    const variants = this.variantLinks();
    return this.pages().map((page, index) => {
      const pictures = this.tiltPicturesOf(page);
      const asked = prompts.get(attr(page, 'draw:master-page-name') ?? '');
      const elements = this.shapesOf(page, pictures).map((node) => {
        const picture = pictures.get(attr(node, 'xml:id') ?? '');
        const item = this.describe(
          node,
          size,
          styles,
          picture ? readTiltMark(picture)?.tilt : null,
        );
        // Its own (a slide made since each has its own), else the first of its kind's.
        const own = attr(node, ASKS_MARK);
        const prompt = own !== undefined ? own : item.role ? asked?.get(item.role) : undefined;
        return prompt && item.live?.placeholder
          ? { ...item, live: { ...item.live, prompt } }
          : item;
      });
      const title = elements
        .find((item) => item.role === 'title')
        ?.paragraphs?.join(' ')
        .trim();
      return {
        index,
        name: attr(page, 'draw:name') ?? `Folie ${index + 1}`,
        hidden: hidden.has(attr(page, 'draw:style-name') ?? '\u0000'),
        background: this.pageBackground(page),
        ownBackground: this.hasOwnBackground(page),
        backgroundFills: this.pageFills(page, styles),
        transition: this.pageTransition(page),
        notes: notesOf(page),
        ...this.notesRichOf(page, styles),
        variantOf: variants[index] ?? null,
        elements,
        title: title || attr(page, 'draw:name') || `Folie ${index + 1}`,
        fingerprint: fingerprints[index] ?? '',
        pageId: attr(page, 'xml:id') ?? null,
      };
    });
  }

  /**
   * What the placeholders of layouts designed in Slider ask for, by master page and class: the
   * text typed into them there ({@link toTemplate}).
   */
  private layoutPrompts(): Map<string, Map<string, string>> {
    const styles = this.root(this.styles, 'office:document-styles');
    const masters = styles && firstChild(styles, 'office:master-styles');
    const prompts = new Map<string, Map<string, string>>();
    for (const master of masters ? elementChildren(masters) : []) {
      const name = attr(master, 'style:name');
      if (!name || tagOf(master) !== 'style:master-page') continue;
      for (const frame of elementChildren(master)) {
        const kind = attr(frame, 'presentation:class');
        const box = attr(frame, PROMPT_MARK) === 'true' && firstChild(frame, 'draw:text-box');
        const text = box ? readParagraphs(box).join('\n').trim() : '';
        if (!kind || !text) continue;
        const own = prompts.get(name) ?? new Map<string, string>();
        if (!own.has(kind)) own.set(kind, text);
        prompts.set(name, own);
      }
    }
    return prompts;
  }

  private kindOf(node: XmlNode): EditableElementKind {
    const tag = tagOf(node);
    if (tag === 'draw:g') return 'group';
    if (tag === 'draw:line') return 'line';
    if (tag === 'draw:frame') {
      const inner = elementChildren(node).map(tagOf);
      if (inner.includes('draw:text-box')) return 'text';
      if (inner.includes('table:table')) return 'table';
      if (inner.includes('draw:image')) return 'image';
      return 'other';
    }
    return tag && TEXT_SHAPES.has(tag) ? 'shape' : 'other';
  }

  /** Whether an element shows any text (a frame's or a shape's) – not a title or description. */
  private holdsText(node: XmlNode): boolean {
    const container = this.textContainer(node);
    return !!container && readParagraphs(container).some((paragraph) => paragraph.trim());
  }

  private textContainer(node: XmlNode): XmlNode | null {
    const tag = tagOf(node);
    if (tag === 'draw:frame') return firstChild(node, 'draw:text-box') ?? null;
    return tag && TEXT_SHAPES.has(tag) ? node : null;
  }

  private describe(
    node: XmlNode,
    size: { width: number; height: number },
    styles: StyleIndex,
    tilt: ElementTilt | null = null,
  ): EditableElement {
    const kind = this.kindOf(node);
    const frame = kind === 'other' ? null : frameOf(node);
    const box = frame?.box ?? boxOf(node) ?? { x: 0, y: 0, w: 0, h: 0 };
    const movable = frame !== null;
    const container = this.textContainer(node);
    const line = kind === 'line';
    const live = movable && !line ? explainLive(styles, node).live : null;
    const look =
      kind === 'shape' || kind === 'text'
        ? readLook(styles, node, kind === 'shape')
        : line
          ? // A line has no area: its look is its stroke.
            { ...readLook(styles, node, true), fill: null, fills: [], fillAspect: null }
          : null;
    const paint =
      kind === 'image'
        ? picturePaintOf(styles, node, frame, tilt)
        : line
          ? linePaintOf(styles, node, look, frame, tilt, (name) => sliderDash(styles, name))
          : paintOf(styles, node, live, look, frame, tilt);
    return {
      id: attr(node, 'xml:id') ?? '',
      kind,
      name: attr(node, 'draw:name') ?? '',
      role: attr(node, 'presentation:class') ?? null,
      bbox: {
        x: box.x / size.width,
        y: box.y / size.height,
        w: box.w / size.width,
        h: box.h / size.height,
      },
      rotation: frame?.rotation ?? 0,
      paragraphs: container ? readParagraphs(container) : null,
      movable,
      resizable: movable && kind !== 'group',
      // A tilted one too: typed on the slide tilted, its picture drawn anew after (`setTilt`).
      live,
      credit: kind === 'image' ? readCredit(node) : null,
      look,
      tilt,
      // A line's way across its box.
      flip: line ? readLineFlip(node) : movable ? readFlip(styles, node, kind) : null,
      ...(readLocked(styles, node) && { locked: true }),
      ...(attr(node, MORPH_KEY) && { morphKey: attr(node, MORPH_KEY) }),
      ...(kind === 'group' && groupMembers(node)),
      ...(kind === 'group' && {
        children: groupShapes(node).map((child) => this.describe(child, size, styles)),
      }),
      ...(line && { line: { heads: readHeads(styles, node) } }),
      ...(kind === 'shape' && outlineOf(node)),
      ...(kind === 'shape' && cornersOf(node)),
      ...(kind === 'image' && { picture: readPicture(styles, node) }),
      ...(paint && { paint }),
    };
  }

  /** The styles content.xml's elements may name, with the fonts of both parts. */
  private styleIndex(): StyleIndex {
    const content = this.root(this.content, 'office:document-content');
    const styles = this.root(this.styles, 'office:document-styles');
    const containers = [
      content && firstChild(content, 'office:automatic-styles'),
      styles && firstChild(styles, 'office:styles'),
      styles && firstChild(styles, 'office:automatic-styles'),
    ].filter((node): node is XmlNode => node !== undefined);
    const fonts = [content, styles]
      .map((root) => root && firstChild(root, 'office:font-face-decls'))
      .filter((node): node is XmlNode => node !== undefined);
    return new StyleIndex(containers, fonts, styles && firstChild(styles, 'office:styles'), {
      styles: content && firstChild(content, 'office:automatic-styles'),
      fonts: content && firstChild(content, 'office:font-face-decls'),
    });
  }

  /** content.xml's automatic styles, created when the file has none. */
  private automaticStyles(): XmlNode {
    const content = this.root(this.content, 'office:document-content') as XmlNode;
    let automatic = firstChild(content, 'office:automatic-styles');
    if (!automatic) {
      automatic = element('office:automatic-styles');
      const siblings = childrenOf(content);
      const body = siblings.findIndex((node) => tagOf(node) === 'office:body');
      siblings.splice(body === -1 ? siblings.length : body, 0, automatic);
    }
    return automatic;
  }

  /** Declares the `loext:` prefix in content.xml – its automatic styles are to use it. */
  private declareLoext(): void {
    const root = this.root(this.content, 'office:document-content');
    if (root && attr(root, 'xmlns:loext') === undefined) setAttr(root, 'xmlns:loext', LOEXT_NS);
  }

  /** Where the live editor's writers put their styles (see {@link StyleSink}). */
  private styleSink(): StyleSink {
    // Its text styles carry `loext:opacity` – a blank deck's content.xml has no `loext:` yet.
    this.declareLoext();
    const automatic = this.automaticStyles();
    const index = this.styleIndex();
    const prefix = { text: 'T', paragraph: 'P', graphic: 'gr', presentation: 'pr' } as Record<
      string,
      string
    >;
    // Attributes in any order: a style written anew equals the one written before.
    const canonical = (node: XmlNode): string => {
      const tag = tagOf(node);
      if (!tag) return xmlOf(node);
      const attributes = attributeNames(node)
        .filter((name) => name !== 'style:name')
        .sort()
        .map((name) => `${name}=${attr(node, name)}`);
      return `<${tag} ${attributes.join(' ')}>${childrenOf(node).map(canonical).join('')}</${tag}>`;
    };
    return {
      index,
      automatic: (family, name) =>
        childrenOf(automatic).find(
          (node) =>
            tagOf(node) === 'style:style' &&
            attr(node, 'style:family') === family &&
            attr(node, 'style:name') === name,
        ),
      add: (style) => {
        // A list style (`text:list-style`) or a style of a family.
        const tag = tagOf(style);
        const family = tag === 'style:style' ? (attr(style, 'style:family') ?? 'graphic') : null;
        const xml = canonical(style);
        const same = childrenOf(automatic).find(
          (node) =>
            tagOf(node) === tag &&
            (family === null || attr(node, 'style:family') === family) &&
            canonical(node) === xml,
        );
        if (same) return attr(same, 'style:name') as string;
        const taken = new Set(this.namedStyles().map((item) => item.name));
        let n = 1;
        const stem = `${this.idPrefix}${family === null ? 'L' : (prefix[family] ?? 'st')}`;
        while (taken.has(`${stem}${n}`)) n += 1;
        setAttr(style, 'style:name', `${stem}${n}`);
        childrenOf(automatic).push(style);
        this.dirty.content = true;
        return `${stem}${n}`;
      },
    };
  }

  /**
   * Leaves out one element's text, its shape as it is (`blankText`): the file the live editor's
   * picture of that slide is drawn from, the text typed over it. Returns the slide (0-based) and
   * a hash over what that picture shows – the same while only the text changes – or `null` when
   * the element's text cannot be typed on the slide.
   */
  blankText(elementId: string): { pageIndex: number; fingerprint: string } | null {
    const { node, page, pageIndex } = this.locate(elementId);
    if (!frameOf(node) || !explainLive(this.styleIndex(), node).live) return null;
    blankText(this.styleSink(), node);
    // Tilted, it shows as its picture: that goes too – the text is typed tilted over the slide.
    const tilted = this.tiltPicturesOf(page).get(elementId);
    if (tilted) removeChild(page, tilted);
    this.dirty.content = true;
    return { pageIndex, fingerprint: this.drawnPageHash(page) };
  }

  /**
   * Leaves an element out of its slide, and what lies over it – the slide a frosted element blurs
   * (`bakeBackdrop`). Returns its page and a fingerprint of what the page then shows; `null` for an
   * element not drawn live.
   */
  blankElement(elementId: string): { pageIndex: number; fingerprint: string } | null {
    const { node, page, pageIndex } = this.locate(elementId);
    if (!liveShapeOf(node)) return null;
    // What lies over it goes too: drawn over the blur in turn.
    page[tagOf(page) as string] = withoutElement(childrenOf(page), node);
    this.dirty.content = true;
    return { pageIndex, fingerprint: this.drawnPageHash(page) };
  }

  /**
   * One hash per slide over its XML without our element ids: changes whenever anything on the
   * slide does, and stays the same for an unchanged slide of another save of the file.
   */
  fingerprints(): string[] {
    return this.pages().map((page) => pageHash(page));
  }

  /** {@link pageHash} of a page with the styles it names: what LibreOffice draws of it. */
  private drawnPageHash(page: XmlNode): string {
    return pageHash(page, this.stylesXml(styleReferences(page)).xml.join(''));
  }

  // ── Preparing a file for Slider ─────────────────────────────────────────

  /**
   * Gives every element on a slide, and every slide, an `xml:id`, so operations can name it and a
   * slide stays itself when slides move. LibreOffice drops these ids when it saves, so they are
   * stable only while the deck is edited in Slider. The same file always gets the same ids.
   * Returns how many were added.
   */
  ensureIds(): number {
    const taken = new Set<string>();
    for (const root of this.content.nodes) {
      for (const node of descendants(root)) {
        const id = attr(node, 'xml:id');
        if (id) taken.add(id);
      }
    }
    let next = 1;
    let added = 0;
    const prefix = this.idPrefix;
    const give = (node: XmlNode) => {
      if (attr(node, 'xml:id')) return;
      while (taken.has(`${prefix}${next}`)) next += 1;
      setAttr(node, 'xml:id', `${prefix}${next}`);
      taken.add(`${prefix}${next}`);
      added += 1;
    };
    for (const page of this.pages()) for (const node of this.shapesOf(page)) give(node);
    // Pages after all shapes, so files from before page ids get the shape ids they always got.
    for (const page of this.pages()) give(page);
    if (added > 0) this.dirty.content = true;
    this.idsEnsured = true;
    return added;
  }

  /**
   * Removes every link LibreOffice could follow out of the file while it draws the deck (linked
   * pictures and objects, DDE, floating frames, sounds, scripts) – in the embedded objects' parts
   * too, which LibreOffice loads to draw them. Hyperlinks and click actions stay when they go to
   * the web, to mail or inside the file (they are only followed on a click); any other scheme
   * (`file:`, `vnd.sun.star.script:`, …) goes, and so does a click action that starts a program.
   * Returns how many links went.
   */
  removeExternalLinks(): number {
    let removed = 0;
    const clean = (part: XmlPart): boolean => {
      let changed = false;
      const walk = (node: XmlNode) => {
        const children = childrenOf(node);
        for (let i = children.length - 1; i >= 0; i -= 1) {
          const child = children[i] as XmlNode;
          const tag = tagOf(child);
          if (!tag) continue;
          if (
            LINK_ELEMENTS_TO_DROP.has(tag) ||
            (tag === 'presentation:event-listener' &&
              attr(child, 'presentation:action') === 'execute')
          ) {
            children.splice(i, 1);
            removed += 1;
            changed = true;
            continue;
          }
          const href = attr(child, 'xlink:href');
          if (
            href !== undefined &&
            !isPackagePath(href) &&
            !(KEEPS_EXTERNAL_LINK.has(tag) && SAFE_LINK.test(href.trim()))
          ) {
            removeAttr(child, 'xlink:href');
            removed += 1;
            changed = true;
          }
          walk(child);
        }
      };
      for (const root of part.nodes) walk(root);
      return changed;
    };
    if (clean(this.content)) this.dirty.content = true;
    if (clean(this.styles)) this.dirty.styles = true;
    for (const [path, part] of this.embedded) if (clean(part)) this.dirtyEmbedded.add(path);
    return removed;
  }

  /**
   * Names every font the file uses by what `substitute` makes of it (`null`: as it is) – in its
   * font declarations and wherever a style names a family itself. For drawing in a LibreOffice
   * whose profile cannot carry each deck's own replacement table (the render pool): the same
   * pairs, applied in the file. Returns the number of names replaced.
   */
  replaceFonts(substitute: (family: string) => string | null): number {
    let replaced = 0;
    const replace = (part: XmlPart): boolean => {
      let changed = false;
      for (const node of elementsOf(part)) {
        for (const name of FONT_FAMILY_ATTRIBUTES) {
          const value = attr(node, name);
          if (value === undefined) continue;
          const family = unquoteFamily(value);
          const next = family && substitute(family);
          if (!next || next === family) continue;
          setAttr(node, name, /\s/.test(next) ? `'${next}'` : next);
          replaced += 1;
          changed = true;
        }
      }
      return changed;
    };
    if (replace(this.content)) this.dirty.content = true;
    if (replace(this.styles)) this.dirty.styles = true;
    return replaced;
  }

  // ── Operations ──────────────────────────────────────────────────────────

  /** An element of a slide – also one in a group (entered by a double click, Figma). */
  private locate(elementId: string): Located {
    const pages = this.pages();
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      const page = pages[pageIndex] as XmlNode;
      const found = findShape(this.shapesOf(page), page, elementId);
      if (found) return { ...found, page, pageIndex };
    }
    throw new OdpError('operation', 'Dieses Element gibt es nicht mehr.');
  }

  private graphicProps(node: XmlNode): Properties {
    return graphicPropsOf(this.styleIndex(), node);
  }

  /**
   * Gives a shape or text frame the backdrop blur `radius` (points; 0: none) in its layers' mark
   * – baked into its fill by the server (`backdropWork`, `bakeBackdrop`). Taken off a picture that
   * holds one, a fill one colour or gradient draws is written as such at once; a picture of
   * layers is marked to be baked of them alone.
   */
  private markBackdrop(node: XmlNode, kind: EditableElementKind, radius: number): void {
    const props = this.graphicProps(node);
    const current = readFills(this.styleIndex(), node, props, kind === 'shape' ? 'solid' : 'none');
    const had = current.backdrop;
    const { fills, aspect } = current;
    if (radius > 0) {
      writeFillsMark(
        node,
        { fills, aspect, backdrop: { radius, source: had?.source ?? '' } },
        props,
      );
      return;
    }
    if (!had) return;
    // Its picture holds no backdrop (never baked, or of the layers alone): only the mark goes.
    if (!had.source) {
      writeFillsMark(node, { fills, aspect }, props);
      return;
    }
    const shown = nativeFill(fills);
    if (shown === 'composite') {
      writeFillsMark(node, { fills, aspect, backdrop: { radius: 0, source: had.source } }, props);
      return;
    }
    const native = fillProperties({ named: (item) => this.named(item) }, shown, null);
    writeShapeStyle(
      this.styleSink(),
      node,
      { type: 'setShapeStyle', elementId: '' },
      undefined,
      native,
    );
    writeFillsMark(node, { fills, aspect: null }, native);
  }

  /**
   * The shapes and text frames whose fill is to be baked anew for their backdrop blur
   * (`ElementEffects.backdrop`), bottom first on each slide: those whose picture was baked from
   * another backdrop than theirs now – the slide under them (`blankElement`), their place, size,
   * turn, mirroring, layers or blur changed – and those whose picture holds one no longer wanted
   * (`radius` 0, baked of the layers alone). `source` is what the new picture is baked from
   * (written back by {@link bakeBackdrop}); `backdrop` the fingerprint of the slide under it alone.
   */
  backdropWork(): BackdropWork[] {
    const work: BackdropWork[] = [];
    const index = this.styleIndex();
    // Also a group's parts (entered by a double click): bottom first, as drawn.
    const withParts = (node: XmlNode): XmlNode[] =>
      tagOf(node) === 'draw:g' ? [node, ...groupShapes(node).flatMap(withParts)] : [node];
    this.pages().forEach((page, pageIndex) => {
      for (const node of this.shapesOf(page).flatMap(withParts)) {
        if (!attr(node, MARK_ATTR)?.includes('"backdrop"')) continue;
        const mark = readFills(index, node, graphicPropsOf(index, node), 'none');
        const frame = frameOf(node);
        const elementId = attr(node, 'xml:id');
        if (!mark.backdrop || !frame || !elementId) continue;
        const kind = this.kindOf(node);
        if (kind !== 'shape' && kind !== 'text') continue;
        const flip = readFlip(index, node, kind) ?? { x: false, y: false };
        const { radius } = mark.backdrop;
        const backdrop = radius > 0 ? this.backdropFingerprint(page, node) : '';
        const source =
          radius > 0
            ? createHash('sha256')
                .update(JSON.stringify([backdrop, frame, flip, radius, mark.fills]))
                .digest('hex')
                .slice(0, 32)
            : '';
        if (radius > 0 && source === mark.backdrop.source) continue;
        work.push({
          elementId,
          pageIndex,
          radius,
          source,
          backdrop,
          box: frame.box,
          rotation: frame.rotation,
          flip,
          fills: mark.fills,
        });
      }
    });
    return work;
  }

  /**
   * Writes the fill {@link backdropWork} baked for an element: `picture` – the blurred backdrop
   * under its layers, or (`radius` 0) the layers alone – stretched over it, its layers and blur
   * kept in its mark with `source`. `picture` `null`: its layers as one colour or gradient.
   */
  bakeBackdrop(
    elementId: string,
    picture: { bytes: Uint8Array; mediaType: string } | null,
    source: string,
  ): void {
    const { node } = this.locate(elementId);
    const mark = readFills(this.styleIndex(), node, this.graphicProps(node), 'none');
    const frame = frameOf(node);
    if (!mark.backdrop || !frame) return;
    const shown = picture ? 'composite' : nativeFill(mark.fills);
    if (shown === 'composite' && !picture) throw new OdpError('operation', 'Bild fehlt.');
    const composite = picture ? this.addPicture(picture.bytes, picture.mediaType) : null;
    const props = fillProperties({ named: (item) => this.named(item) }, shown, composite);
    writeShapeStyle(this.styleSink(), node, { type: 'setShapeStyle', elementId }, undefined, props);
    const { radius } = mark.backdrop;
    writeFillsMark(
      node,
      {
        fills: mark.fills,
        aspect: composite && frame.box.h > 0 ? frame.box.w / frame.box.h : null,
        ...(radius > 0 ? { backdrop: { radius, source } } : {}),
      },
      props,
    );
    this.dirty.content = true;
  }

  /** What the slide shows under an element, as {@link blankElement} leaves it – the page unchanged. */
  private backdropFingerprint(page: XmlNode, node: XmlNode): string {
    const tag = tagOf(page) as string;
    const children = childrenOf(page);
    page[tag] = withoutElement(children, node);
    try {
      return this.drawnPageHash(page);
    } finally {
      page[tag] = children;
    }
  }

  /** The 0-based slide an element is on, `null` when it is not there (any more). */
  slideOf(elementId: string): number | null {
    try {
      return this.locate(elementId).pageIndex;
    } catch {
      return null;
    }
  }

  /**
   * The picture an image element shows, as PNG, JPEG, GIF or WebP – `null` for an element that
   * is no picture or shows none of those (a vector picture, one linked from outside).
   */
  async elementPicture(elementId: string): Promise<Uint8Array | null> {
    const { node } = this.locate(elementId);
    if (tagOf(node) !== 'draw:frame') return null;
    for (const image of childrenOf(node).filter((child) => tagOf(child) === 'draw:image')) {
      const path = attr(image, 'xlink:href');
      const bytes = path ? await this.picture(path) : null;
      if (bytes && imageSize(bytes)) return bytes;
    }
    return null;
  }

  /**
   * Reads ahead the own sizes of the pictures `setImageFit` is to fit and that note none yet (an
   * imported picture): {@link apply} cannot read pictures itself.
   */
  async preparePictures(operations: readonly SlideOperation[]): Promise<void> {
    for (const operation of operations) {
      if (operation.type !== 'setImageFit') continue;
      const node =
        this.slideOf(operation.elementId) === null ? null : this.locate(operation.elementId).node;
      const path = node && needsPictureSize(node) ? framePicture(node) : null;
      if (!path || this.pictureSizes.has(path)) continue;
      const bytes = await this.picture(path);
      const size = bytes && pictureCmSize(bytes);
      if (size) this.pictureSizes.set(path, size);
    }
  }

  /**
   * Applies operations in order. An operation that does not fit (unknown element, text on a
   * picture, …) throws an `OdpError('operation')`; the document may then be half changed, so
   * callers apply to a fresh copy and keep it only on success – or use {@link applyWhatFits},
   * which leaves out what does not fit and keeps the rest.
   */
  apply(
    operations: readonly SlideOperation[],
    images: ReadonlyMap<string, OdpImage> = new Map(),
    designs: ReadonlyMap<string, OdpDesign> = new Map(),
    sources: ReadonlyMap<string, OdpElementSource> = new Map(),
  ): void {
    const size = this.pageSize();
    // For the lock checks: built once for a run of moves (a group dragged, an AI batch), again
    // after anything else – it may have written styles.
    let lockIndex: StyleIndex | null = null;
    let previous: SlideOperation['type'] | null = null;
    for (const operation of operations) {
      if (previous !== 'setBox') lockIndex = null;
      previous = operation.type;
      switch (operation.type) {
        case 'deleteSlide': {
          const index = this.slideIndexOf(operation.pageId);
          if (this.pages().length === 1)
            throw new OdpError('operation', 'Die letzte Folie lässt sich nicht löschen.');
          this.removeSlide(index);
          continue;
        }
        case 'setSlideHidden':
          this.setSlideHidden(this.slideIndexOf(operation.pageId), operation.hidden);
          continue;
        case 'setSlideBackground': {
          const index = this.slideIndexOf(operation.pageId);
          if (operation.fills)
            this.setSlideFills(index, operation.fills, operation.composite, images);
          else this.setSlideBackground(index, operation.color ?? null);
          continue;
        }
        case 'setSlideTransition':
          this.setSlideTransition(this.slideIndexOf(operation.pageId), operation.transition);
          continue;
        case 'setSlideNotes':
          this.setSlideNotes(
            this.slideIndexOf(operation.pageId),
            operation.text,
            operation.paragraphs,
          );
          continue;
        case 'addVariant': {
          this.assertFreeId(operation.newPageId, 'Diese Folie gibt es schon.');
          this.addVariant(this.slideIndexOf(operation.pageId), operation.newPageId);
          continue;
        }
        case 'useVariant':
          this.useVariant(this.slideIndexOf(operation.pageId));
          continue;
        case 'moveSlide': {
          if (operation.after === operation.pageId)
            throw new OdpError(
              'operation',
              'Eine Folie lässt sich nicht hinter sich selbst verschieben.',
            );
          const from = this.slideIndexOf(operation.pageId);
          const after = operation.after === null ? -1 : this.slideIndexOf(operation.after);
          // Counted without the slide moved.
          this.moveSlide(from, after < from ? after + 1 : after);
          continue;
        }
        case 'duplicateSlide': {
          this.assertFreeId(operation.newPageId, 'Diese Folie gibt es schon.');
          const from = this.slideIndexOf(operation.pageId);
          const id = this.duplicateSlide(from, this.positionAfter(operation.after));
          this.renamePage(id, operation.newPageId);
          continue;
        }
        case 'addSlide': {
          this.assertFreeId(operation.newPageId, 'Diese Folie gibt es schon.');
          const like = this.slideIndexOf(operation.like);
          const master = operation.design
            ? this.takeLayoutFrom(designs.get(operation.design.id), operation.design.layout)
            : operation.master;
          // Of no layout: „Neue Folie“, empty.
          const id = this.addSlide(this.positionAfter(operation.after), {
            like,
            master,
            empty: master === undefined,
          });
          this.renamePage(id, operation.newPageId);
          continue;
        }
        case 'addElement':
          this.addElement(operation, size);
          continue;
        case 'addImage':
          this.addImage(operation, size, operation.imageId ? images.get(operation.imageId) : null);
          continue;
        case 'copyElement':
          this.copyElement(operation, size, sources);
          continue;
        case 'groupElements':
          this.groupElements(operation);
          continue;
      }
      const target = this.locate(operation.elementId);
      // Locked in place (`setLocked`): neither moved, sized, turned nor tilted – by whoever asks
      // (editor, AI, voice); its text, look, stacking and deleting stay free.
      if (
        (operation.type === 'setBox' || operation.type === 'setTilt') &&
        readLocked((lockIndex ??= this.styleIndex()), target.node)
      ) {
        throw new OdpError('operation', 'Das Element ist gesperrt – erst entsperren.');
      }
      switch (operation.type) {
        case 'setText':
          this.setText(target, operation.paragraphs);
          break;
        case 'setRichText':
          this.declareLoext();
          writeRichText(this.styleSink(), target.node, operation.paragraphs);
          break;
        case 'setShapeStyle': {
          const kind = this.kindOf(target.node);
          if (kind !== 'shape' && kind !== 'text' && kind !== 'line')
            throw new OdpError('operation', 'Dieses Element hat keine Füllung oder Linie.');
          const dash = operation.stroke?.dash;
          const dashName = dash && dash !== 'solid' ? this.strokeDash(dash) : undefined;
          if (kind === 'line') {
            // A line has no area, text or effects: its line and heads.
            if (operation.heads && operation.heads !== 'none') this.arrowMarker();
            writeShapeStyle(
              this.styleSink(),
              target.node,
              {
                type: 'setShapeStyle',
                elementId: operation.elementId,
                stroke: operation.stroke,
                heads: operation.heads,
              },
              dashName,
            );
            break;
          }
          if (operation.heads !== undefined)
            throw new OdpError('operation', 'Nur Linien haben Pfeilspitzen.');
          if (operation.effects) this.declareLoext();
          // The backdrop blur wanted afterwards (0: none): as said, else as it was.
          const backdrop = operation.effects
            ? (operation.effects.backdrop ?? 0)
            : (readFills(this.styleIndex(), target.node, this.graphicProps(target.node), 'none')
                .backdrop?.radius ?? 0);
          if (operation.fills) {
            const fills = this.fillPictures(operation.fills, images);
            const shown = nativeFill(fills);
            let composite: string | null = null;
            if (shown === 'composite') {
              const image = operation.composite && images.get(operation.composite.imageId);
              if (!image)
                throw new OdpError(
                  'operation',
                  'Das Bild ist nicht mehr da. Bitte nochmal versuchen.',
                );
              composite = this.addPicture(image.bytes, image.mediaType);
            }
            const props = fillProperties({ named: (node) => this.named(node) }, shown, composite);
            writeShapeStyle(this.styleSink(), target.node, operation, dashName, props);
            writeFillsMark(
              target.node,
              {
                fills,
                aspect: composite ? (operation.composite?.aspect ?? null) : null,
                // The picture written holds no backdrop: to be baked (`backdropWork`).
                ...(backdrop > 0 ? { backdrop: { radius: backdrop, source: '' } } : {}),
              },
              props,
            );
          } else {
            writeShapeStyle(this.styleSink(), target.node, operation, dashName);
            if (operation.fill !== undefined) writeFillsMark(target.node, null, {});
            if (operation.effects || operation.fill !== undefined)
              this.markBackdrop(target.node, kind, backdrop);
          }
          break;
        }
        case 'setBox':
          this.setBoxOf(target, toCm(operation.box, size), operation.rotation, operation.flip);
          break;
        case 'replaceImage': {
          const image = images.get(operation.imageId);
          if (!image)
            throw new OdpError(
              'operation',
              'Das Bild ist nicht mehr da – bitte nochmal hochladen.',
            );
          this.replaceImage(target, image);
          break;
        }
        case 'setTilt':
          this.setTilt(target, operation, size, images);
          break;
        case 'setLocked':
          writeLock(this.styleSink(), this.styleIndex(), target.node, operation.locked);
          break;
        case 'setImageFit': {
          const frame = this.kindOf(target.node) === 'image' && frameOf(target.node);
          if (!frame) throw new OdpError('operation', 'Dieses Element ist kein Bild.');
          const path = framePicture(target.node);
          const size = path ? (this.pictureSizes.get(path) ?? null) : null;
          if (
            !writePictureFit(
              this.styleSink(),
              target.node,
              frame.box,
              operation.fit,
              operation.focus,
              size,
            )
          )
            throw new OdpError('operation', 'Die Größe dieses Bilds ist unbekannt.');
          break;
        }
        case 'setCornerRadius':
          if (!writeCornerRadius(target.node, operation.radius))
            throw new OdpError('operation', 'Nur ein Rechteck hat Ecken zum Abrunden.');
          break;
        case 'deleteElement':
          this.deleteElement(target);
          break;
        case 'moveElement':
          this.moveElement(target, operation.to);
          break;
        case 'ungroupElements':
          this.ungroupElements(target);
          break;
      }
      this.dirty.content = true;
    }
  }

  /**
   * Applies what fits of `operations`, each whole or not at all: one that does not fit the deck
   * (an `OdpError('operation')` – its element or slide went meanwhile, its picture is gone, its
   * new id is taken) is left out, the document exactly as it was before that operation however
   * far the operation got, and the others still go in. For edits made on an older state of the
   * deck. `reason` is why the first one left out did not fit. Any other error is thrown, the
   * document as it was before.
   *
   * Mostly everything fits: the batch is tried whole on one {@link snapshot} – a copy of the
   * trees, milliseconds for a large deck, under the deck's lock – and only when something does
   * not fit is it gone through one operation at a time, each on a snapshot of its own.
   */
  applyWhatFits(
    operations: readonly SlideOperation[],
    images: ReadonlyMap<string, OdpImage> = new Map(),
    designs: ReadonlyMap<string, OdpDesign> = new Map(),
    sources: ReadonlyMap<string, OdpElementSource> = new Map(),
  ): { applied: SlideOperation[]; dropped: SlideOperation[]; reason: string | null } {
    const before = this.snapshot();
    try {
      this.apply(operations, images, designs, sources);
      return { applied: [...operations], dropped: [], reason: null };
    } catch (error) {
      this.restore(before);
      if (!isMisfit(error)) throw error;
    }
    const applied: SlideOperation[] = [];
    const dropped: SlideOperation[] = [];
    let reason: string | null = null;
    for (const operation of operations) {
      const state = this.snapshot();
      try {
        this.apply([operation], images, designs, sources);
      } catch (error) {
        this.restore(state);
        if (!isMisfit(error)) throw error;
        dropped.push(operation);
        reason ??= error.message;
        continue;
      }
      applied.push(operation);
    }
    return { applied, dropped, reason };
  }

  /**
   * Everything an operation can change, as it is now, for {@link restore}: the trees of
   * content.xml, styles.xml and the manifest (copied – they are changed in place), the package's
   * parts (pictures added) and what is to be written. Embedded objects' parts are left out: only
   * `removeExternalLinks` changes them, never an operation. A copy of a large deck's trees takes
   * milliseconds (about 3 ms for 500 kB of content.xml) – once per edit, more only for an edit
   * where something does not fit ({@link applyWhatFits}).
   */
  private snapshot(): DocumentState {
    return {
      content: structuredClone(this.content.nodes),
      styles: structuredClone(this.styles.nodes),
      manifest: this.manifest ? structuredClone(this.manifest.nodes) : null,
      entries: this.archive.entries(),
      dirty: { ...this.dirty },
      dirtyEmbedded: new Set(this.dirtyEmbedded),
      idsEnsured: this.idsEnsured,
    };
  }

  /** Goes back to a {@link snapshot}, which is used up by it (its trees become the document's). */
  private restore(state: DocumentState): void {
    this.content.nodes = state.content;
    this.styles.nodes = state.styles;
    if (this.manifest && state.manifest) this.manifest.nodes = state.manifest;
    this.archive.restore(state.entries);
    this.dirty = state.dirty;
    this.dirtyEmbedded = state.dirtyEmbedded;
    this.idsEnsured = state.idsEnsured;
  }

  /**
   * The editor's dash pattern for a border (in styles.xml, added the first time): parts and gaps
   * relative to the line's width, as LibreOffice's own patterns are.
   */
  private strokeDash(kind: 'dash' | 'dot'): string {
    const name = kind === 'dash' ? 'Slider_20_Dash' : 'Slider_20_Dot';
    const common = this.commonStyles();
    if (!common) throw new OdpError('operation', 'Die Datei hat keine Formatvorlagen.');
    const taken = childrenOf(common).some(
      (node) => tagOf(node) === 'draw:stroke-dash' && attr(node, 'draw:name') === name,
    );
    if (!taken) {
      childrenOf(common).push(
        element('draw:stroke-dash', {
          'draw:name': name,
          'draw:display-name': kind === 'dash' ? 'Slider Dash' : 'Slider Dot',
          'draw:style': 'rect',
          'draw:dots1': '1',
          'draw:dots1-length': kind === 'dash' ? '400%' : '100%',
          'draw:distance': kind === 'dash' ? '200%' : '100%',
        }),
      );
      this.dirty.styles = true;
    }
    return name;
  }

  /** LibreOffice's arrow head in styles.xml (added the first time), as a line's heads name it. */
  private arrowMarker(): void {
    const common = this.commonStyles();
    if (!common) throw new OdpError('operation', 'Die Datei hat keine Formatvorlagen.');
    const name = ARROW_MARKER['draw:name'];
    const taken = childrenOf(common).some(
      (node) => tagOf(node) === 'draw:marker' && attr(node, 'draw:name') === name,
    );
    if (taken) return;
    childrenOf(common).push(arrowMarker());
    this.dirty.styles = true;
  }

  /**
   * A gradient or fill picture in styles.xml (added the first time; named by what it is, so an
   * equal one is there once), its name – the prefixes it uses declared.
   */
  private named(node: XmlNode): string {
    const name = attr(node, 'draw:name') ?? '';
    const tag = tagOf(node);
    const common = this.commonStyles();
    const root = this.root(this.styles, 'office:document-styles');
    if (!common || !root) throw new OdpError('operation', 'Die Datei hat keine Formatvorlagen.');
    const taken = childrenOf(common).some(
      (child) => tagOf(child) === tag && attr(child, 'draw:name') === name,
    );
    if (!taken) {
      if (attr(root, 'xmlns:loext') === undefined) setAttr(root, 'xmlns:loext', LOEXT_NS);
      if (attr(root, 'xmlns:xlink') === undefined)
        setAttr(root, 'xmlns:xlink', 'http://www.w3.org/1999/xlink');
      childrenOf(common).push(node);
      this.dirty.styles = true;
    }
    return name;
  }

  /**
   * The layers with each picture just uploaded for the editor put into the package – named by its
   * path then. One the package lacks does not fit.
   */
  private fillPictures(
    fills: readonly FillLayer[],
    images: ReadonlyMap<string, OdpImage>,
  ): FillLayer[] {
    return fills.map((layer) => {
      if (layer.type !== 'image') return layer;
      if (layer.src.startsWith('Pictures/') && this.archive.has(layer.src)) return layer;
      const image = images.get(layer.src);
      if (!image)
        throw new OdpError('operation', 'Das Bild ist nicht mehr da – bitte nochmal hochladen.');
      return { ...layer, src: this.addPicture(image.bytes, image.mediaType) };
    });
  }

  /** A new text frame or shape on top of a slide, with the id the editor gave it. */
  private addElement(
    operation: Extract<SlideOperation, { type: 'addElement' }>,
    size: { width: number; height: number },
  ): void {
    const page = this.page(this.slideIndexOf(operation.pageId));
    this.assertFreeId(operation.elementId);
    const shapes = this.shapesOf(page);
    const label =
      operation.kind === 'text'
        ? 'Textfeld'
        : operation.kind === 'line'
          ? NEW_LINES[operation.heads && operation.heads !== 'none' ? 'arrow' : 'line']
          : NEW_SHAPES[operation.shape ?? 'rectangle'];
    const names = new Set(shapes.map((node) => attr(node, 'draw:name')));
    let n = 1;
    while (names.has(`${label} ${n}`)) n += 1;
    const dash = operation.stroke?.dash;
    if (operation.kind === 'line' && operation.heads && operation.heads !== 'none')
      this.arrowMarker();
    const node = newElement(
      this.styleSink(),
      operation,
      toCm(operation.box, size),
      `${label} ${n}`,
      dash && dash !== 'solid' ? this.strokeDash(dash) : undefined,
    );
    this.putOnTop(page, shapes, node);
  }

  /**
   * A new picture frame on top of a slide: the image fitted into the box (its proportions kept),
   * or – without one – a placeholder filling it.
   */
  private addImage(
    operation: Extract<SlideOperation, { type: 'addImage' }>,
    size: { width: number; height: number },
    image: OdpImage | null | undefined,
  ): void {
    if (operation.imageId && !image)
      throw new OdpError('operation', 'Das Bild ist nicht mehr da – bitte nochmal hochladen.');
    const page = this.page(this.slideIndexOf(operation.pageId));
    this.assertFreeId(operation.elementId);
    let box = toCm(operation.box, size);
    if (image && image.width > 0 && image.height > 0) box = fitted(box, image);
    const path = image
      ? this.addPicture(image.bytes, image.mediaType)
      : this.addPlaceholder(placeholderPicture(box.w, box.h));
    const shapes = this.shapesOf(page);
    const names = new Set(shapes.map((node) => attr(node, 'draw:name')));
    let n = 1;
    while (names.has(`Bild ${n}`)) n += 1;
    const node = newImageFrame(this.styleSink(), operation.elementId, box, `Bild ${n}`, path);
    if (image) {
      writeCredit(node, image.credit ?? null);
      resetPicture(this.styleSink(), node, pictureCmSize(image.bytes));
    }
    this.putOnTop(page, shapes, node);
  }

  /**
   * A copy of an element on top of a slide, in the box given: ids of its own (the copy's the one
   * the editor gave it), its tilted picture along, its animations not.
   */
  private copyElement(
    operation: Extract<SlideOperation, { type: 'copyElement' }>,
    size: { width: number; height: number },
    sources: ReadonlyMap<string, OdpElementSource>,
  ): void {
    // Gone from here (cut, or deleted since it was copied): as the file before that had it.
    const earlier = this.slideOf(operation.elementId) === null && sources.get(operation.elementId);
    const from = earlier ? earlier.document : this;
    const source = from.locate(operation.elementId);
    const pageIndex = this.slideIndexOf(operation.pageId);
    const page = this.page(pageIndex);
    this.assertFreeId(operation.newElementId);
    const copy = structuredClone(source.node);
    const tilted = from.tiltPicturesOf(source.page).get(operation.elementId);
    const picture = tilted && structuredClone(tilted);
    const copies = picture ? [copy, picture] : [copy];
    const id = attr(source.node, 'xml:id') as string;
    // Who it was, for the morph transition (as `duplicateSlide`).
    if (attr(copy, MORPH_KEY) === undefined) setAttr(copy, MORPH_KEY, id);
    // A group's parts under the ids the editor gave them (each its own, free here).
    const fixed = new Map([[id, operation.newElementId]]);
    const partIds = operation.partIds ?? {};
    const taken = operation.partIds ? this.takenIds() : new Set<string>();
    for (const node of descendants(copy)) {
      const part = attr(node, 'xml:id');
      const given = part !== undefined && Object.hasOwn(partIds, part) ? partIds[part] : undefined;
      if (part === undefined || given === undefined || fixed.has(part)) continue;
      if ([...fixed.values()].includes(given))
        throw new OdpError('operation', 'Zwei Teile der Kopie haben dieselbe Kennung.');
      if (taken.has(given)) throw new OdpError('operation', 'Dieses Element gibt es schon.');
      fixed.set(part, given);
    }
    this.renewIds(copies, fixed);
    // Into a group (pasted while in it, a deleted part of it brought back): on top of its parts.
    const group = operation.groupId ? this.locate(operation.groupId) : null;
    if (group && (tagOf(group.node) !== 'draw:g' || group.page !== page))
      throw new OdpError('operation', 'Diese Gruppe gibt es auf der Folie nicht.');
    if (group && picture)
      throw new OdpError('operation', 'Gekippte Elemente lassen sich nicht gruppieren.');
    if (group) this.putOnTop(group.node, groupShapes(group.node), copy);
    else this.putOnTop(page, this.allShapesOf(page), copy);
    if (picture) {
      const siblings = childrenOf(page);
      siblings.splice(siblings.indexOf(copy) + 1, 0, picture);
    }
    if (earlier) {
      // What it names that this file no longer has: its styles, and the pictures it shows.
      const styles = this.takeStylesFrom(earlier.document, copies);
      for (const path of picturePathsIn(xmlOf(...copies, ...styles))) {
        const shown = earlier.pictures.get(path);
        if (!shown || this.archive.has(path)) continue;
        this.archive.write(path, shown.bytes, false);
        this.addToManifest(path, shown.mediaType);
      }
    }
    this.setBoxOf(
      { node: copy, page, pageIndex, parent: group?.node ?? page },
      toCm(operation.box, size),
      undefined,
      undefined,
    );
  }

  /**
   * Element `elementId` of this file – an earlier state of one it is gone from – as
   * {@link copyElement} takes it in there: this file, with the pictures the element (and its
   * tilted picture) and the styles it names show. `null` when it is not here either.
   */
  async elementSource(elementId: string): Promise<OdpElementSource | null> {
    if (this.slideOf(elementId) === null) return null;
    const { node, page } = this.locate(elementId);
    const tilted = this.tiltPicturesOf(page).get(elementId);
    const nodes = tilted ? [node, tilted] : [node];
    const styles = this.stylesNamedBy(nodes, new Set()).map((style) => style.node);
    const pictures = new Map<string, { bytes: Uint8Array; mediaType: string }>();
    for (const path of picturePathsIn(xmlOf(...nodes, ...styles))) {
      const bytes = await this.picture(path);
      if (bytes) {
        pictures.set(path, {
          bytes,
          mediaType: this.manifestType(path) ?? 'application/octet-stream',
        });
      }
    }
    return { document: this, pictures };
  }

  /** Puts a new element on its slide right over `shapes` (the slide's), under nothing. */
  private putOnTop(page: XmlNode, shapes: readonly XmlNode[], node: XmlNode): void {
    const last = shapes.at(-1);
    const siblings = childrenOf(page);
    siblings.splice(last ? siblings.indexOf(last) + 1 : 0, 0, node);
    this.dirty.content = true;
  }

  private setText({ node }: Located, paragraphs: readonly string[]): void {
    const container = this.textContainer(node);
    if (!container) throw new OdpError('operation', 'Dieses Element hat keinen Text.');
    writeParagraphs(container, paragraphs);
    // A filled placeholder is no longer one (LibreOffice would otherwise show its prompt).
    if (
      attr(node, 'presentation:placeholder') === 'true' &&
      paragraphs.some((text) => text.trim())
    ) {
      removeAttr(node, 'presentation:placeholder');
    }
  }

  private setBoxOf(
    { node, page }: Located,
    box: CmBox,
    rotation: number | undefined,
    flip: ElementFlip | undefined,
  ): void {
    const current = frameOf(node);
    if (!current) throw new OdpError('operation', 'Dieses Element lässt sich nicht verschieben.');
    if (tagOf(node) === 'draw:line') {
      // Its ends the box's corners, the way it runs as said; turned, they turn round its centre.
      placeLine(node, box, flip, rotation ?? 0);
      this.dirty.content = true;
      return;
    }
    if (tagOf(node) === 'draw:g') {
      if (rotation !== undefined && rotation % 360 !== 0)
        throw new OdpError('operation', 'Gruppen lassen sich nicht drehen.');
      if (flip?.x || flip?.y)
        throw new OdpError('operation', 'Gruppen lassen sich nicht spiegeln.');
      // Each part where its place is kept – a turned one by its transform.
      moveBy(node, box.x - current.box.x, box.y - current.box.y);
      return;
    }
    let turn = rotation ?? current.rotation;
    if (flip) {
      const kind = this.kindOf(node);
      if (!readFlip(this.styleIndex(), node, kind)) {
        if (flip.x || flip.y)
          throw new OdpError('operation', 'Dieses Element lässt sich nicht spiegeln.');
      } else turn += writeFlip(this.styleSink(), node, kind, flip);
    }
    setFrame(node, { box, rotation: turn });
    // A filled picture is cropped to its new proportions, not stretched.
    if (this.kindOf(node) === 'image') refitPicture(this.styleSink(), node, box);
    // Its tilted picture goes along, stretched with it (the editor draws it anew).
    const picture = this.tiltPicturesOf(page).get(attr(node, 'xml:id') ?? '');
    const shown = picture && frameOf(picture);
    if (picture && shown) {
      const from = current.box;
      const sx = from.w > 0 ? box.w / from.w : 1;
      const sy = from.h > 0 ? box.h / from.h : 1;
      setFrame(picture, {
        box: {
          x: box.x + (shown.box.x - from.x) * sx,
          y: box.y + (shown.box.y - from.y) * sy,
          w: shown.box.w * sx,
          h: shown.box.h * sy,
        },
        rotation: 0,
      });
    }
  }

  /**
   * Tilts an element: it stays, unseen, and its picture so tilted lies right over it – or, flat
   * again, it shows itself and the picture goes.
   */
  private setTilt(
    { node, page, parent }: Located,
    operation: Extract<SlideOperation, { type: 'setTilt' }>,
    size: { width: number; height: number },
    images: ReadonlyMap<string, OdpImage>,
  ): void {
    const id = attr(node, 'xml:id') ?? '';
    const old = this.tiltPicturesOf(page).get(id);
    if (!operation.tilt || !operation.picture) {
      if (old) removeChild(page, old);
      removeAttr(node, 'draw:display');
      return;
    }
    if (!frameOf(node) || this.kindOf(node) === 'group' || parent !== page)
      throw new OdpError('operation', 'Dieses Element lässt sich nicht kippen.');
    const image = images.get(operation.picture.imageId);
    if (!image)
      throw new OdpError('operation', 'Das Bild ist nicht mehr da. Bitte nochmal versuchen.');
    const { box } = operation.picture;
    const picture = newImageFrame(
      this.styleSink(),
      (old && attr(old, 'xml:id')) || this.freshId(this.takenIds()),
      toCm(box, size),
      `${attr(node, 'draw:name') ?? 'Element'} (3D)`,
      this.addPicture(image.bytes, image.mediaType),
    );
    writeTiltMark(picture, { of: id, tilt: operation.tilt });
    if (old) removeChild(page, old);
    const siblings = childrenOf(page);
    siblings.splice(siblings.indexOf(node) + 1, 0, picture);
    setAttr(node, 'draw:display', 'none');
  }

  private replaceImage({ node }: Located, image: OdpImage): void {
    const pictures = childrenOf(node).filter((child) => tagOf(child) === 'draw:image');
    const first = pictures[0];
    if (tagOf(node) !== 'draw:frame' || !first)
      throw new OdpError('operation', 'Dieses Element ist kein Bild.');
    const path = this.addPicture(image.bytes, image.mediaType);
    setAttr(first, 'xlink:href', path);
    // A filled placeholder is no longer one: LibreOffice draws no picture of an empty one.
    removeAttr(node, 'presentation:placeholder');
    for (const [name, value] of [
      ['xlink:type', 'simple'],
      ['xlink:show', 'embed'],
      ['xlink:actuate', 'onLoad'],
    ] as const) {
      if (!attr(first, name)) setAttr(first, name, value);
    }
    for (const name of attributeNames(first)) {
      if (name.endsWith(':mime-type')) setAttr(first, name, image.mediaType);
    }
    for (const binary of childrenOf(first).filter(
      (child) => tagOf(child) === 'office:binary-data',
    )) {
      removeChild(first, binary);
    }
    // Fallback pictures (an SVG's PNG twin) would show the old picture elsewhere.
    for (const other of pictures.slice(1)) removeChild(node, other);
    writeCredit(node, image.credit ?? null);
    // Fit the new picture into the old frame, keeping its proportions.
    const frame = frameOf(node);
    if (frame && image.width > 0 && image.height > 0) {
      setFrame(node, { box: fitted(frame.box, image), rotation: frame.rotation });
    }
    // Shown whole: what the old one had cut off is no part of the new one.
    resetPicture(this.styleSink(), node, pictureCmSize(image.bytes));
  }

  /**
   * Puts an element `to`th from the bottom of its slide's elements (counted without it) – one in a
   * group among that group's.
   */
  private moveElement({ node, page, parent }: Located, to: number): void {
    if (parent !== page) {
      const others = groupShapes(parent).filter((shape) => shape !== node);
      if (to > others.length)
        throw new OdpError('operation', 'So viele Ebenen hat die Gruppe nicht.');
      const siblings = childrenOf(parent);
      siblings.splice(siblings.indexOf(node), 1);
      const under = others[to];
      siblings.splice(under ? siblings.indexOf(under) : siblings.length, 0, node);
      return;
    }
    const picture = this.tiltPicturesOf(page).get(attr(node, 'xml:id') ?? '');
    const others = this.shapesOf(page).filter((shape) => shape !== node);
    // Checked before anything changes: an operation that does not fit leaves the file as it was.
    if (to > others.length) throw new OdpError('operation', 'So viele Ebenen hat die Folie nicht.');
    if (picture) removeChild(page, picture);
    const siblings = childrenOf(page);
    siblings.splice(siblings.indexOf(node), 1);
    // Before the element it goes under; on top: right after the topmost, before notes and
    // animations.
    const under = others[to];
    const last = others.at(-1);
    const at = under
      ? siblings.indexOf(under)
      : last
        ? siblings.indexOf(last) + 1
        : siblings.findIndex((child) => !SHAPE_TAGS.has(tagOf(child) ?? '') && tagOf(child));
    siblings.splice(at === -1 ? siblings.length : at, 0, node);
    // Its tilted picture right over it again.
    if (picture) siblings.splice(siblings.indexOf(node) + 1, 0, picture);
  }

  /**
   * Elements of one slide in a new group (`draw:g`), in their stacking order, each keeping its id
   * – the group where the topmost of them was. Children of a group lie on the page as they are
   * (a group has no place of its own), so nothing moves on the slide.
   */
  private groupElements(operation: Extract<SlideOperation, { type: 'groupElements' }>): void {
    this.assertFreeId(operation.newElementId);
    const located = [...new Set(operation.elementIds)].map((id) => this.locate(id));
    const page = located[0]?.page;
    // In a group (entered): a group in it.
    const parent = located[0]?.parent;
    if (!page || !parent || located.length < 2)
      throw new OdpError('operation', 'Zum Gruppieren braucht es mindestens zwei Elemente.');
    if (located.some((item) => item.page !== page))
      throw new OdpError('operation', 'Nur Elemente einer Folie lassen sich gruppieren.');
    if (located.some((item) => item.parent !== parent))
      throw new OdpError('operation', 'Nur Elemente einer Gruppe lassen sich gruppieren.');
    const pictures = this.tiltPicturesOf(page);
    if (located.some((item) => pictures.has(attr(item.node, 'xml:id') ?? '')))
      throw new OdpError('operation', 'Gekippte Elemente lassen sich nicht gruppieren.');
    const shapes = parent === page ? this.shapesOf(page) : groupShapes(parent);
    const members = located
      .map((item) => item.node)
      .sort((a, b) => shapes.indexOf(a) - shapes.indexOf(b));
    const names = new Set(shapes.map((node) => attr(node, 'draw:name')));
    let n = 1;
    while (names.has(`Gruppe ${n}`)) n += 1;
    const group = element(
      'draw:g',
      { 'draw:name': `Gruppe ${n}`, 'xml:id': operation.newElementId },
      [],
    );
    const siblings = childrenOf(parent);
    siblings.splice(siblings.indexOf(members.at(-1)!), 0, group);
    for (const member of members) removeChild(parent, member);
    childrenOf(group).push(...members);
    this.dirty.content = true;
  }

  /** A group's elements on the slide on their own again, in their order where the group was. */
  private ungroupElements({ node, parent }: Located): void {
    if (tagOf(node) !== 'draw:g') throw new OdpError('operation', 'Das ist keine Gruppe.');
    const members = childrenOf(node).filter((child) => tagOf(child));
    const siblings = childrenOf(parent);
    siblings.splice(siblings.indexOf(node), 1, ...members);
    // Each stands on its own: an element without an id (made elsewhere) gets one.
    const taken = this.takenIds();
    for (const member of members) {
      if (!SHAPE_TAGS.has(tagOf(member) ?? '') || attr(member, 'xml:id')) continue;
      const id = this.freshId(taken);
      setAttr(member, 'xml:id', id);
      taken.add(id);
    }
  }

  private deleteElement({ node, page, parent }: Located): void {
    const picture = this.tiltPicturesOf(page).get(attr(node, 'xml:id') ?? '');
    if (picture) removeChild(page, picture);
    removeChild(parent, node);
    // The last part of a group gone: the group too (and a group that held only it, and so on).
    for (let group = parent; group !== page && groupShapes(group).length === 0;) {
      const holder = findShape(this.shapesOf(page), page, attr(group, 'xml:id') ?? '\u0000');
      if (!holder) break;
      removeChild(holder.parent, group);
      group = holder.parent;
    }
    // Animations of the element would point at nothing.
    const ids = [attr(node, 'xml:id'), attr(node, 'draw:id')].filter(Boolean);
    this.removeEffects(page, (target) => ids.includes(target));
  }

  /** Removes the animation effects on the page whose target `matches`. */
  private removeEffects(page: XmlNode, matches: (target: string) => boolean): void {
    const effects = [...descendants(page)].filter((item) => {
      const target = attr(item, 'smil:targetElement');
      return target !== undefined && matches(target);
    });
    for (const effect of effects) {
      // Remove the whole effect (the nearest `anim:par` with a node type), not just its target.
      const chain = [...(parentsOf([page], effect) ?? []), effect];
      let index = chain.findLastIndex(
        (item, i) => i > 0 && attr(item, 'presentation:node-type') !== undefined,
      );
      if (index <= 0) index = chain.length - 1;
      const parent = chain[index - 1];
      if (parent) removeChild(parent, chain[index] as XmlNode);
    }
  }

  /**
   * Puts a picture into the package (named by its content, so the same picture is there once)
   * and returns its path. It goes again on writing unless a slide or style refers to it.
   */
  addPicture(bytes: Uint8Array, mediaType: string): string {
    const path = picturePath(bytes, mediaType);
    if (!this.archive.has(path)) {
      this.archive.write(path, bytes, false);
      this.addToManifest(path, mediaType);
    }
    return path;
  }

  /** The placeholder SVG of a new picture frame – ours: SVGs from elsewhere stay out. */
  private addPlaceholder(bytes: Uint8Array): string {
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
    const path = `Pictures/${hash}.svg`;
    if (!this.archive.has(path)) {
      this.archive.write(path, bytes, false);
      this.addToManifest(path, 'image/svg+xml');
    }
    return path;
  }

  /**
   * Credits the stock photo `path` in every frame that shows it; returns the page ids of the
   * slides changed.
   */
  creditPicture(path: string, credit: ImageCredit): string[] {
    const changed: string[] = [];
    for (const page of this.pages()) {
      const frames = framesShowing(page, path);
      for (const frame of frames) writeCredit(frame, credit);
      if (frames.length > 0) changed.push(attr(page, 'xml:id') ?? '');
    }
    if (changed.length > 0) this.dirty.content = true;
    return changed;
  }

  /** The font families the file names anywhere – in lower case. */
  fontFamilies(): Set<string> {
    const named = new Set<string>();
    for (const node of this.elements()) {
      for (const name of FONT_FAMILY_ATTRIBUTES) {
        const value = attr(node, name);
        if (value) named.add(unquoteFamily(value).toLowerCase());
      }
    }
    return named;
  }

  /**
   * The font families the file's Latin text is set in – in lower case: named by a style
   * (`fo:font-family`, or `style:font-name` through its font declaration), not those named for
   * Asian or complex scripts only (LibreOffice's defaults for them come along in every file).
   */
  latinFontFamilies(): Set<string> {
    const declared = new Map<string, string>();
    const named = new Set<string>();
    const clean = (value: string) => unquoteFamily(value).toLowerCase();
    const elements = this.elements();
    for (const node of elements) {
      const family = attr(node, 'svg:font-family');
      const name = attr(node, 'style:name');
      if (tagOf(node) === 'style:font-face' && family && name) declared.set(name, clean(family));
    }
    for (const node of elements) {
      const family = attr(node, 'fo:font-family');
      if (family) named.add(clean(family));
      const name = attr(node, 'style:font-name');
      const face = name && declared.get(name);
      if (face) named.add(face);
    }
    return named;
  }

  /**
   * The font files the file brings along: every `svg:font-face-uri` of a `style:font-face` – in
   * content.xml, where LibreOffice embeds them, or styles.xml – that is a file of the package;
   * each file once, under the first family declared with it.
   */
  embeddedFontFiles(): OdpFontFile[] {
    const files = new Map<string, OdpFontFile>();
    for (const part of [this.content, this.styles]) {
      for (const root of part.nodes) {
        if (!tagOf(root)) continue;
        const decls = firstChild(root, 'office:font-face-decls');
        for (const face of decls ? elementChildren(decls) : []) {
          if (tagOf(face) !== 'style:font-face') continue;
          const family = unquoteFamily(attr(face, 'svg:font-family') ?? '');
          const src = firstChild(face, 'svg:font-face-src');
          if (!family || !src) continue;
          for (const uri of elementChildren(src)) {
            const path = attr(uri, 'xlink:href')?.replace(/^\.\//, '');
            if (tagOf(uri) !== 'svg:font-face-uri' || !path || files.has(path)) continue;
            if (isPackagePath(path) && this.archive.has(path)) files.set(path, { family, path });
          }
        }
      }
    }
    return [...files.values()];
  }

  /** An embedded font file's bytes ({@link embeddedFontFiles}); `null` for any other path or one too big. */
  async fontFile(path: string): Promise<Uint8Array | null> {
    if (!this.embeddedFontFiles().some((file) => file.path === path)) return null;
    if (this.archive.size(path) > MAX_FONT_BYTES) return null;
    return this.archive.readBinary(path, MAX_FONT_BYTES);
  }

  /**
   * Embeds the faces of fonts the file names (by family, any case) – a workspace's own fonts –
   * so LibreOffice draws it in them without having them installed: each in `Fonts/`, declared
   * under its family in styles.xml (ODF's embedded fonts). For drawing; returns the faces
   * embedded.
   */
  embedFonts(faces: readonly EmbeddedFont[]): number {
    if (faces.length === 0) return 0;
    const named = this.fontFamilies();
    const used = faces.filter((face) => named.has(face.family.toLowerCase()));
    const styles = this.root(this.styles, 'office:document-styles');
    if (used.length === 0 || !styles) return 0;
    let decls = firstChild(styles, 'office:font-face-decls');
    if (!decls) {
      decls = element('office:font-face-decls');
      childrenOf(styles).unshift(decls);
    }
    const families = new Map<string, EmbeddedFont[]>();
    for (const face of used) {
      const key = face.family.toLowerCase();
      families.set(key, [...(families.get(key) ?? []), face]);
    }
    let n = 0;
    for (const list of families.values()) {
      const family = list[0]!.family;
      n += 1;
      const uris = list.map((face) => {
        const path = `Fonts/slider-${n}-${face.weight}${face.italic ? 'i' : ''}.${face.format}`;
        this.archive.write(path, face.bytes, false);
        this.addToManifest(
          path,
          face.format === 'otf' ? 'application/vnd.ms-opentype' : 'application/x-font-ttf',
        );
        return element('svg:font-face-uri', { 'xlink:href': path, 'xlink:type': 'simple' }, [
          element('svg:font-face-format', {
            'svg:string': face.format === 'otf' ? 'opentype' : 'truetype',
          }),
        ]);
      });
      childrenOf(decls).push(
        element(
          'style:font-face',
          {
            'style:name': `Slider embedded ${n}`,
            'svg:font-family': /\s/.test(family) ? `'${family}'` : family,
          },
          [element('svg:font-face-src', {}, uris)],
        ),
      );
    }
    this.dirty.styles = true;
    return used.length;
  }

  /** Whether the page's style hides its master's shapes (`background-objects-visible`). */
  private hidesMasterShapes(page: XmlNode): boolean {
    const style = this.pageStyle(attr(page, 'draw:style-name'));
    const properties = style && firstChild(style, 'style:drawing-page-properties');
    return !!properties && attr(properties, 'presentation:background-objects-visible') === 'false';
  }

  /**
   * The master pages (`style:master-page`) – a design's slide masters – in file order, with
   * where their title and text placeholders sit (lengths as written, `svg:x` …). A page drawn
   * on one shows its background and decoration.
   */
  masterPages(): OdpMasterPage[] {
    const styles = this.root(this.styles, 'office:document-styles');
    const masters = styles && firstChild(styles, 'office:master-styles');
    const named = new Set(this.namedStyles().map((style) => style.name));
    const automatic = styles && firstChild(styles, 'office:automatic-styles');
    const looks = new Set(
      (automatic ? elementChildren(automatic) : [])
        .filter((node) => attr(node, 'style:family') === 'presentation')
        .map((node) => attr(node, 'style:name')),
    );
    return (masters ? childrenOf(masters) : []).flatMap((master) => {
      const name = tagOf(master) === 'style:master-page' ? attr(master, 'style:name') : undefined;
      if (!name) return [];
      const placeholders = childrenOf(master).flatMap((frame): OdpMasterPage['placeholders'] => {
        const tag = tagOf(frame);
        const kind =
          tag === PICTURE_PLACEHOLDER
            ? 'picture'
            : tag === 'draw:frame'
              ? attr(frame, 'presentation:class')
              : undefined;
        const [x, y, width, height] = ['svg:x', 'svg:y', 'svg:width', 'svg:height'].map((key) =>
          attr(frame, key),
        );
        const own = attr(frame, 'presentation:style-name');
        const box = attr(frame, PROMPT_MARK) === 'true' && firstChild(frame, 'draw:text-box');
        return (kind === 'title' ||
          kind === 'subtitle' ||
          kind === 'outline' ||
          kind === 'picture') &&
          x &&
          y &&
          width &&
          height
          ? [
              {
                kind,
                x,
                y,
                width,
                height,
                // The master's own look for it: `Title_20_Slide-title`, `…-outline1`.
                style:
                  [`${name}-${kind === 'outline' ? 'outline1' : kind}`].find((style) =>
                    named.has(style),
                  ) ?? null,
                look: box && own && looks.has(own) ? own : null,
                prompt: box ? readParagraphs(box).join('\n').trim() : null,
              },
            ]
          : [];
      });
      return [{ name, displayName: attr(master, 'style:display-name') ?? null, placeholders }];
    });
  }

  /** Whether the file is a template (`.otp`), as its manifest says – a design, no deck. */
  isTemplate(): boolean {
    return this.manifestType('/') === OTP_MIME;
  }

  /** A template (`.otp`) marked as a plain presentation, so it opens as an `.odp`. */
  markAsPresentation(): void {
    this.archive.write('mimetype', ODP_MIME, false);
    const root = this.manifest && this.root(this.manifest, 'manifest:manifest');
    const entry = root && childrenOf(root).find((node) => attr(node, 'manifest:full-path') === '/');
    if (entry && attr(entry, 'manifest:media-type') !== ODP_MIME) {
      setAttr(entry, 'manifest:media-type', ODP_MIME);
      this.dirty.manifest = true;
    }
  }

  private addToManifest(path: string, mediaType: string): void {
    const root = this.manifest && this.root(this.manifest, 'manifest:manifest');
    if (!root) return;
    childrenOf(root).push(
      element('manifest:file-entry', {
        'manifest:full-path': path,
        'manifest:media-type': mediaType,
      }),
    );
    this.dirty.manifest = true;
  }

  // ── Slides as XML (the AI, BER-183) ─────────────────────────────────────

  /**
   * The 0-based position of the slide with page id `pageId`. Gives every slide its page id first
   * (see {@link ensureIds}): a file without them gets those every reading of it gets.
   */
  private slideIndexOf(pageId: string): number {
    if (!this.idsEnsured) this.ensureIds();
    const index = this.pageIds().indexOf(pageId);
    if (index === -1) throw new OdpError('operation', 'Diese Folie gibt es nicht mehr.');
    return index;
  }

  /** Where a slide put right after slide `after` goes (`null`: first), counted before it. */
  private positionAfter(after: string | null): number {
    return after === null ? 0 : this.slideIndexOf(after) + 1;
  }

  /**
   * Refuses an id the editor picked for something it adds when the file has it already – an
   * edit sent again whose first went in, mostly; `taken` says so without showing the id.
   */
  private assertFreeId(id: string, taken = 'Dieses Element gibt es schon.'): void {
    if (this.takenIds().has(id)) throw new OdpError('operation', taken);
  }

  /** Gives the slide with page id `from` the page id `to` (free – see {@link assertFreeId}). */
  private renamePage(from: string, to: string): void {
    const page = this.pages().find((item) => attr(item, 'xml:id') === from);
    if (!page) throw new OdpError('operation', 'Diese Folie gibt es nicht mehr.');
    setAttr(page, 'xml:id', to);
    this.dirty.content = true;
  }

  private page(index: number): XmlNode {
    const page = this.pages()[index];
    if (!page) throw new OdpError('operation', `There is no slide ${index + 1}.`);
    return page;
  }

  /** The slide's `draw:page` element as XML. */
  slideXml(index: number): string {
    return xmlOf(this.page(index));
  }

  /** Where named styles live: content.xml's automatic styles, styles.xml's styles and masters. */
  private styleContainers(): XmlNode[] {
    const content = this.root(this.content, 'office:document-content');
    const styles = this.root(this.styles, 'office:document-styles');
    return [
      content && firstChild(content, 'office:automatic-styles'),
      styles && firstChild(styles, 'office:styles'),
      styles && firstChild(styles, 'office:automatic-styles'),
      styles && firstChild(styles, 'office:master-styles'),
    ].filter((node): node is XmlNode => node !== undefined);
  }

  private namedStyles(): { name: string; node: XmlNode; container: XmlNode }[] {
    return this.styleContainers().flatMap((container) =>
      elementChildren(container).flatMap((node) => {
        const name = attr(node, 'style:name') ?? attr(node, 'draw:name');
        return name ? [{ name, node, container }] : [];
      }),
    );
  }

  /** The styles a slide names (not its master page and layout), in order of first use. */
  styleNamesOf(index: number): string[] {
    const page = this.page(index);
    return [
      ...new Set(
        [page, ...descendants(page)].flatMap((node) =>
          attributeNames(node)
            .filter((name) => name.endsWith('style-name'))
            .map((name) => attr(node, name) ?? '')
            .filter(Boolean),
        ),
      ),
    ];
  }

  /** The styles with these names (all families) as XML, and the names not found. */
  stylesXml(names: readonly string[]): { xml: string[]; missing: string[] } {
    const byName = new Map<string, XmlNode[]>();
    for (const style of this.namedStyles()) {
      byName.set(style.name, [...(byName.get(style.name) ?? []), style.node]);
    }
    const xml: string[] = [];
    const missing: string[] = [];
    for (const name of new Set(names)) {
      const found = byName.get(name) ?? [];
      if (found.length === 0) missing.push(name);
      for (const node of found) xml.push(xmlOf(node));
    }
    return { xml, missing };
  }

  /**
   * Where `query` occurs (any case) in the slides' XML – notes included – and in the named styles
   * and master pages, with some XML around it; at most `limit` places, and how many there are.
   */
  search(
    query: string,
    limit = 40,
  ): { places: { where: string; excerpt: string }[]; total: number } {
    const needle = query.toLowerCase();
    const places: { where: string; excerpt: string }[] = [];
    let total = 0;
    const scan = (where: string, node: XmlNode) => {
      const xml = xmlOf(node);
      const lower = xml.toLowerCase();
      for (
        let at = lower.indexOf(needle);
        at !== -1;
        at = lower.indexOf(needle, at + needle.length)
      ) {
        total += 1;
        if (places.length >= limit) continue;
        const start = Math.max(0, at - SEARCH_CONTEXT);
        const end = Math.min(xml.length, at + needle.length + SEARCH_CONTEXT);
        const excerpt = `${start > 0 ? '…' : ''}${xml.slice(start, end)}${end < xml.length ? '…' : ''}`;
        places.push({ where, excerpt });
      }
    };
    if (!needle) return { places, total };
    this.pages().forEach((page, index) => scan(`slide ${index + 1}`, page));
    for (const style of this.namedStyles()) scan(`${tagOf(style.node)} ${style.name}`, style.node);
    return { places, total };
  }

  /** The package's pictures: size, what they are, and which slides and styles show them. */
  async pictures(): Promise<OdpPicture[]> {
    const users = new Map<string, Set<string>>();
    const note = (path: string, where: string) => {
      if (!users.has(path)) users.set(path, new Set());
      users.get(path)?.add(where);
    };
    this.pages().forEach((page, index) => {
      for (const path of picturePathsIn(xmlOf(page))) note(path, `slide ${index + 1}`);
    });
    for (const style of this.namedStyles()) {
      for (const path of picturePathsIn(xmlOf(style.node))) note(path, style.name);
    }
    const pictures: OdpPicture[] = [];
    for (const path of this.archive.paths().filter((item) => item.startsWith('Pictures/'))) {
      const bytes = this.archive.size(path);
      const head = bytes <= MAX_PICTURE_BYTES ? await this.picture(path) : null;
      const size = head && imageSize(head);
      pictures.push({
        path,
        bytes,
        mediaType: size?.mediaType ?? this.manifestType(path),
        width: size?.width ?? null,
        height: size?.height ?? null,
        usedBy: [...(users.get(path) ?? [])],
      });
    }
    return pictures;
  }

  /** A picture's bytes (`null` if it is not in the package or too large). */
  async picture(path: string): Promise<Uint8Array | null> {
    return pictureIn(this.archive, path);
  }

  /** {@link picture} of a file without reading its slides and styles – only its zip is opened. */
  static async pictureOf(bytes: Uint8Array, path: string): Promise<Uint8Array | null> {
    return pictureIn(await OdpArchive.open(bytes), path);
  }

  /**
   * Brings back what slides `pageIds` – just written from `from`, a file this one came from:
   * taking a change back – name and this document lacks: their styles with everything those
   * name in turn ({@link takeStylesFrom}), and the pictures the slides and those styles show.
   */
  async takeWhatSlidesNeedFrom(from: OdpDocument, pageIds: readonly string[]): Promise<void> {
    const wanted = new Set(pageIds);
    const pages = this.pages().filter((page) => wanted.has(attr(page, 'xml:id') ?? ''));
    const styles = this.takeStylesFrom(from, pages);
    await this.takePicturesFrom(from, [...pages, ...styles]);
  }

  /**
   * Puts the pictures `nodes` (slides, styles) show that this package no longer has back in from
   * `from` – at their paths, as there. The paths as the attributes have them, entities decoded.
   */
  private async takePicturesFrom(from: OdpDocument, nodes: readonly XmlNode[]): Promise<void> {
    const paths = new Set<string>();
    for (const root of nodes) {
      for (const node of [root, ...descendants(root)]) {
        const href = attr(node, 'xlink:href');
        if (href?.startsWith('Pictures/') && isPackagePath(href)) paths.add(href);
        for (const path of fillsMarkPictures(node)) if (isPackagePath(path)) paths.add(path);
      }
    }
    for (const path of paths) {
      if (this.archive.has(path)) continue;
      const bytes = await from.picture(path);
      if (!bytes) continue;
      this.archive.write(path, bytes, false);
      this.addToManifest(path, from.manifestType(path) ?? 'application/octet-stream');
    }
  }

  /**
   * Changes whenever the design changes – styles.xml: master pages, their styles, page layouts –
   * and only then; slides and their own styles leave it as it is.
   */
  designFingerprint(): string {
    return createHash('sha256')
      .update(xmlOf(...this.styles.nodes))
      .digest('hex')
      .slice(0, 32);
  }

  /**
   * This file as a design to take layouts from ({@link takeMasterPageFrom}): the pictures of its
   * styles read ahead, so an operation can take them in at once.
   */
  async design(): Promise<OdpDesign> {
    const styles = this.root(this.styles, 'office:document-styles');
    const pictures = new Map<string, { bytes: Uint8Array; mediaType: string }>();
    for (const path of styles ? picturePathsIn(xmlOf(styles)) : []) {
      const bytes = await this.picture(path);
      if (bytes)
        pictures.set(path, {
          bytes,
          mediaType: this.manifestType(path) ?? 'application/octet-stream',
        });
    }
    return { document: this, pictures };
  }

  /** Layout `index` of `design` (its master pages in file order), taken in: its name here. */
  private takeLayoutFrom(design: OdpDesign | undefined, index: number): string {
    const page = design?.document.masterPages()[index];
    if (!design || !page) {
      throw new OdpError('operation', 'Dieses Layout gibt es in der Vorlage nicht mehr.');
    }
    return this.takeMasterPageFrom(design, page.name);
  }

  /**
   * Takes master page `name` of `design` – a template's layout – into this file, with what it
   * needs: its page layout and page style, its presentation styles (`<name>-title`,
   * `<name>-outline1` …, which slides on it take their look from), every style those name in
   * turn, their fonts' declarations and pictures. A master page of that name already here and
   * just the same is used as it is; one that differs stays, and the new one comes in under a name
   * of its own (`<name>_2`), so do its styles whose names are taken by others. Returns the
   * master page's name here. A design of another page shape does not fit.
   */
  takeMasterPageFrom(design: OdpDesign, name: string): string {
    const from = design.document;
    const source = from.stylesParts();
    const master = (source.masters ? elementChildren(source.masters) : []).find(
      (node) => tagOf(node) === 'style:master-page' && attr(node, 'style:name') === name,
    );
    if (!master)
      throw new OdpError('operation', 'Dieses Layout gibt es in der Vorlage nicht mehr.');
    const ours = this.pageSize();
    const theirs = from.pageSize();
    if (Math.abs(ours.width / ours.height - theirs.width / theirs.height) > SAME_SHAPE) {
      throw new OdpError('operation', 'Diese Vorlage hat ein anderes Seitenformat.');
    }
    const own = this.stylesParts(true);
    if (!own.masters || !own.automatic || !own.common || !own.fonts) {
      throw new OdpError('operation', 'In diese Datei lässt sich kein Layout übernehmen.');
    }
    const masters = elementChildren(own.masters).filter(
      (node) => tagOf(node) === 'style:master-page',
    );
    const existing = masters.find((node) => attr(node, 'style:name') === name);

    // What the master page needs: its page layout and style, its presentation styles, and all
    // they name – a common style names only common ones.
    const byKey = new Map<string, { node: XmlNode; common: boolean }>();
    const byName = new Map<string, string[]>();
    for (const [container, common] of [
      [source.automatic, false],
      [source.common, true],
    ] as const) {
      for (const node of container ? elementChildren(container) : []) {
        const key = styleKey(node);
        if (!key || byKey.has(key)) continue;
        byKey.set(key, { node, common });
        const plain = key.slice(key.indexOf(KEY_SEPARATOR) + 1);
        byName.set(plain, [...(byName.get(plain) ?? []), key]);
      }
    }
    const wanted: string[] = [];
    const want = (key: string, inCommon: boolean) => {
      const found = byKey.get(key);
      if (!found || wanted.includes(key) || (inCommon && !found.common)) return;
      wanted.push(key);
    };
    const follow = (root: XmlNode, inCommon: boolean) => {
      const family = tagOf(root) === 'style:style' ? attr(root, 'style:family') : undefined;
      for (const node of root === master ? descendants(root) : [root, ...descendants(root)]) {
        for (const { attribute, name: named } of styleReferencesOf(node)) {
          const kinds = referencedKinds(node, attribute, family);
          const keys =
            kinds === null
              ? (byName.get(named) ?? [])
              : kinds.map((kind) => `${kind}${KEY_SEPARATOR}${named}`);
          for (const key of keys) want(key, inCommon);
        }
      }
    };
    const masterLayout = attr(master, 'style:page-layout-name');
    if (masterLayout) want(`style:page-layout${KEY_SEPARATOR}${masterLayout}`, false);
    const masterStyle = attr(master, 'draw:style-name');
    if (masterStyle) want(`style:drawing-page${KEY_SEPARATOR}${masterStyle}`, false);
    for (const key of byKey.keys()) {
      if (key.startsWith(`style:presentation${KEY_SEPARATOR}${name}-`)) want(key, true);
    }
    follow(master, false);
    for (let i = 0; i < wanted.length; i += 1) {
      const { node, common } = byKey.get(wanted[i] as string)!;
      follow(node, common);
    }

    // Names here. A style just the same is used; one that differs keeps its name, and the new
    // one gets a name made of its content (`Mdp1_3fa2c1d0`) – taken again, it is named the same
    // and found here. The master page's presentation styles go with its name.
    const ownByKey = new Map<string, XmlNode>();
    for (const container of [own.automatic, own.common]) {
      for (const node of elementChildren(container)) {
        const key = styleKey(node);
        if (key && !ownByKey.has(key)) ownByKey.set(key, node);
      }
    }
    const plan = (target: string) => {
      const renames = new Map<string, string>();
      const copies: { node: XmlNode; common: boolean }[] = [];
      for (const key of wanted) {
        const { node, common } = byKey.get(key)!;
        const kind = key.slice(0, key.indexOf(KEY_SEPARATOR));
        const plain = key.slice(key.indexOf(KEY_SEPARATOR) + 1);
        let renamed = plain;
        if (target !== name && kind === 'style:presentation' && plain.startsWith(`${name}-`)) {
          renamed = `${target}${plain.slice(name.length)}`;
        } else {
          const here = ownByKey.get(key);
          if (here && sameNode(here, node)) continue;
          if (here) renamed = `${plain}_${contentHash(node)}`;
        }
        if (renamed !== plain) renames.set(plain, renamed);
        // Taken in before, under the name its content gives it.
        if (renamed !== plain && ownByKey.has(`${kind}${KEY_SEPARATOR}${renamed}`)) continue;
        copies.push({ node: structuredClone(node), common });
      }
      const page = structuredClone(master);
      renameStyleReferences([page, ...copies.map((copy) => copy.node)], renames);
      for (const { node } of copies) {
        for (const attribute of ['style:name', 'draw:name']) {
          const value = attr(node, attribute);
          const renamedTo = value === undefined ? undefined : renames.get(value);
          if (renamedTo) setAttr(node, attribute, renamedTo);
        }
      }
      if (target !== name) setAttr(page, 'style:name', target);
      return { page, copies };
    };
    const prefix = `style:presentation${KEY_SEPARATOR}${name}-`;
    let planned: ReturnType<typeof plan> | null = null;
    if (existing) {
      // The same master page taken in before: its styles named as they were then.
      const asBefore = plan(name);
      if (sameNode(existing, asBefore.page)) return name;
    } else if (![...ownByKey.keys()].some((key) => key.startsWith(prefix))) {
      planned = plan(name);
    }
    let newName = name;
    if (!planned) {
      // Another master page of that name (or its presentation styles, left without it) is here.
      newName = `${name}_${contentHash(master)}`;
      if (masters.some((node) => attr(node, 'style:name') === newName)) return newName;
      planned = plan(newName);
      const shown = attr(master, 'style:display-name') ?? name;
      const alike = masters.filter((node) =>
        (attr(node, 'style:display-name') ?? attr(node, 'style:name') ?? '').startsWith(shown),
      ).length;
      const newShown = `${shown} (${alike + 1})`;
      setAttr(planned.page, 'style:display-name', newShown);
      // LibreOffice finds a master page's presentation styles by its display name.
      for (const { node } of planned.copies) {
        const style = attr(node, 'style:display-name');
        if (attr(node, 'style:family') === 'presentation' && style?.startsWith(`${shown}-`)) {
          setAttr(node, 'style:display-name', `${newShown}${style.slice(shown.length)}`);
        }
      }
    }
    const { page: newMaster, copies } = planned;

    // The fonts their text is set in, where this file does not declare them.
    const declared = new Set(elementChildren(own.fonts).map((node) => attr(node, 'style:name')));
    const theirFonts = new Map(
      (source.fonts ? elementChildren(source.fonts) : []).map((node) => [
        attr(node, 'style:name'),
        node,
      ]),
    );
    for (const node of [newMaster, ...copies.map((copy) => copy.node)]) {
      for (const child of [node, ...descendants(node)]) {
        for (const { attribute, name: font } of styleReferencesOf(child)) {
          if (!attribute.startsWith('style:font-name') || declared.has(font)) continue;
          const decl = theirFonts.get(font);
          if (!decl) continue;
          childrenOf(own.fonts).push(structuredClone(decl));
          declared.add(font);
        }
      }
    }

    // Their prefixes declared too (`xlink:href` of a picture, …): a file another program wrote
    // may declare fewer, and an undeclared one is read as nothing.
    const ownRoot = this.root(this.styles, 'office:document-styles');
    const theirRoot = from.root(from.styles, 'office:document-styles');
    if (ownRoot && theirRoot) {
      for (const attribute of attributeNames(theirRoot)) {
        const value = attr(theirRoot, attribute);
        if (attribute.startsWith('xmlns:') && value && attr(ownRoot, attribute) === undefined) {
          setAttr(ownRoot, attribute, value);
        }
      }
    }
    for (const copy of copies) childrenOf(copy.common ? own.common : own.automatic).push(copy.node);
    childrenOf(own.masters).push(newMaster);
    this.dirty.styles = true;
    for (const path of picturePathsIn(xmlOf(newMaster, ...copies.map((copy) => copy.node)))) {
      const picture = design.pictures.get(path);
      if (!picture || this.archive.has(path)) continue;
      this.archive.write(path, picture.bytes, false);
      this.addToManifest(path, picture.mediaType);
    }
    return newName;
  }

  // ── Templates designed in Slider ────────────────────────────────────────

  /**
   * This presentation as a template (`.otp`) whose layouts are its slides: each slide of
   * `layouts` becomes a master page shown as its `name`, its elements the layout's decoration on
   * the look its master gave it. The elements `placeholders` names become what a slide fills in:
   * a text frame a title, subtitle or text placeholder in its own look (its frame's, its first
   * paragraph's), a picture frame where a picture goes. The old master pages and the slides go;
   * one empty slide on the first layout stays, as LibreOffice keeps one. Each layout's `guides`
   * (fractions of the page) go on its master page (`slider:guides`), which slides of decks made
   * from the template show again ({@link slideGuides}); those all layouts share also become
   * LibreOffice's snap lines, which are the whole file's.
   */
  toTemplate(layouts: readonly OdpTemplateLayout[]): void {
    if (layouts.length === 0) throw new OdpError('operation', 'Die Vorlage braucht ein Layout.');
    if (!this.idsEnsured) this.ensureIds();
    const own = this.stylesParts(true);
    if (!own.masters || !own.automatic || !own.common) {
      throw new OdpError('operation', 'Aus dieser Datei lässt sich keine Vorlage machen.');
    }
    const oldMasters = elementChildren(own.masters).filter(
      (node) => tagOf(node) === 'style:master-page',
    );
    const mastersByName = new Map(oldMasters.map((node) => [attr(node, 'style:name'), node]));
    const takenNames = new Set(
      [...elementChildren(own.automatic), ...elementChildren(own.common)].map(
        (node) => attr(node, 'style:name') ?? '',
      ),
    );
    const pageAutomatic = elementChildren(this.automaticStyles());
    const byKey = new Map<string, XmlNode>();
    const byName = new Map<string, string[]>();
    for (const node of pageAutomatic) {
      const key = styleKey(node);
      if (!key || byKey.has(key)) continue;
      byKey.set(key, node);
      const plain = key.slice(key.indexOf(KEY_SEPARATOR) + 1);
      byName.set(plain, [...(byName.get(plain) ?? []), key]);
    }

    const newMasters: XmlNode[] = [];
    const automaticCopies: XmlNode[] = [];
    const presentationStyles: XmlNode[] = [];
    const usedMasterNames = new Set(oldMasters.map((node) => attr(node, 'style:name')));
    // What each layout is shown as: LibreOffice finds a master page's presentation styles by it
    // (`<shown>-title`), so they take it too – unless two layouts are shown alike.
    const styleIndex = this.styleIndex();
    const shownAs = layouts.map((layout, index) => layout.name.trim() || `Layout ${index + 1}`);
    for (const [index, layout] of layouts.entries()) {
      const shown = shownAs[index]!;
      const bound = shownAs.indexOf(shown) === shownAs.lastIndexOf(shown);
      const page = this.page(this.slideIndexOf(layout.pageId));
      let name = `Slider_${index + 1}`;
      const presentationNamesTaken = (master: string) =>
        ['title', 'subtitle', 'outline1'].some((kind) => takenNames.has(`${master}-${kind}`));
      for (let n = 2; usedMasterNames.has(name) || presentationNamesTaken(name); n += 1) {
        name = `Slider_${index + 1}_${n}`;
      }
      usedMasterNames.add(name);
      const base =
        mastersByName.get(attr(page, 'draw:master-page-name')) ?? oldMasters[0] ?? undefined;
      // The old master's decoration first (not its placeholders), then the slide's elements –
      // none of it when the slide hides its master's shapes (one added with „Neue Folie“).
      const decoration = (
        base && !this.hidesMasterShapes(page) ? elementChildren(base) : []
      ).filter((node) => !attr(node, 'presentation:class') && tagOf(node) !== PICTURE_PLACEHOLDER);
      const elements = this.allShapesOf(page);
      const shapes = [...decoration, ...elements].map((node) => {
        const copy = structuredClone(node);
        for (const item of [copy, ...descendants(copy)]) removeAttr(item, 'xml:id');
        return copy;
      });

      // The page's automatic styles they name, and all those name in turn, renamed after the
      // layout – styles.xml's automatic styles are the master pages' own.
      const renames = new Map<string, string>();
      const copies: XmlNode[] = [];
      const seen = new Set<string>();
      const follow = (root: XmlNode) => {
        const family = tagOf(root) === 'style:style' ? attr(root, 'style:family') : undefined;
        for (const node of [root, ...descendants(root)]) {
          for (const { attribute, name: named } of styleReferencesOf(node)) {
            const kinds = referencedKinds(node, attribute, family);
            const keys =
              kinds === null
                ? (byName.get(named) ?? [])
                : kinds.map((kind) => `${kind}${KEY_SEPARATOR}${named}`);
            for (const key of keys) {
              const found = byKey.get(key);
              if (!found || seen.has(key)) continue;
              seen.add(key);
              renames.set(named, `${name}_${named}`);
              copies.push(structuredClone(found));
              follow(found);
            }
          }
        }
      };
      // Only the slide's elements name content.xml's styles: the decoration names styles.xml's
      // own, which stay – following (and renaming) its names there would take a look by mistake.
      const ownShapes = shapes.slice(decoration.length);
      for (const shape of ownShapes) follow(shape);
      // The slide's own background, when it has one; else its master's.
      let background = base ? attr(base, 'draw:style-name') : undefined;
      const pageStyle = attr(page, 'draw:style-name');
      const pageStyleNode =
        pageStyle && byKey.get(`style:drawing-page${KEY_SEPARATOR}${pageStyle}`);
      const pageFill = pageStyleNode && firstChild(pageStyleNode, 'style:drawing-page-properties');
      if (pageStyleNode && pageFill && (attr(pageFill, 'draw:fill') ?? 'none') !== 'none') {
        const copy = structuredClone(pageStyleNode);
        follow(copy);
        background = `${name}_${pageStyle}`;
        setAttr(copy, 'style:name', background);
        copies.push(copy);
      }
      renameStyleReferences([...ownShapes, ...copies], renames);
      for (const copy of copies) {
        const renamed = renames.get(attr(copy, 'style:name') ?? '');
        if (renamed) setAttr(copy, 'style:name', renamed);
      }
      const copied = new Map(
        copies.map((copy) => [styleKey(copy) ?? '', copy] as const).filter(([key]) => key),
      );
      const copiedStyle = (family: string, styleName: string | undefined) =>
        styleName ? copied.get(`style:${family}${KEY_SEPARATOR}${styleName}`) : undefined;

      // The placeholders: a text frame takes a presentation style of the layout, the first of a
      // kind giving it its look, each further one its own over that; a picture frame becomes
      // Slider's mark.
      const ownLooks: XmlNode[] = [];
      const children = shapes.map((shape, at) => {
        const id =
          at >= decoration.length ? attr(elements[at - decoration.length]!, 'xml:id') : undefined;
        const kind = id ? layout.placeholders[id] : undefined;
        if (!kind) {
          removeAttr(shape, 'presentation:class');
          removeAttr(shape, 'presentation:placeholder');
          return shape;
        }
        const box = ['svg:x', 'svg:y', 'svg:width', 'svg:height'].map((key) => attr(shape, key));
        if (kind === 'picture') {
          if (box.some((value) => value === undefined)) return shape;
          const [x, y, width, height] = box as string[];
          return element(PICTURE_PLACEHOLDER, {
            'svg:x': x as string,
            'svg:y': y as string,
            'svg:width': width as string,
            'svg:height': height as string,
          });
        }
        const styleName = `${name}-${kind === 'outline' ? 'outline1' : kind}`;
        // Its look: its frame's, its first paragraph's – the first of a kind's as the layout's
        // style for it, each further one's over that as its own (an automatic style).
        const look = () => {
          const paragraph = findDescendant(shape, 'text:p');
          const span = paragraph && findDescendant(paragraph, 'text:span');
          const graphic = copiedStyle('graphic', attr(shape, 'draw:style-name'));
          const paragraphStyle = copiedStyle(
            'paragraph',
            paragraph && attr(paragraph, 'text:style-name'),
          );
          const spanStyle = copiedStyle('text', span && attr(span, 'text:style-name'));
          const properties = (style: XmlNode | undefined, tag: string) =>
            style ? firstChild(style, tag) : undefined;
          const text = [
            properties(paragraphStyle, 'style:text-properties'),
            properties(spanStyle, 'style:text-properties'),
          ]
            .filter((node): node is XmlNode => node !== undefined)
            .reduce<XmlNode | null>((merged, node) => {
              if (!merged) return structuredClone(node);
              for (const key of attributeNames(node)) setAttr(merged, key, attr(node, key) ?? '');
              return merged;
            }, null);
          // The frame's whole graphic look as the editor showed it – what its parents (the file's
          // „standard“) give it too, and a text frame's defaults (padding, no fill, no line) –
          // as LibreOffice takes nothing else for a placeholder.
          const box = structuredClone(
            properties(graphic, 'style:graphic-properties') ?? element('style:graphic-properties'),
          );
          const original = at >= decoration.length ? elements[at - decoration.length] : undefined;
          const ownStyle = original && attr(original, 'draw:style-name');
          const inherited: Record<string, string> = {
            'draw:fill': 'none',
            'draw:stroke': 'none',
            'fo:padding-top': '0.125cm',
            'fo:padding-bottom': '0.125cm',
            'fo:padding-left': '0.25cm',
            'fo:padding-right': '0.25cm',
            ...Object.assign(
              {},
              ...(ownStyle ? styleIndex.chain('graphic', ownStyle) : []).map((style) =>
                styleIndex.propertiesOf(style, 'graphic'),
              ),
            ),
          };
          const padding = attr(box, 'fo:padding');
          for (const [key, value] of Object.entries(inherited)) {
            if (padding !== undefined && key.startsWith('fo:padding-')) continue;
            if (attr(box, key) === undefined) setAttr(box, key, value);
          }
          return [box, properties(paragraphStyle, 'style:paragraph-properties'), text]
            .filter((node): node is XmlNode => Boolean(node))
            .map((node) => structuredClone(node));
        };
        let presentationStyle = styleName;
        if (!presentationStyles.some((style) => attr(style, 'style:name') === styleName)) {
          const suffix = styleName.slice(name.length);
          presentationStyles.push(
            element(
              'style:style',
              {
                'style:name': styleName,
                ...(bound ? { 'style:display-name': `${shown}${suffix}` } : {}),
                'style:family': 'presentation',
              },
              look(),
            ),
          );
        } else {
          let n = 2;
          const own = (at: number) => `${name}_${kind}${at}`;
          const named = (at: number) =>
            takenNames.has(own(at)) ||
            [...copies, ...ownLooks].some((style) => attr(style, 'style:name') === own(at));
          while (named(n)) n += 1;
          presentationStyle = own(n);
          ownLooks.push(
            element(
              'style:style',
              {
                'style:name': presentationStyle,
                'style:family': 'presentation',
                'style:parent-style-name': styleName,
              },
              look(),
            ),
          );
        }
        setAttr(shape, 'presentation:class', kind);
        setAttr(shape, 'presentation:style-name', presentationStyle);
        // Its text is what a slide's empty placeholder asks for (LibreOffice's master texts not).
        setAttr(shape, PROMPT_MARK, 'true');
        removeAttr(shape, 'presentation:placeholder');
        removeAttr(shape, 'draw:style-name');
        removeAttr(shape, 'draw:text-style-name');
        return shape;
      });

      const master = element(
        'style:master-page',
        {
          'style:name': name,
          'style:display-name': shown,
          ...(base && attr(base, 'style:page-layout-name')
            ? { 'style:page-layout-name': attr(base, 'style:page-layout-name') as string }
            : {}),
          ...(background ? { 'draw:style-name': background } : {}),
          // Written even when it has none: a layout without guides takes no snap lines.
          [GUIDES_MARK]: this.snapLinesOf(layout.guides),
        },
        children,
      );
      newMasters.push(master);
      automaticCopies.push(...copies, ...ownLooks);
    }

    childrenOf(own.automatic).push(...automaticCopies);
    childrenOf(own.common).push(...presentationStyles);
    const masterList = childrenOf(own.masters);
    for (const old of oldMasters) removeChild(own.masters, old);
    masterList.push(...newMasters);
    const stylesRoot = this.root(this.styles, 'office:document-styles');
    if (stylesRoot && attr(stylesRoot, 'xmlns:slider') === undefined)
      setAttr(stylesRoot, 'xmlns:slider', SLIDER_NS);
    this.dirty.styles = true;

    // One empty slide on the first layout.
    const count = this.pages().length;
    this.addSlide(0, { master: attr(newMasters[0]!, 'style:name') as string });
    for (let i = 0; i < count; i += 1) this.removeSlide(1);
    this.markAsTemplate();
    const [firstLayout, ...otherLayouts] = layouts;
    this.writeGuides(
      (firstLayout?.guides ?? []).filter((guide) =>
        otherLayouts.every((layout) =>
          layout.guides.some(
            (other) => other.orientation === guide.orientation && other.position === guide.position,
          ),
        ),
      ),
    );
  }

  /** A presentation marked as a template, so it opens as an `.otp`. */
  markAsTemplate(): void {
    this.archive.write('mimetype', OTP_MIME, false);
    const root = this.manifest && this.root(this.manifest, 'manifest:manifest');
    const entry = root && childrenOf(root).find((node) => attr(node, 'manifest:full-path') === '/');
    if (entry && attr(entry, 'manifest:media-type') !== OTP_MIME) {
      setAttr(entry, 'manifest:media-type', OTP_MIME);
      this.dirty.manifest = true;
    }
  }

  /**
   * LibreOffice's snap lines (`SnapLinesDrawing` in settings.xml), as fractions of the page –
   * the guides a template brings along. Points are left out.
   */
  async guides(): Promise<OdpGuide[]> {
    if (!this.archive.has('settings.xml')) return [];
    const settings = await this.archive.readText('settings.xml');
    const value = /config:name="SnapLinesDrawing"[^>]*>([^<]*)</.exec(settings)?.[1]?.trim() ?? '';
    return this.guidesOf(value);
  }

  /**
   * The guides of each slide's layout, in order: a master page designed in Slider carries its own
   * (`slider:guides`); `null` for a slide on any other.
   */
  layoutGuides(): (OdpGuide[] | null)[] {
    const styles = this.root(this.styles, 'office:document-styles');
    const masters = styles && firstChild(styles, 'office:master-styles');
    const byMaster = new Map<string, OdpGuide[]>();
    for (const master of masters ? childrenOf(masters) : []) {
      const name = tagOf(master) === 'style:master-page' ? attr(master, 'style:name') : undefined;
      const value = attr(master, GUIDES_MARK);
      if (name && value !== undefined) byMaster.set(name, this.guidesOf(value));
    }
    return this.pages().map(
      (page) => byMaster.get(attr(page, 'draw:master-page-name') ?? '') ?? null,
    );
  }

  /**
   * The guides of each slide, in order: those of its layout ({@link layoutGuides}), else the
   * file's snap lines ({@link guides}) – a template from before its layouts had guides of their
   * own, or a file from elsewhere.
   */
  async slideGuides(): Promise<OdpGuide[][]> {
    const own = this.layoutGuides();
    const file = own.every(Boolean) ? [] : await this.guides();
    return own.map((guides) => guides ?? file);
  }

  /** Snap lines (`V…H…P…`, 1/100 mm from the page's corner) as fractions of the page; no points. */
  private guidesOf(value: string): OdpGuide[] {
    const size = this.pageSize();
    const guides: OdpGuide[] = [];
    for (const [, kind, at] of value.matchAll(/([VHP])(-?\d+)(?:,-?\d+)?/g)) {
      if (kind === 'P') continue;
      const vertical = kind === 'V';
      // 1/100 mm from the page's corner.
      const position = Number(at) / 1000 / (vertical ? size.width : size.height);
      if (position >= 0 && position <= 1) {
        guides.push({ orientation: vertical ? 'vertical' : 'horizontal', position });
      }
    }
    return guides;
  }

  /** `guides` as LibreOffice writes snap lines (`V…H…`, 1/100 mm from the page's corner). */
  private snapLinesOf(guides: readonly OdpGuide[]): string {
    const size = this.pageSize();
    return guides
      .map((guide) =>
        guide.orientation === 'vertical'
          ? `V${Math.round(guide.position * size.width * 1000)}`
          : `H${Math.round(guide.position * size.height * 1000)}`,
      )
      .join('');
  }

  /** Writes `guides` as LibreOffice's snap lines, in a settings.xml of their own. */
  private writeGuides(guides: readonly OdpGuide[]): void {
    const lines = this.snapLinesOf(guides);
    this.archive.write(
      'settings.xml',
      `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-settings xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" office:version="1.3"><office:settings><config:config-item-set config:name="ooo:view-settings"><config:config-item-map-indexed config:name="Views"><config:config-item-map-entry><config:config-item config:name="SnapLinesDrawing" config:type="string">${lines}</config:config-item></config:config-item-map-entry></config:config-item-map-indexed></config:config-item-set></office:settings></office:document-settings>`,
    );
    if (this.manifestType('settings.xml') === null) this.addToManifest('settings.xml', 'text/xml');
  }

  /**
   * styles.xml's font declarations, common and automatic styles and master pages – with
   * `create`, made where the file has none, in the order ODF gives them.
   */
  private stylesParts(create = false): {
    fonts: XmlNode | undefined;
    common: XmlNode | undefined;
    automatic: XmlNode | undefined;
    masters: XmlNode | undefined;
  } {
    const root = this.root(this.styles, 'office:document-styles');
    const part = (tag: string) => {
      if (!root) return undefined;
      let node = firstChild(root, tag);
      if (!node && create) {
        node = element(tag);
        const siblings = childrenOf(root);
        const at = siblings.findIndex(
          (sibling) => STYLES_ORDER.indexOf(tagOf(sibling) ?? '') > STYLES_ORDER.indexOf(tag),
        );
        siblings.splice(at === -1 ? siblings.length : at, 0, node);
        this.dirty.styles = true;
      }
      return node;
    };
    return {
      fonts: part('office:font-face-decls'),
      common: part('office:styles'),
      automatic: part('office:automatic-styles'),
      masters: part('office:master-styles'),
    };
  }

  /**
   * Copies from `from` the styles `pages` name that this document lacks, and in turn everything
   * they need that it lacks too: parent styles, list styles and the text styles their levels
   * name, number styles, gradients, hatches, fill pictures, transparencies, markers and dash
   * patterns, followed as deep as they go. Styles this document has stay as they are, and so does
   * what they name.
   *
   * A name means a style of one family (or one kind of named thing: a gradient, a list style, …)
   * – ODF lets a paragraph style and a graphic style share a name –, so each reference is
   * followed by its family as well ({@link styleKey}, {@link referencedKinds}). And it means
   * what a slide can name: content.xml's automatic styles or styles.xml's common ones. styles.xml's
   * automatic styles are the master pages' – a name there that a slide's style has too is another
   * style, never taken for it (nor does it count as one this document has); one only there is
   * taken as the last resort, as a file that named it from a slide still showed it. A style named
   * from a common style can only be a common one. A common style comes back among the common
   * styles of styles.xml (only those can be parents), an automatic one among content.xml's
   * automatic styles. Master pages and page layouts belong to the design, not to a slide: they
   * are not copied, nor are font declarations, which no edit removes. Returns the styles copied,
   * for the pictures they show ({@link takePicturesFrom}).
   */
  private takeStylesFrom(from: OdpDocument, pages: readonly XmlNode[]): XmlNode[] {
    const own = this.styleScope();
    const have = new Set([...styleKeysIn(own.automatic), ...styleKeysIn(own.common)]);
    const copied = from
      .stylesNamedBy(pages, have)
      .map((style) => ({ node: structuredClone(style.node), common: style.common }));
    if (copied.length === 0) return [];

    // A file without styles.xml (hardly a deck) has only content.xml to keep them in.
    const commonStyles = copied.some((style) => style.common) ? this.commonStyles() : undefined;
    for (const style of copied) {
      if (style.common && commonStyles) {
        childrenOf(commonStyles).push(style.node);
        this.dirty.styles = true;
      } else {
        childrenOf(this.automaticStyles()).push(style.node);
        this.dirty.content = true;
      }
    }
    return copied.map((style) => style.node);
  }

  /** Where this file keeps the styles a slide can name ({@link takeStylesFrom}). */
  private styleScope() {
    const content = this.root(this.content, 'office:document-content');
    const styles = this.root(this.styles, 'office:document-styles');
    return {
      automatic: content && firstChild(content, 'office:automatic-styles'),
      common: styles && firstChild(styles, 'office:styles'),
      mastersAutomatic: styles && firstChild(styles, 'office:automatic-styles'),
    };
  }

  /**
   * This file's styles `pages` (slides, elements) name and a file with the styles `have` (their
   * keys) lacks, with everything they name in turn – as {@link takeStylesFrom} finds them, not
   * copied.
   */
  private stylesNamedBy(
    pages: readonly XmlNode[],
    have: ReadonlySet<string>,
  ): { node: XmlNode; common: boolean }[] {
    /** This file's styles by key, in the order a slide's reference finds them; `common` or not. */
    const source = this.styleScope();
    const byKey = new Map<string, { node: XmlNode; common: boolean }>();
    const byName = new Map<string, string[]>();
    for (const [container, common] of [
      [source.automatic, false],
      [source.common, true],
      [source.mastersAutomatic, false],
    ] as const) {
      for (const node of container ? elementChildren(container) : []) {
        const key = styleKey(node);
        if (!key || byKey.has(key) || NOT_SLIDE_STYLES.has(tagOf(node) ?? '')) continue;
        byKey.set(key, { node, common });
        const name = key.slice(key.indexOf(KEY_SEPARATOR) + 1);
        byName.set(name, [...(byName.get(name) ?? []), key]);
      }
    }

    const found: { node: XmlNode; common: boolean }[] = [];
    const seen = new Set<string>();
    const queue: string[] = [];
    /** What `root` (a slide, or a style – `inCommon`: a common one) names, wanted when missing. */
    const follow = (root: XmlNode, inCommon: boolean) => {
      const family = tagOf(root) === 'style:style' ? attr(root, 'style:family') : undefined;
      for (const node of [root, ...descendants(root)]) {
        for (const { attribute, name } of styleReferencesOf(node)) {
          const kinds = referencedKinds(node, attribute, family);
          const keys =
            kinds === null
              ? (byName.get(name) ?? [])
              : kinds.map((kind) => `${kind}${KEY_SEPARATOR}${name}`);
          for (const key of keys) {
            if (have.has(key) || seen.has(key)) continue;
            const style = byKey.get(key);
            if (!style || (inCommon && !style.common)) continue;
            seen.add(key);
            queue.push(key);
          }
        }
      }
    };
    for (const page of pages) follow(page, false);
    // Every key once: parents naming each other in a circle end too.
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
      const style = byKey.get(key) as { node: XmlNode; common: boolean };
      found.push(style);
      follow(style.node, style.common);
    }
    return found;
  }

  /**
   * styles.xml's common styles, created – in the place ODF gives them – when the file has none;
   * `undefined` for a file without styles.xml.
   */
  private commonStyles(): XmlNode | undefined {
    const root = this.root(this.styles, 'office:document-styles');
    if (!root) return undefined;
    let common = firstChild(root, 'office:styles');
    if (!common) {
      common = element('office:styles');
      const siblings = childrenOf(root);
      const after = siblings.findIndex((node) =>
        ['office:automatic-styles', 'office:master-styles'].includes(tagOf(node) ?? ''),
      );
      siblings.splice(after === -1 ? siblings.length : after, 0, common);
    }
    return common;
  }

  private manifestType(path: string): string | null {
    const root = this.manifest && this.root(this.manifest, 'manifest:manifest');
    const entry =
      root && childrenOf(root).find((node) => attr(node, 'manifest:full-path') === path);
    return (entry && attr(entry, 'manifest:media-type')) || null;
  }

  /** The deck's common styles and master pages, one line each (`tag family name`). */
  styleCatalog(): string[] {
    const styles = this.root(this.styles, 'office:document-styles');
    return [
      firstChild(styles ?? {}, 'office:styles'),
      firstChild(styles ?? {}, 'office:master-styles'),
    ]
      .flatMap((container) => (container ? elementChildren(container) : []))
      .flatMap((node) => {
        const name = attr(node, 'style:name') ?? attr(node, 'draw:name');
        if (!name) return [];
        const family = attr(node, 'style:family');
        return [[tagOf(node), family, name].filter(Boolean).join(' ')];
      });
  }

  /**
   * Adds styles written from outside (the AI) – `style:style`, `text:list-style` and number
   * styles to content.xml's automatic styles, gradients, hatches and the like to styles.xml.
   * Existing styles are shared with other slides and stay: a name already taken is refused,
   * unless it is in `replace` (written in the same session) or `keepExisting` (applying stored
   * styles again). Returns the names added.
   */
  addStyles(
    xml: string,
    {
      replace = new Set(),
      keepExisting = false,
    }: { replace?: ReadonlySet<string>; keepExisting?: boolean } = {},
  ): string[] {
    const nodes = authoredNodes(xml, 'styles');
    const content = this.root(this.content, 'office:document-content');
    const styles = this.root(this.styles, 'office:document-styles');
    const automatic = content && firstChild(content, 'office:automatic-styles');
    const common = styles && firstChild(styles, 'office:styles');
    const existing = this.namedStyles();
    const names = new Set(existing.map((style) => style.name));
    const added: { name: string; node: XmlNode; container: XmlNode; part: 'content' | 'styles' }[] =
      [];
    const problems: string[] = [];
    for (const node of nodes) {
      const tag = tagOf(node) ?? '';
      const name = attr(node, 'style:name') ?? attr(node, 'draw:name');
      const inContent = AUTOMATIC_STYLE_TAGS.has(tag) || tag.startsWith('number:');
      const container = inContent ? automatic : COMMON_STYLE_TAGS.has(tag) ? common : undefined;
      if (!container) {
        problems.push(`<${tag}> cannot be added as a style.`);
        continue;
      }
      if (!name) {
        problems.push(`<${tag}> needs a style:name (or draw:name).`);
        continue;
      }
      if (names.has(name) && keepExisting) continue;
      if (names.has(name) && !replace.has(name)) {
        problems.push(
          `The style ${name} exists already and is shared with other slides – give your new style a name of its own.`,
        );
        continue;
      }
      added.push({ name, node, container, part: inContent ? 'content' : 'styles' });
    }
    const known = new Set([...names, ...added.map((style) => style.name)]);
    for (const { node } of added) problems.push(...this.authoredProblems(node, known));
    if (problems.length > 0) throw new OdpError('operation', problems.join('\n'));
    // A parent among the automatic styles is ignored by LibreOffice: what was meant is taken in.
    this.inheritAutomaticParents(
      added.filter((style) => style.part === 'content').map((style) => style.node),
    );
    for (const style of added) {
      for (const old of existing.filter(
        (item) => item.name === style.name && item.container === style.container,
      )) {
        removeChild(old.container, old.node);
      }
      childrenOf(style.container).push(style.node);
      if (style.part === 'content') this.dirty.content = true;
      else this.dirty.styles = true;
    }
    return added.map((style) => style.name);
  }

  /**
   * Automatic styles about to be added (`nodes`) whose parent is another automatic style – theirs
   * or content.xml's – take its properties in ({@link inheritAutomaticParents}).
   */
  private inheritAutomaticParents(nodes: readonly XmlNode[]): void {
    const content = this.root(this.content, 'office:document-content');
    const styles = this.root(this.styles, 'office:document-styles');
    const automatic = content && firstChild(content, 'office:automatic-styles');
    const common = styles && firstChild(styles, 'office:styles');
    const find = (list: readonly XmlNode[], family: string, name: string) =>
      list.find(
        (node) =>
          tagOf(node) === 'style:style' &&
          attr(node, 'style:name') === name &&
          attr(node, 'style:family') === family,
      );
    const existing = automatic ? elementChildren(automatic) : [];
    const commons = common ? elementChildren(common) : [];
    for (const node of nodes) {
      if (tagOf(node) !== 'style:style') continue;
      inheritAutomaticParents(
        node,
        (family, name) => find(nodes, family, name) ?? find(existing, family, name),
        (family, name) => find(commons, family, name) !== undefined,
      );
    }
  }

  /**
   * Adds the styles a stored change brought along (the AI's): a style that is there already as
   * it is stays, one whose name another style took meanwhile – another change's – gets a name
   * of its own. Returns those renames (old → new) for the change's slides to follow.
   */
  addOwnStyles(xml: string): Map<string, string> {
    const nodes = authoredNodes(xml, 'styles');
    const nameOf = (node: XmlNode) => attr(node, 'style:name') ?? attr(node, 'draw:name');
    const existing = new Map<string, XmlNode[]>();
    for (const style of this.namedStyles()) {
      existing.set(style.name, [...(existing.get(style.name) ?? []), style.node]);
    }
    // Compared as they would go in: a parent among the automatic styles taken in.
    this.inheritAutomaticParents(nodes);
    const taken = new Set([...existing.keys(), ...nodes.map(nameOf).filter(Boolean)]);
    const renames = new Map<string, string>();
    for (const node of nodes) {
      const name = nameOf(node);
      const there = name ? existing.get(name) : undefined;
      if (!name || !there || there.some((old) => sameNode(old, node))) continue;
      let n = 2;
      while (taken.has(`${name}-${n}`)) n += 1;
      renames.set(name, `${name}-${n}`);
      taken.add(`${name}-${n}`);
    }
    renameStyleReferences(nodes, renames);
    for (const node of nodes) {
      for (const attribute of ['style:name', 'draw:name']) {
        const renamed = renames.get(attr(node, attribute) ?? '');
        if (renamed) setAttr(node, attribute, renamed);
      }
    }
    const renamed = xmlOf(...nodes);
    if (renamed) this.addStyles(renamed, { keepExisting: true });
    return renames;
  }

  /**
   * Replaces a slide by a `draw:page` written from outside (the AI): links out, scripts and
   * embedded data are removed, every style, master page and picture it names must exist, ids
   * taken elsewhere are dropped and missing ones added, animations of shapes no longer there go.
   * The slide keeps its page id. `trusted` skips the checks for XML that was the slide's before
   * (taking a change back).
   */
  replaceSlide(index: number, xml: string, { trusted = false }: { trusted?: boolean } = {}): void {
    const old = this.page(index);
    const page = this.pageFrom(xml, trusted, styleReferences(old));
    if (!trusted) this.assertLocksKept(old, page);
    const pageId = attr(old, 'xml:id');
    if (pageId) setAttr(page, 'xml:id', pageId);
    const siblings = childrenOf(this.presentation() as XmlNode);
    siblings[siblings.indexOf(old)] = page;
    this.settle(page);
  }

  /**
   * A slide written from outside keeps its locked elements where they are (`setLocked`): each one
   * still on it keeps its place, size, turn and lock – gone (deleted) is fine, as in the editor.
   */
  private assertLocksKept(old: XmlNode, page: XmlNode): void {
    const styles = this.styleIndex();
    const locked = this.shapesOf(old).filter(
      (node) => attr(node, 'xml:id') && readLocked(styles, node),
    );
    if (locked.length === 0) return;
    const byId = new Map(
      this.shapesOf(page).map((node) => [attr(node, 'xml:id') ?? '', node] as const),
    );
    const near = (a: CmBox | null, b: CmBox | null) =>
      !!a &&
      !!b &&
      Math.abs(a.x - b.x) < 1e-3 &&
      Math.abs(a.y - b.y) < 1e-3 &&
      Math.abs(a.w - b.w) < 1e-3 &&
      Math.abs(a.h - b.h) < 1e-3;
    const moved: string[] = [];
    for (const node of locked) {
      const id = attr(node, 'xml:id') as string;
      const now = byId.get(id);
      if (!now) continue;
      const kept =
        readLocked(styles, now) &&
        near(boxOf(node), boxOf(now)) &&
        (attr(node, 'draw:transform') ?? '') === (attr(now, 'draw:transform') ?? '');
      if (!kept) moved.push(attr(node, 'draw:name') ?? id);
    }
    if (moved.length > 0) {
      throw new OdpError(
        'operation',
        `Locked in place by the user – keep their place, size, turn and lock: ${moved.join(', ')}.`,
      );
    }
  }

  /**
   * Inserts a `draw:page` as slide `index` (0-based; the number of slides appends) and returns
   * its page id. Written from outside it is checked and cleaned like {@link replaceSlide} and gets
   * an id of its own; `trusted` XML (a slide taken back) keeps its id, which must be free.
   */
  insertSlide(index: number, xml: string, { trusted = false }: { trusted?: boolean } = {}): string {
    const page = this.pageFrom(xml, trusted, []);
    const pageId = attr(page, 'xml:id');
    if (trusted) {
      if (!pageId || this.pageIds().includes(pageId)) {
        throw new OdpError(
          'operation',
          'Diese Folie lässt sich nicht zurückholen – es gibt sie schon.',
        );
      }
    } else if (pageId) {
      removeAttr(page, 'xml:id');
    }
    this.place(page, index);
    this.settle(page);
    return attr(page, 'xml:id') as string;
  }

  /**
   * Copies slide `index` to `at` (0-based, counted before the copy; default: right after it)
   * with ids of its own – animations and connectors follow – and returns the copy's page id.
   */
  duplicateSlide(index: number, at = index + 1): string {
    const copy = structuredClone(this.page(index));
    // Each element keeps who it was (the morph transition finds it on the next slide).
    for (const node of this.shapesOf(copy)) {
      const id = attr(node, 'xml:id');
      if (id && attr(node, MORPH_KEY) === undefined) setAttr(node, MORPH_KEY, id);
    }
    this.renewIds([copy]);
    const names = new Set(this.pages().map((page) => attr(page, 'draw:name')));
    const name = attr(copy, 'draw:name');
    if (name) {
      let n = 2;
      while (names.has(`${name} (${n})`)) n += 1;
      setAttr(copy, 'draw:name', `${name} (${n})`);
    }
    this.place(copy, at);
    this.settle(copy);
    return attr(copy, 'xml:id') as string;
  }

  /**
   * Gives copied nodes ids of their own – references among them (animations, connectors, a tilted
   * element's picture) follow; `fixed` names ids that take a given one instead of a random one.
   */
  private renewIds(
    roots: readonly XmlNode[],
    fixed: ReadonlyMap<string, string> = new Map(),
  ): void {
    const nodes = roots.flatMap((root) => [root, ...descendants(root)]);
    const taken = this.takenIds();
    for (const id of fixed.values()) taken.add(id);
    const renamed = new Map(fixed);
    for (const node of nodes) {
      for (const name of ['xml:id', 'draw:id'] as const) {
        const id = attr(node, name);
        if (!id) continue;
        if (!renamed.has(id)) {
          const fresh = this.freshId(taken);
          renamed.set(id, fresh);
          taken.add(fresh);
        }
        setAttr(node, name, renamed.get(id) as string);
      }
    }
    // References after all ids are renamed (one may point at a shape further down).
    for (const node of nodes) {
      for (const name of ID_REFERENCES) {
        const target = attr(node, name);
        if (target && renamed.has(target)) setAttr(node, name, renamed.get(target) as string);
      }
      // A tilted element's picture names the copy of it.
      const mark = readTiltMark(node);
      const of = mark && renamed.get(mark.of);
      if (mark && of) writeTiltMark(node, { ...mark, of });
    }
  }

  /**
   * A layout's own look for one of its placeholders (`look`, an automatic presentation style of
   * styles.xml – the master pages' own) as a slide's automatic style: its name there. A font it
   * names by declaration is named by family, as content.xml's declarations may lack it.
   */
  private slideLook(look: string): string | undefined {
    const styles = this.root(this.styles, 'office:document-styles');
    const automatic = styles && firstChild(styles, 'office:automatic-styles');
    const node = (automatic ? elementChildren(automatic) : []).find(
      (item) => attr(item, 'style:family') === 'presentation' && attr(item, 'style:name') === look,
    );
    if (!node) return undefined;
    const copy = structuredClone(node);
    const faces = new Map(
      [this.content, this.styles]
        .flatMap((part) => part.nodes)
        .map((root) => (tagOf(root) ? firstChild(root, 'office:font-face-decls') : undefined))
        .flatMap((decls) => (decls ? elementChildren(decls) : []))
        .map((face) => [attr(face, 'style:name'), attr(face, 'svg:font-family')] as const),
    );
    for (const text of childrenOf(copy).filter((item) => tagOf(item) === 'style:text-properties')) {
      const face = attr(text, 'style:font-name');
      const family = face ? faces.get(face) : undefined;
      if (!face) continue;
      removeAttr(text, 'style:font-name');
      if (family && attr(text, 'fo:font-family') === undefined) {
        setAttr(text, 'fo:font-family', family);
      }
    }
    return this.styleSink().add(copy);
  }

  /**
   * Adds a slide without content at `at` (0-based, counted before it) and returns its page id.
   * It is a slide of a layout with that layout's placeholders, empty (a master's subtitle stands
   * for its text frame) – to type into, as PowerPoint's new slide: of master page `master`, else
   * of slide `like`'s, taking that one's page style too (unless it hides). Without placeholders
   * to read (`like`'s master page unknown), it takes `like`'s master page and layout as they are.
   * `empty` (with `like`, no `master`): nothing on it at all – no placeholder and none of its
   * master's shapes (`presentation:background-objects-visible`), only `like`'s background: the
   * template editor's „Neue Folie“, a new layout to design from scratch.
   */
  addSlide(
    at: number,
    { like, master, empty = false }: { like?: number; master?: string; empty?: boolean },
  ): string {
    const attributes: Record<string, string> = {};
    const frames: XmlNode[] = [];
    const model = master === undefined && like !== undefined ? this.page(like) : undefined;
    const layout = master ?? (model && attr(model, 'draw:master-page-name'));
    const design =
      layout === undefined ? undefined : this.masterPages().find((item) => item.name === layout);
    if (master !== undefined && !design) {
      throw new OdpError('operation', 'Dieses Layout gibt es in der Datei nicht.');
    }
    const bare = empty && master === undefined;
    if (bare && layout) attributes['draw:master-page-name'] = layout;
    if (design && !bare) {
      attributes['draw:master-page-name'] = design.name;
      for (const frame of slidePlaceholders(design)) {
        if (frame.kind === 'picture') {
          // A picture to replace: the grey placeholder a new picture frame holds. Not marked
          // as an empty placeholder – LibreOffice would pass its picture by and draw nothing
          // there, neither the grey one nor the one it is swapped for.
          const box = { w: lengthToCm(frame.width) ?? 1, h: lengthToCm(frame.height) ?? 1 };
          const path = this.addPlaceholder(placeholderPicture(box.w, box.h));
          frames.push(
            element(
              'draw:frame',
              {
                'draw:layer': 'layout',
                'presentation:class': 'graphic',
                'svg:x': frame.x,
                'svg:y': frame.y,
                'svg:width': frame.width,
                'svg:height': frame.height,
              },
              [
                element('draw:image', {
                  'xlink:href': path,
                  'xlink:type': 'simple',
                  'xlink:show': 'embed',
                  'xlink:actuate': 'onLoad',
                }),
              ],
            ),
          );
          continue;
        }
        const style = (frame.look && this.slideLook(frame.look)) ?? frame.style;
        frames.push(
          element(
            'draw:frame',
            {
              ...(style ? { 'presentation:style-name': style } : {}),
              'draw:layer': 'layout',
              'presentation:class': frame.kind,
              'presentation:placeholder': 'true',
              ...(frame.prompt ? { [ASKS_MARK]: frame.prompt } : {}),
              'svg:x': frame.x,
              'svg:y': frame.y,
              'svg:width': frame.width,
              'svg:height': frame.height,
            },
            [element('draw:text-box')],
          ),
        );
      }
    }
    if (model) {
      if (!design && !bare) {
        for (const name of [
          'draw:master-page-name',
          'presentation:presentation-page-layout-name',
        ]) {
          const value = attr(model, name);
          if (value) attributes[name] = value;
        }
      }
      const style = attr(model, 'draw:style-name');
      if (style && !this.hiddenStyles().has(style)) attributes['draw:style-name'] = style;
    }
    const names = new Set(this.pages().map((page) => attr(page, 'draw:name')));
    let n = this.pages().length + 1;
    while (names.has(`page${n}`)) n += 1;
    const page = element('draw:page', { 'draw:name': `page${n}`, ...attributes }, frames);
    this.place(page, at);
    // Its master's background, not its shapes (a layout's decoration, footer, page number).
    if (bare) {
      this.restylePage(page, (properties) =>
        setAttr(properties, 'presentation:background-objects-visible', 'false'),
      );
    }
    this.settle(page);
    return attr(page, 'xml:id') as string;
  }

  /** A slide's formatted notes (`{ notesRich }`), nothing when it has none. */
  private notesRichOf(
    page: XmlNode,
    styles: StyleIndex,
  ): { notesRich: NotesParagraph[] } | undefined {
    const box = notesBoxOf(page);
    const notesRich = box ? readNotesRich(styles, box) : [];
    return notesRich.length > 0 ? { notesRich } : undefined;
  }

  /**
   * Gives slide `index` the speaker notes `text` (plain, a paragraph per line; empty: none) – in
   * its notes page's notes frame, made when it has none. With `paragraphs` formatted so (their
   * text is `text`'s).
   */
  setSlideNotes(index: number, text: string, paragraphs?: readonly NotesParagraph[]): void {
    const page = this.page(index);
    const rich = paragraphs && trimNotes(paragraphs);
    const wanted = rich ? notesText(rich) : text.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
    const box0 = notesBoxOf(page);
    if (
      rich
        ? JSON.stringify(box0 ? readNotesRich(this.styleIndex(), box0) : []) ===
          JSON.stringify(rich)
        : notesOf(page) === wanted
    )
      return;
    let notes = firstChild(page, 'presentation:notes');
    if (!notes) {
      if (!wanted) return;
      notes = element('presentation:notes');
      childrenOf(page).push(notes);
    }
    let frame = notesFrameOf(notes);
    if (!frame) {
      // Where LibreOffice puts it on an A4 notes page: under the slide's picture.
      frame = element('draw:frame', {
        'presentation:class': 'notes',
        'draw:layer': 'layout',
        'svg:x': '2cm',
        'svg:y': '14.5cm',
        'svg:width': '17cm',
        'svg:height': '12.5cm',
      });
      childrenOf(notes).push(frame);
    }
    let box = firstChild(frame, 'draw:text-box');
    if (!box) {
      box = element('draw:text-box');
      childrenOf(frame).push(box);
    }
    if (rich) writeNotesRich(this.styleSink(), box, rich);
    else {
      const lines = childrenOf(box);
      lines.splice(
        0,
        lines.length,
        ...(wanted
          ? wanted.split('\n').map((line) => element('text:p', {}, inlineNodes(line)))
          : []),
      );
    }
    this.dirty.content = true;
  }

  /**
   * A variant of slide `index` (of its slide, when it is a variant itself): a copy of it, hidden,
   * marked with its slide's page id and given the page id `newPageId`, right after that slide's
   * last variant (or the slide).
   */
  addVariant(index: number, newPageId: string): void {
    const links = this.variantLinks();
    const mainId = links[index] ?? attr(this.page(index), 'xml:id');
    if (!mainId) throw new OdpError('operation', 'Diese Folie gibt es nicht mehr.');
    let last = this.pages().findIndex((page) => attr(page, 'xml:id') === mainId);
    links.forEach((of, at) => {
      if (of === mainId && at > last) last = at;
    });
    const id = this.duplicateSlide(index, last + 1);
    this.renamePage(id, newPageId);
    setAttr(this.page(last + 1), VARIANT_MARK, mainId);
    this.setSlideHidden(last + 1, true);
  }

  /**
   * Variant `index` takes its slide's place: put where the slide is, shown (hidden if the slide
   * was) and no variant any more; the slide and its other variants become variants of it.
   */
  useVariant(index: number): void {
    const mainId = this.variantLinks()[index];
    const variant = this.page(index);
    const variantId = attr(variant, 'xml:id');
    if (!mainId || !variantId) throw new OdpError('operation', 'Diese Folie ist keine Variante.');
    const mainIndex = this.slideIndexOf(mainId);
    const main = this.page(mainIndex);
    const hidden = this.hiddenStyles().has(attr(main, 'draw:style-name') ?? '\u0000');
    for (const page of this.pages())
      if (attr(page, VARIANT_MARK) === mainId) setAttr(page, VARIANT_MARK, variantId);
    removeAttr(variant, VARIANT_MARK);
    setAttr(main, VARIANT_MARK, variantId);
    // Counted without the variant moved: it goes right before its slide.
    this.moveSlide(index, index < mainIndex ? mainIndex - 1 : mainIndex);
    const pages = this.pages();
    this.setSlideHidden(pages.indexOf(variant), hidden);
    this.setSlideHidden(pages.indexOf(main), true);
    this.dirty.content = true;
  }

  /** Removes slide `index`. */
  removeSlide(index: number): void {
    const page = this.page(index);
    if (this.pages().length === 1) {
      throw new OdpError('operation', 'Die letzte Folie lässt sich nicht löschen.');
    }
    removeChild(this.presentation() as XmlNode, page);
    this.dirty.content = true;
  }

  /** Moves slide `from` to position `to` (0-based, counted without it). */
  moveSlide(from: number, to: number): void {
    const page = this.page(from);
    if (to < 0 || to >= this.pages().length) {
      throw new OdpError('operation', `There is no position ${to + 1}.`);
    }
    removeChild(this.presentation() as XmlNode, page);
    this.place(page, to);
    this.dirty.content = true;
  }

  /**
   * Hides slide `index` or shows it again – `presentation:visibility` of its page style, like
   * PowerPoint's „Folie ausblenden“.
   */
  setSlideHidden(index: number, hidden: boolean): void {
    const page = this.page(index);
    if (this.hiddenStyles().has(attr(page, 'draw:style-name') ?? '\u0000') === hidden) return;
    this.restylePage(page, (properties) =>
      setAttr(properties, 'presentation:visibility', hidden ? 'hidden' : 'visible'),
    );
  }

  /**
   * Gives slide `index` a background of one colour – the fill of its page style –, or the
   * master's again (`null`: the page fills nothing of its own).
   */
  setSlideBackground(index: number, color: string | null): void {
    const page = this.page(index);
    const next = color?.toLowerCase() ?? null;
    // Back to the master's: only when the page fills something itself (a gradient or picture too).
    if (next === null ? !this.hasOwnBackground(page) : this.pageBackground(page) === next) return;
    this.fillPage(page, next === null ? null : { 'draw:fill': 'solid', 'draw:fill-color': next });
    writeFillsMark(page, null, {});
  }

  /**
   * Gives slide `index` a background of fill layers, as a shape has them: one colour or gradient
   * as such, anything else as `composite` – the picture of them all, uploaded – stretched over
   * the slide. No layer shown: the master's again.
   */
  private setSlideFills(
    index: number,
    layers: readonly FillLayer[],
    composite: { imageId: string } | undefined,
    images: ReadonlyMap<string, OdpImage>,
  ): void {
    const page = this.page(index);
    const fills = this.fillPictures(layers, images);
    const shown = nativeFill(fills, true);
    if (shown === null) {
      if (this.hasOwnBackground(page)) this.fillPage(page, null);
      writeFillsMark(page, null, {});
      return;
    }
    let picture: string | null = null;
    if (shown === 'composite') {
      const image = composite && images.get(composite.imageId);
      if (!image)
        throw new OdpError('operation', 'Das Bild ist nicht mehr da. Bitte nochmal versuchen.');
      picture = this.addPicture(image.bytes, image.mediaType);
    }
    const props = fillProperties({ named: (node) => this.named(node) }, shown, picture);
    this.fillPage(page, props);
    writeFillsMark(page, { fills, aspect: null }, props);
  }

  /** The page's own fill set to `props` (`null`: none – the master's shows). */
  private fillPage(page: XmlNode, props: Properties | null): void {
    this.restylePage(page, (properties) => {
      for (const name of attributeNames(properties)) {
        if (
          name === 'draw:fill' ||
          name.startsWith('draw:fill-') ||
          name === 'draw:opacity' ||
          name === 'draw:opacity-name' ||
          name === 'style:repeat'
        )
          removeAttr(properties, name);
      }
      if (props === null) return;
      for (const [name, value] of Object.entries(props)) setAttr(properties, name, value);
      setAttr(properties, 'draw:background-size', 'full');
      setAttr(properties, 'presentation:background-visible', 'true');
    });
  }

  /** The page's own background as layers (none: the master's). */
  private pageFills(page: XmlNode, styles: StyleIndex): FillLayer[] {
    const style = this.pageStyle(attr(page, 'draw:style-name'));
    const properties = style && firstChild(style, 'style:drawing-page-properties');
    if (!properties || !this.hasOwnBackground(page)) return [];
    const props: Properties = {};
    for (const name of attributeNames(properties)) props[name] = attr(properties, name) ?? '';
    return readFills(styles, page, props, 'none').fills;
  }

  /** Gives slide `index` the transition it comes in with when presenting (`'none'`: without). */
  setSlideTransition(index: number, transition: SlideTransition): void {
    const page = this.page(index);
    if (this.pageTransition(page) === transition) return;
    const root = this.root(this.content, 'office:document-content');
    if (root && attr(root, 'xmlns:smil') === undefined)
      setAttr(root, 'xmlns:smil', 'urn:oasis:names:tc:opendocument:xmlns:smil-compatible:1.0');
    this.restylePage(page, (properties) => writeTransitionProperties(properties, transition));
    writeTransitionFilters(page, transition);
  }

  /** The page's transition (see {@link readTransition}). */
  private pageTransition(page: XmlNode): SlideTransition | null {
    const style = this.pageStyle(attr(page, 'draw:style-name'));
    return readTransition(page, style && firstChild(style, 'style:drawing-page-properties'));
  }

  /** The `drawing-page` style named `name`, wherever the file keeps it. */
  private pageStyle(name: string | undefined): XmlNode | undefined {
    if (name === undefined) return undefined;
    if (this.pageStyles) return this.pageStyles.get(name);
    return this.namedStyles().find(
      (style) =>
        style.name === name &&
        tagOf(style.node) === 'style:style' &&
        attr(style.node, 'style:family') === 'drawing-page',
    )?.node;
  }

  /** Whether the page's style fills the background itself instead of showing the master's. */
  private hasOwnBackground(page: XmlNode): boolean {
    const style = this.pageStyle(attr(page, 'draw:style-name'));
    const properties = style && firstChild(style, 'style:drawing-page-properties');
    const fill = properties && attr(properties, 'draw:fill');
    return !!fill && fill !== 'none';
  }

  /** The page's own background colour (`#rrggbb`), `null` when it shows the master's or more. */
  private pageBackground(page: XmlNode): string | null {
    const style = this.pageStyle(attr(page, 'draw:style-name'));
    const properties = style && firstChild(style, 'style:drawing-page-properties');
    const color = properties && attr(properties, 'draw:fill-color');
    return properties &&
      attr(properties, 'draw:fill') === 'solid' &&
      color &&
      /^#[0-9a-f]{6}$/i.test(color)
      ? color.toLowerCase()
      : null;
  }

  /**
   * Changes the page style of `page`: slides often share one, so the slide gets a copy of its own
   * in content.xml's automatic styles, its drawing-page properties changed by `change`.
   */
  private restylePage(page: XmlNode, change: (properties: XmlNode) => void): void {
    const automatic = this.automaticStyles();
    const named = this.namedStyles();
    const original = this.pageStyle(attr(page, 'draw:style-name'));
    const style = original
      ? structuredClone(original)
      : element('style:style', { 'style:family': 'drawing-page' });
    const names = new Set(named.map(({ name }) => name));
    let n = 1;
    while (names.has(`${this.idPrefix}dp${n}`)) n += 1;
    const name = `${this.idPrefix}dp${n}`;
    setAttr(style, 'style:name', name);
    let properties = firstChild(style, 'style:drawing-page-properties');
    if (!properties) {
      properties = element('style:drawing-page-properties');
      childrenOf(style).push(properties);
    }
    change(properties);
    childrenOf(automatic).push(style);
    setAttr(page, 'draw:style-name', name);
    this.dirty.content = true;
  }

  /**
   * Puts the slides in `order` (page ids): those in `pages` as that XML (trusted – a stored
   * change), the others as they are; slides not in `order` go.
   */
  arrange(order: readonly string[], pages: ReadonlyMap<string, string>): void {
    if (order.length === 0) {
      throw new OdpError('operation', 'Eine Präsentation braucht mindestens eine Folie.');
    }
    const current = new Map(this.pages().map((page) => [attr(page, 'xml:id') ?? '', page]));
    const placed: XmlNode[] = [];
    for (const id of order) {
      const xml = pages.get(id);
      if (xml === undefined) {
        const page = current.get(id);
        if (!page) throw new OdpError('operation', 'Diese Folie gibt es nicht mehr.');
        placed.push(page);
        continue;
      }
      const page = this.pageFrom(xml, true, []);
      setAttr(page, 'xml:id', id);
      placed.push(page);
    }
    const presentation = this.presentation() as XmlNode;
    const siblings = childrenOf(presentation);
    const first = siblings.findIndex((node) => tagOf(node) === 'draw:page');
    const rest = siblings.filter((node) => tagOf(node) !== 'draw:page');
    siblings.splice(0, siblings.length, ...rest);
    siblings.splice(first === -1 ? siblings.length : first, 0, ...placed);
    for (const page of placed) if (pages.has(attr(page, 'xml:id') ?? '')) this.settle(page);
    this.dirty.content = true;
  }

  /** The slides' page ids (`xml:id` of each `draw:page`; see {@link ensureIds}). */
  pageIds(): string[] {
    return this.pages().map((page) => attr(page, 'xml:id') ?? '');
  }

  /** One `draw:page` from XML, cleaned and checked unless `trusted`. */
  private pageFrom(xml: string, trusted: boolean, alsoKnown: readonly string[]): XmlNode {
    const nodes = trusted ? parsedNodes(xml, 'slide') : authoredNodes(xml, 'slide');
    const page = nodes[0];
    if (nodes.length !== 1 || !page || tagOf(page) !== 'draw:page') {
      throw new OdpError('operation', 'Write exactly one <draw:page> element.');
    }
    if (!trusted) {
      const known = new Set([
        ...this.namedStyles().map((style) => style.name),
        // What the slide used already counts as there, even if the file never defined it.
        ...alsoKnown,
      ]);
      const problems = this.authoredProblems(page, known);
      if (problems.length > 0) throw new OdpError('operation', problems.join('\n'));
    }
    return page;
  }

  /** Puts a page in as slide `index` (0-based; the number of slides appends). */
  private place(page: XmlNode, index: number): void {
    if (!attr(page, 'xml:id')) this.idsEnsured = false;
    const pages = this.pages();
    if (index < 0 || index > pages.length) {
      throw new OdpError('operation', `There is no position ${index + 1}.`);
    }
    const siblings = childrenOf(this.presentation() as XmlNode);
    const last = pages.at(-1);
    const at =
      index < pages.length
        ? siblings.indexOf(pages[index] as XmlNode)
        : last
          ? siblings.indexOf(last) + 1
          : siblings.length;
    siblings.splice(at, 0, page);
  }

  private takenIds(except: ReadonlySet<XmlNode> = new Set()): Set<string> {
    const taken = new Set<string>();
    for (const root of this.content.nodes) {
      for (const node of descendants(root)) {
        const id = attr(node, 'xml:id');
        if (id && !except.has(node)) taken.add(id);
      }
    }
    return taken;
  }

  /**
   * After a page came in: ids taken elsewhere are dropped, and the page and its elements get
   * fresh ones where they have none ({@link freshId}); animations of shapes no longer there go.
   */
  private settle(page: XmlNode): void {
    const own = [page, ...descendants(page)];
    const taken = this.takenIds(new Set(own));
    for (const node of own) {
      const id = attr(node, 'xml:id');
      if (!id) continue;
      if (taken.has(id)) removeAttr(node, 'xml:id');
      else taken.add(id);
    }
    for (const node of [page, ...this.shapesOf(page)]) {
      if (attr(node, 'xml:id')) continue;
      const id = this.freshId(taken);
      setAttr(node, 'xml:id', id);
      taken.add(id);
    }
    const ids = new Set(
      own.flatMap((node) =>
        [attr(node, 'xml:id'), attr(node, 'draw:id')].filter((id): id is string => Boolean(id)),
      ),
    );
    this.removeEffects(page, (target) => !ids.has(target));
    this.dirty.content = true;
    // The rest of a file from before ids, as every reading of it gets them.
    this.ensureIds();
  }

  /**
   * An id for something made now – a slide put in, a copy, a tilted element's picture – that no
   * id of the file had or will have: random, unlike {@link ensureIds}' (the same for every reader
   * of a file, so the lowest number free). A number freed by a slide deleted would otherwise be
   * given again, and that slide, coming back on undo, would meet its own id on another slide,
   * lose it and with it the comments its page id holds (`commitStep`).
   */
  private freshId(taken: ReadonlySet<string>): string {
    for (;;) {
      const id = `${this.idPrefix}${randomBytes(6).toString('hex')}`;
      if (!taken.has(id)) return id;
    }
  }

  /** What is wrong with XML written from outside, after cleaning it: unknown names, missing files. */
  private authoredProblems(root: XmlNode, knownStyles: ReadonlySet<string>): string[] {
    const content = this.root(this.content, 'office:document-content');
    const prefixes = new Set(['xml']);
    for (const name of content ? attributeNames(content) : []) {
      if (name.startsWith('xmlns:')) prefixes.add(name.slice('xmlns:'.length));
    }
    const problems = new Set<string>();
    let paths: string[] | undefined;
    const walk = (node: XmlNode) => {
      const tag = tagOf(node) as string;
      for (const name of [tag, ...attributeNames(node)]) {
        const prefix = name.includes(':') ? name.slice(0, name.indexOf(':')) : null;
        // LibreOffice's own (`loext:opacity` of the editor's text styles, carried into a change
        // made on a copy of the deck): declared when a blank deck's content.xml lacks it.
        if (prefix === 'loext' && !prefixes.has(prefix)) {
          this.declareLoext();
          prefixes.add(prefix);
        }
        if (!prefix || !prefixes.has(prefix)) problems.add(`Unknown namespace in ${name}.`);
      }
      for (const name of attributeNames(node)) {
        if (!isStyleReference(name)) continue;
        const value = attr(node, name) ?? '';
        if (value && !knownStyles.has(value)) {
          problems.add(`${name}="${value}": there is no such style – read the styles or add it.`);
        }
      }
      const href = attr(node, 'xlink:href');
      if (href && isPackagePath(href)) {
        const path = href.replace(/^\.\//, '');
        if (
          !this.archive.has(path) &&
          !(paths ??= this.archive.paths()).some((p) => p.startsWith(`${path}/`))
        ) {
          problems.add(`${href}: there is no such file in the presentation.`);
        }
      }
      for (const child of elementChildren(node)) walk(child);
    };
    walk(root);
    return [...problems];
  }

  // ── Writing ─────────────────────────────────────────────────────────────

  /** Pictures no part refers to any more go, so the file does not grow with every swap. */
  private prunePictures(content: string, styles: string): void {
    const used = picturePathsIn(content, styles);
    this.dropFiles(
      this.archive.paths().filter((path) => path.startsWith('Pictures/') && !used.has(path)),
    );
  }

  /**
   * Drops every file of the package no `xlink:href` points at (pictures in any folder, media,
   * thumbnails) – the parts themselves, `META-INF` and `mimetype` stay; an embedded object's
   * folder stays whole when its folder is pointed at.
   */
  private pruneUnreferenced(content: string, styles: string): void {
    const refs = [...content.matchAll(HREF), ...styles.matchAll(HREF)]
      .map((m) => decode(m[1] as string).replace(/^\.\//, ''))
      .filter(isPackagePath);
    const used = new Set(refs);
    const folders = refs.map((ref) => `${ref.replace(/\/$/, '')}/`);
    this.dropFiles(
      this.archive
        .paths()
        .filter(
          (path) =>
            path !== 'mimetype' &&
            !path.startsWith('META-INF/') &&
            !(path.endsWith('.xml') && !path.includes('/')) &&
            !used.has(path) &&
            !folders.some((folder) => path.startsWith(folder)),
        ),
    );
  }

  /**
   * After masters were dropped (`toDrawingBytes`): styles.xml's automatic styles nothing names
   * any more – automatic styles are only ever named directly – and the fill pictures no style
   * names, so their files go too.
   */
  private dropUnusedStyles(): void {
    const values = (name: (attribute: string) => boolean): Set<string> => {
      const found = new Set<string>();
      for (const node of this.elements()) {
        for (const attribute of attributeNames(node)) {
          if (name(attribute)) found.add(attr(node, attribute) ?? '');
        }
      }
      return found;
    };
    const styles = this.root(this.styles, 'office:document-styles');
    if (!styles) return;
    const named = values((attribute) => attribute.endsWith('style-name'));
    const automatic = firstChild(styles, 'office:automatic-styles');
    if (automatic) {
      const children = childrenOf(automatic);
      for (let i = children.length - 1; i >= 0; i -= 1) {
        const child = children[i] as XmlNode;
        if (tagOf(child) === 'style:style' && !named.has(attr(child, 'style:name') ?? '')) {
          children.splice(i, 1);
        }
      }
    }
    const fills = values((attribute) => attribute === 'draw:fill-image-name');
    const common = firstChild(styles, 'office:styles');
    if (common) {
      const children = childrenOf(common);
      for (let i = children.length - 1; i >= 0; i -= 1) {
        const child = children[i] as XmlNode;
        if (tagOf(child) === 'draw:fill-image' && !fills.has(attr(child, 'draw:name') ?? '')) {
          children.splice(i, 1);
        }
      }
    }
  }

  private dropFiles(unused: readonly string[]): void {
    if (unused.length === 0) return;
    const gone = new Set(unused);
    for (const path of unused) this.archive.remove(path);
    const root = this.manifest && this.root(this.manifest, 'manifest:manifest');
    if (root) {
      const entries = childrenOf(root);
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const entry = entries[i] as XmlNode;
        if (gone.has(attr(entry, 'manifest:full-path') ?? '')) entries.splice(i, 1);
      }
      this.dirty.manifest = true;
    }
  }

  get changed(): boolean {
    return (
      this.dirty.content || this.dirty.styles || this.dirty.manifest || this.dirtyEmbedded.size > 0
    );
  }

  async toBytes({
    compress = true,
    prune = 'pictures',
  }: {
    compress?: boolean;
    /** `pictures`: unused ones in `Pictures/` go; `unreferenced`: every file nothing points at. */
    prune?: 'pictures' | 'unreferenced';
  } = {}): Promise<Uint8Array> {
    // The prefixes Slider writes itself: its own attributes (fill layers, maybe come with a slide
    // from another file) and picture links – an undeclared `xlink:href` is no link to
    // LibreOffice, the frame drawn empty (decks started blank never declared it). Not named
    // `declare`: Bun reads a statement `declare(…)` as a TypeScript declaration and drops it.
    const declareNamespaces = (
      root: XmlNode | undefined,
      prefixes: readonly (readonly [string, string])[],
    ) => {
      if (!root) return;
      for (const [name, uri] of prefixes)
        if (attr(root, name) === undefined) setAttr(root, name, uri);
    };
    const XLINK = ['xmlns:xlink', 'http://www.w3.org/1999/xlink'] as const;
    if (this.dirty.content)
      declareNamespaces(this.root(this.content, 'office:document-content'), [
        ['xmlns:slider', SLIDER_NS],
        XLINK,
      ]);
    if (this.dirty.styles)
      declareNamespaces(this.root(this.styles, 'office:document-styles'), [XLINK]);
    const content = buildPart(this.content);
    const styles = this.styles.nodes.length > 0 ? buildPart(this.styles) : '';
    // Before pruning, so an object nothing shows any more still goes.
    for (const path of this.dirtyEmbedded) {
      if (this.archive.has(path))
        this.archive.write(path, buildPart(this.embedded.get(path) as XmlPart), compress);
    }
    this.dirtyEmbedded.clear();
    if (prune === 'unreferenced') this.pruneUnreferenced(content, styles);
    if (this.dirty.content) {
      this.archive.write('content.xml', content, compress);
      if (prune === 'pictures') this.prunePictures(content, styles);
    }
    if (this.dirty.styles) this.archive.write('styles.xml', styles, compress);
    if (this.dirty.manifest && this.manifest)
      this.archive.write('META-INF/manifest.xml', buildPart(this.manifest), compress);
    return this.archive.toBytes();
  }

  /**
   * The file as LibreOffice is to draw only `pages` of it (0-based, hidden slides counted): every
   * other page still there – page numbers, page count and the PDF page range stay right – but
   * empty, so LibreOffice neither loads nor lays out what it does not draw; no speaker notes, no
   * pictures nothing shows any more, no external links, fonts named by `substitute`
   * ({@link replaceFonts}); what changed stored uncompressed. Changes this document: use it for
   * nothing else afterwards.
   */
  async toDrawingBytes(
    pages: readonly number[],
    substitute: (family: string) => string | null,
  ): Promise<Uint8Array> {
    this.keepForDrawing(pages);
    return this.drawingBytes(substitute);
  }

  /**
   * The file as LibreOffice is to draw a slide taken apart (the layers view): its page without
   * its elements – page and master background, master shapes – then, for every element bottom
   * first, two pages holding that element alone, on white and on black (the two tell how opaque
   * each pixel is, and its colour); every other page empty. `pages`: those to draw (1-based, as
   * LibreOffice counts them); `elementIds`: the elements in that order; `background` and
   * `layers` (in that order too): what each part shows – the same wherever the element lies in
   * the stack, so a part drawn once is drawn for good. An element reaching off the page is drawn
   * whole: moved onto its page alone – one larger than the page drawn smaller around its middle
   * to fit; `placements` say how, per element, so its picture's box goes back (`placedBox`).
   * Every element is drawn at one place of its own – its middle on the page's, when it fits –
   * so where it lies changes nothing in its picture: moved, it is not drawn again.
   * `compose` (the per-element editor): texts typed live are left out of the pictures (the
   * browser draws them), and what the browser draws whole (`paint`) is not drawn at all – its
   * layer `null`, no pages. Changes this document: use it for nothing else afterwards.
   */
  async toLayerBytes(
    pageIndex: number,
    substitute: (family: string) => string | null,
    { compose = false }: { compose?: boolean } = {},
  ): Promise<{
    bytes: Uint8Array;
    /** The slide's page, then two for each element drawn (its layer not `null`), in order. */
    pages: number[];
    elementIds: string[];
    background: string;
    /**
     * Composed: what lies over the slide's background of its own – its master's shapes, footer and
     * page number as the slide shows them, see-through elsewhere – drawn as the two pages after the
     * slide's and the master's background (on white and on black); the same whatever the slide's background, which
     * the browser draws. `null` when not composed.
     */
    masterShapes: string | null;
    /**
     * Composed: the master's background alone – no own background of the slide, no shapes – drawn
     * as the page before the master's shapes' two: what shows once the slide's own background goes
     * („Wie Master“). The same for every slide of that master. `null` when not composed.
     */
    masterGround: string | null;
    layers: (string | null)[];
    placements: LayerPlacement[];
  }> {
    const page = this.page(pageIndex);
    // Composed, a group is drawn from its parts (each alone, as any element): edited in it (a
    // double click enters it), a part shows so at once – drawn by the browser or as its own
    // picture. Their stack is the group's, a group adds nothing of its own to how they look.
    const leaves = (node: XmlNode): XmlNode[] =>
      tagOf(node) === 'draw:g' ? groupShapes(node).flatMap(leaves) : [node];
    const shapes = compose ? this.shapesOf(page).flatMap(leaves) : this.shapesOf(page);
    const elementIds = shapes.map((node) => attr(node, 'xml:id') ?? '');
    // Composed: which the browser draws whole, which hold a text it types (described first:
    // the document changes below).
    const index = compose ? this.styleIndex() : null;
    const tilted = compose ? this.tiltPicturesOf(page) : null;
    const composed = shapes.map((node) => {
      if (!index) return { painted: false, typed: false };
      const picture = tilted?.get(attr(node, 'xml:id') ?? '');
      const tilt = picture ? (readTiltMark(picture)?.tilt ?? null) : null;
      const element = this.describe(node, this.pageSize(), index, tilt);
      return { painted: element.paint !== undefined, typed: element.live !== null };
    });
    this.keepForDrawing([pageIndex]);
    // Tilted elements' pictures neither: the layers view tilts the elements themselves.
    const all = this.allShapesOf(page);
    const children = childrenOf(page);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      if (all.includes(children[i] as XmlNode)) children.splice(i, 1);
    }
    const sink = this.styleSink();
    const styles = { white: solidPage(sink, '#ffffff'), black: solidPage(sink, '#000000') };
    // The elements alone on a master of their own, empty: no master shape, no master background.
    const masterStyles = firstChild(
      this.root(this.styles, 'office:document-styles') ?? {},
      'office:master-styles',
    );
    const master = childrenOf(masterStyles ?? {}).find(
      (child) =>
        tagOf(child) === 'style:master-page' &&
        attr(child, 'style:name') === attr(page, 'draw:master-page-name'),
    );
    let bare: string | null = null;
    if (masterStyles && master) {
      const empty = structuredClone(master);
      childrenOf(empty).length = 0;
      removeAttr(empty, 'draw:style-name');
      const taken = new Set(childrenOf(masterStyles).map((child) => attr(child, 'style:name')));
      bare = `${this.idPrefix}Layers`;
      for (let n = 2; taken.has(bare); n += 1) bare = `${this.idPrefix}Layers${n}`;
      setAttr(empty, 'style:name', bare);
      removeAttr(empty, 'style:display-name');
      childrenOf(masterStyles).push(empty);
      this.dirty.styles = true;
    }
    // What reaches off the page goes onto it alone. One larger than the page is drawn smaller,
    // around its middle, to fit (a turned one alike both ways): cut at the page's edge, its
    // picture would miss what lies off the slide beyond it. One holding text, a group or a line
    // keeps its size (smaller, text would wrap anew): its left or top edge first.
    const pageSize = this.pageSize();
    const onto = (at: number, size: number, page: number) =>
      at < 0 || size > page ? -at : at + size > page ? page - at - size : 0;
    // Each as it is drawn: smaller around its middle c by `scale` (a shape only, its turn kept),
    // moved by `move` (cm) onto the page – a point p drawn at scale · p + c · (1 − scale) + move.
    const placements = shapes.map((shape) => {
      const box = boxOf(shape);
      const frame = frameOf(shape);
      if (!box)
        return {
          scale: { x: 1, y: 1 },
          move: { x: 0, y: 0 },
          centred: false,
          shift: { x: 0, y: 0 },
        };
      let scale = {
        x: Math.min(1, pageSize.width / box.w),
        y: Math.min(1, pageSize.height / box.h),
      };
      const shrinks =
        (scale.x < 1 || scale.y < 1) &&
        !!frame &&
        attr(shape, 'svg:x1') == null &&
        tagOf(shape) !== 'draw:g' &&
        !this.holdsText(shape);
      if (!shrinks) scale = { x: 1, y: 1 };
      else if (frame.rotation !== 0) {
        const both = Math.min(scale.x, scale.y);
        scale = { x: both, y: both };
      }
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const w = box.w * scale.x;
      const h = box.h * scale.y;
      // Its middle on the page's when it fits there (turned, its turned bounds): drawn the same
      // wherever it lies.
      const turn = ((frame?.rotation ?? 0) * Math.PI) / 180;
      const across = Math.abs(w * Math.cos(turn)) + Math.abs(h * Math.sin(turn));
      const down = Math.abs(w * Math.sin(turn)) + Math.abs(h * Math.cos(turn));
      const centred = !!frame && !shrinks && across <= pageSize.width && down <= pageSize.height;
      const move = centred
        ? { x: pageSize.width / 2 - cx, y: pageSize.height / 2 - cy }
        : {
            x: onto(cx - w / 2, w, pageSize.width),
            y: onto(cy - h / 2, h, pageSize.height),
          };
      return {
        scale,
        move,
        centred,
        // In page fractions, for the picture's way back (`placedBox`).
        shift: {
          x: (cx * (1 - scale.x) + move.x) / pageSize.width,
          y: (cy * (1 - scale.y) + move.y) / pageSize.height,
        },
      };
    });
    const added: XmlNode[] = [];
    const unnamed = (xml: string) =>
      xml.replace(/ (?:xml:id|draw:id|style:name|[a-z]+:style-name)="[^"]*"/g, '');
    const size = JSON.stringify(this.pageSize());
    const fingerprintOf = (nodes: XmlNode[], ...also: string[]) => {
      const hash = createHash('sha256')
        .update(unnamed(xmlOf(...nodes)))
        .update(
          this.stylesXml(nodes.flatMap((at) => [...styleReferences(at)]))
            .xml.map(unnamed)
            .sort()
            .join(''),
        )
        .update(size);
      for (const more of also) hash.update(`\0${more}`);
      return hash.digest('hex').slice(0, 32);
    };
    let masterShapes: string | null = null;
    let masterGround: string | null = null;
    if (compose) {
      // The master's background alone (`masterGround`), then the slide without its elements on a
      // ground of one colour each: its master's shapes alone.
      // Nothing of the slide but its master: the same page for every slide of that master.
      const ground = element('draw:page', {
        'draw:name': 'ground',
        'draw:style-name': masterGroundStyle(this.styleSink()),
        'draw:master-page-name': attr(page, 'draw:master-page-name') ?? '',
      });
      masterGround = fingerprintOf(
        [ground],
        'master ground 1',
        attr(page, 'draw:master-page-name') ?? '',
      );
      const pair = ['#ffffff', '#000000'].map((color) => {
        const grounded = structuredClone(page);
        removeIds(grounded);
        this.groundPage(grounded, color);
        return grounded;
      });
      added.push(ground, ...pair);
      masterShapes = fingerprintOf(
        pair,
        'master shapes 1',
        attr(page, 'draw:master-page-name') ?? '',
      );
    }
    const layers: (string | null)[] = [];
    for (const [at, shape] of shapes.entries()) {
      const { scale, move, centred } = placements[at] as (typeof placements)[number];
      if (composed[at]?.painted) {
        layers.push(null);
        continue;
      }
      const placed = structuredClone(shape);
      // A tilted element is unseen on its slide; alone it is drawn flat.
      removeAttr(placed, 'draw:display');
      // Its text typed live is drawn by the browser over it.
      if (composed[at]?.typed) blankText(sink, placed);
      // A group or a line is moved there, its parts with it (written anew, a group's would not).
      const whole = tagOf(placed) === 'draw:g' || attr(placed, 'svg:x1') != null;
      const frame = !whole && (centred || scale.x < 1 || scale.y < 1) ? frameOf(placed) : null;
      if (frame && centred) {
        // Written anew at the page's middle: nothing of where it lay is left in it.
        const { box } = frame;
        setFrame(placed, {
          box: {
            x: pageSize.width / 2 - box.w / 2,
            y: pageSize.height / 2 - box.h / 2,
            w: box.w,
            h: box.h,
          },
          rotation: frame.rotation,
        });
      } else if (frame) {
        const { box } = frame;
        const w = box.w * scale.x;
        const h = box.h * scale.y;
        setFrame(placed, {
          box: { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h },
          rotation: frame.rotation,
        });
      }
      if (!(frame && centred) && (move.x || move.y)) moveBy(placed, move.x, move.y);
      for (const style of [styles.white, styles.black]) {
        const alone = structuredClone(page);
        const drawn = structuredClone(placed);
        childrenOf(alone).splice(0, childrenOf(alone).length, drawn);
        removeIds(alone);
        setAttr(alone, 'draw:style-name', style);
        if (bare) setAttr(alone, 'draw:master-page-name', bare);
        added.push(alone);
      }
      layers.push(fingerprintOf(added.slice(-2)));
    }
    const background = fingerprintOf(
      [page],
      attr(page, 'draw:master-page-name') ?? '',
      attr(page, 'draw:style-name') ?? '',
    );
    const list = childrenOf(this.presentation() ?? {});
    list.splice(list.indexOf(page) + 1, 0, ...added);
    this.idsEnsured = false;
    return {
      bytes: await this.drawingBytes(substitute),
      pages: [page, ...added].map((_, i) => pageIndex + 1 + i),
      elementIds,
      background,
      masterShapes,
      masterGround,
      layers,
      placements: placements.map(({ scale, shift }) => ({ scale, shift })),
    };
  }

  /**
   * A page's own style – master shapes, footer and page number shown or not – filled with one
   * colour (that also hides the master's background), shown even on a hidden slide.
   */
  private groundPage(at: XmlNode, color: string): void {
    writeFillsMark(at, null, {});
    this.restylePage(at, (properties) => {
      for (const name of attributeNames(properties)) {
        if (
          /^(?:draw|loext):(?:fill|gradient|opacity)/.test(name) ||
          name === 'style:repeat' ||
          name === 'draw:background-size' ||
          name === 'presentation:visibility'
        )
          removeAttr(properties, name);
      }
      setAttr(properties, 'draw:fill', 'solid');
      setAttr(properties, 'draw:fill-color', color);
      setAttr(properties, 'presentation:background-visible', 'true');
    });
  }

  /** Empties every page but `pages` and drops what only those emptied showed (masters, styles). */
  private keepForDrawing(pages: readonly number[]): void {
    const keep = new Set(pages);
    const all = this.pages();
    // Only the masters of the pages drawn: a deck from PowerPoint has one per layout, each with
    // its pictures, and LibreOffice loads every master. The empty pages take one of those.
    const masters = new Set(
      all
        .filter((_, index) => keep.has(index))
        .map((page) => attr(page, 'draw:master-page-name'))
        .filter((name): name is string => Boolean(name)),
    );
    const anyMaster = masters.values().next().value;
    all.forEach((page, index) => {
      const children = childrenOf(page);
      for (let i = children.length - 1; i >= 0; i -= 1) {
        if (!keep.has(index) || tagOf(children[i] as XmlNode) === 'presentation:notes') {
          children.splice(i, 1);
        }
      }
      if (!keep.has(index) && anyMaster) setAttr(page, 'draw:master-page-name', anyMaster);
    });
    // A hidden slide asked for (a variant) is drawn too: LibreOffice leaves hidden ones out.
    const hidden = this.hiddenStyles();
    for (const index of keep) {
      const page = all[index];
      if (page && hidden.has(attr(page, 'draw:style-name') ?? '\u0000'))
        this.setSlideHidden(index, false);
    }
    const styles = this.root(this.styles, 'office:document-styles');
    const masterStyles = styles && firstChild(styles, 'office:master-styles');
    if (masterStyles && masters.size > 0) {
      const children = childrenOf(masterStyles);
      for (let i = children.length - 1; i >= 0; i -= 1) {
        const child = children[i] as XmlNode;
        if (tagOf(child) !== 'style:master-page') continue;
        if (!masters.has(attr(child, 'style:name') ?? '')) children.splice(i, 1);
      }
      this.dropUnusedStyles();
      this.dirty.styles = true;
    }
    this.dirty.content = true;
  }

  /** The prepared file, without links, its fonts as `substitute` names them, unpruned parts out. */
  private drawingBytes(substitute: (family: string) => string | null): Promise<Uint8Array> {
    this.dirty.content = true;
    this.removeExternalLinks();
    this.replaceFonts(substitute);
    return this.toBytes({ compress: false, prune: 'unreferenced' });
  }
}

/**
 * A preset shape's outline (`{ outline }`): a triangle's the editor's frame follows; an ellipse's,
 * a preset polygon's or one's own path the browser cuts a fill drawn over it to (`fillArea`).
 * Else nothing (the box).
 */
function outlineOf(node: XmlNode): { outline: ShapeOutline } | undefined {
  if (tagOf(node) === 'draw:ellipse') {
    const kind = attr(node, 'draw:kind');
    return !kind || kind === 'full' ? { outline: { type: 'ellipse' } } : undefined;
  }
  const geometry =
    tagOf(node) === 'draw:custom-shape' ? firstChild(node, 'draw:enhanced-geometry') : undefined;
  const type = geometry ? attr(geometry, 'draw:type') : undefined;
  if (!geometry || attr(geometry, 'draw:text-path') === 'true') return undefined;
  const path = attr(geometry, 'draw:enhanced-path')?.trim();
  // LibreOffice's own ellipse, its path its whole circle.
  if (
    type === 'ellipse' &&
    (path === undefined || /^U 10800 10800 10800 10800 0 \d+ Z N$/.test(path))
  )
    return { outline: { type } };
  const modifiers = (attr(geometry, 'draw:modifiers') ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
  const said = modifiers.length > 0 && modifiers.every(Number.isFinite) && { modifiers };
  if (hasShapeOutline(type) || (isPresetPolygon(type) && path === undefined))
    return { outline: { type, ...said } };
  // An outline of its own (a cloud, PowerPoint's presets): its path – a box's corners are its
  // radius (`cornersOf`).
  const own = attr(geometry, 'drawooo:enhanced-path')?.trim() || path;
  if (!own || readCornerRadius(node) !== undefined) return undefined;
  const equations: Record<string, string> = {};
  for (const child of elementChildren(geometry)) {
    const name = tagOf(child) === 'draw:equation' ? attr(child, 'draw:name') : undefined;
    const formula = name && attr(child, 'draw:formula');
    if (name && formula) equations[name] = formula;
  }
  const optional = (name: string) => attr(geometry, name)?.trim() || undefined;
  return {
    outline: {
      type: type ?? '',
      ...said,
      path: {
        path: own,
        ...(optional('svg:viewBox') && { viewBox: optional('svg:viewBox') }),
        ...(Object.keys(equations).length > 0 && { equations }),
        ...(optional('drawooo:sub-view-size') && { subViews: optional('drawooo:sub-view-size') }),
        ...(optional('draw:path-stretchpoint-x') && {
          stretchX: optional('draw:path-stretchpoint-x'),
        }),
        ...(optional('draw:path-stretchpoint-y') && {
          stretchY: optional('draw:path-stretchpoint-y'),
        }),
      },
    },
  };
}

/** A rectangle's corner radius (`{ cornerRadius }`), else nothing. */
function cornersOf(node: XmlNode): { cornerRadius: number } | undefined {
  const cornerRadius = readCornerRadius(node);
  return cornerRadius === undefined ? undefined : { cornerRadius };
}

/** A group's elements' ids, bottom first – left out when one of them has none. */
function groupMembers(node: XmlNode): { members?: string[] } {
  const ids = childrenOf(node)
    .filter((child) => SHAPE_TAGS.has(tagOf(child) ?? ''))
    .map((child) => attr(child, 'xml:id'));
  return ids.length > 0 && ids.every(Boolean) ? { members: ids as string[] } : {};
}
