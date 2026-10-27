import { createHash } from 'node:crypto';
import type {
  EditableElement,
  EditableElementKind,
  EditableSlide,
  ImageCredit,
  SlideOperation,
} from '@slider/shared';
import { OdpArchive } from './archive';
import { framesShowing, readCredit, writeCredit } from './credit';
import { OdpError } from './errors';
import { imageSize } from './image-size';
import { boxOf, hasPlainGeometry, setBox, shift, type CmBox } from './geometry';
import { explainLive, graphicPropsOf, liveShapeOf } from './live';
import {
  blankText,
  maskElement,
  newElement,
  writeRichText,
  writeShapeStyle,
  type StyleSink,
} from './live-write';
import { renameStyleReferences, sameNode } from './merge';
import { StyleIndex } from './styles';
import { readParagraphs, writeParagraphs } from './text';
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
/** Attributes naming a font family: in font declarations (`svg:`) and in styles (`fo:`, `style:`). */
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
  !/^[a-z][a-z0-9+.-]*:/i.test(href) &&
  !href.startsWith('/') &&
  !href.startsWith('\\') &&
  !href.replace(/\\/g, '/').split('/').includes('..');

/** Attributes that point at a shape by its `xml:id` or `draw:id`. */
const ID_REFERENCES = ['smil:targetElement', 'draw:start-shape', 'draw:end-shape'] as const;

const PICTURE_REF = /Pictures\/[^"'<>\s)&]+/g;
/** Every `xlink:href` of a part, as written (entities still encoded). */
const HREF = /xlink:href="([^"]*)"/g;
/** Pictures larger than this are listed but not read (shown, measured). */
const MAX_PICTURE_BYTES = 20 * 1024 * 1024;
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

/** Styles written from outside that go to content.xml's automatic styles (and `number:*`). */
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
}

const DEFAULT_PAGE = { width: 28, height: 15.75 };

/** How cutouts are drawn (`toCutoutBytes`): 2 – white page and no theme colours in the masks. */
const CUTOUT_FORMAT = 2;

export class OdpDocument {
  private dirty = { content: false, styles: false, manifest: false };
  /** Embedded objects' own parts (`Object 1/content.xml`, …) changed by `removeExternalLinks`. */
  private dirtyEmbedded = new Set<string>();
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

  private presentation(): XmlNode | undefined {
    const body = this.root(this.content, 'office:document-content');
    const officeBody = body && firstChild(body, 'office:body');
    return officeBody && firstChild(officeBody, 'office:presentation');
  }

  private pages(): XmlNode[] {
    return childrenOf(this.presentation() ?? {}).filter((node) => tagOf(node) === 'draw:page');
  }

  private shapesOf(page: XmlNode): XmlNode[] {
    return childrenOf(page).filter((node) => SHAPE_TAGS.has(tagOf(node) ?? ''));
  }

  /** Page size in cm, from the first slide's master page (all slides of a deck share it). */
  pageSize(): { width: number; height: number } {
    const masterName = this.pages()[0] && attr(this.pages()[0] as XmlNode, 'draw:master-page-name');
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
    const size = this.pageSize();
    const hidden = this.hiddenStyles();
    const fingerprints = this.fingerprints();
    const styles = this.styleIndex();
    return this.pages().map((page, index) => {
      const elements = this.shapesOf(page).map((node) => this.describe(node, size, styles));
      const title = elements
        .find((item) => item.role === 'title')
        ?.paragraphs?.join(' ')
        .trim();
      return {
        index,
        name: attr(page, 'draw:name') ?? `Folie ${index + 1}`,
        hidden: hidden.has(attr(page, 'draw:style-name') ?? '\u0000'),
        elements,
        title: title || attr(page, 'draw:name') || `Folie ${index + 1}`,
        fingerprint: fingerprints[index] ?? '',
        pageId: attr(page, 'xml:id') ?? null,
      };
    });
  }

  private kindOf(node: XmlNode): EditableElementKind {
    const tag = tagOf(node);
    if (tag === 'draw:g') return 'group';
    if (tag === 'draw:frame') {
      const inner = elementChildren(node).map(tagOf);
      if (inner.includes('draw:text-box')) return 'text';
      if (inner.includes('table:table')) return 'table';
      if (inner.includes('draw:image')) return 'image';
      return 'other';
    }
    return tag && TEXT_SHAPES.has(tag) ? 'shape' : 'other';
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
  ): EditableElement {
    const kind = this.kindOf(node);
    const box = boxOf(node) ?? { x: 0, y: 0, w: 0, h: 0 };
    const movable = kind !== 'other' && hasPlainGeometry(node);
    const container = this.textContainer(node);
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
      paragraphs: container ? readParagraphs(container) : null,
      movable,
      resizable: movable && kind !== 'group',
      live: movable ? explainLive(styles, node).live : null,
      credit: kind === 'image' ? readCredit(node) : null,
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
    return new StyleIndex(containers, fonts);
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

  /** Where the live editor's writers put their styles (see {@link StyleSink}). */
  private styleSink(): StyleSink {
    const automatic = this.automaticStyles();
    const index = this.styleIndex();
    const prefix = { text: 'T', paragraph: 'P', graphic: 'gr', presentation: 'pr' } as Record<
      string,
      string
    >;
    // Attributes in any order: a style written anew equals the one written before.
    const canonical = (node: XmlNode): string => {
      const tag = tagOf(node);
      if (!tag) return buildPart({ declaration: '', nodes: [node] });
      const attributes = attributeNames(node)
        .filter((name) => name !== 'style:name')
        .sort()
        .map((name) => `${name}=${attr(node, name)}`);
      return `<${tag} ${attributes.join(' ')}>${childrenOf(node).map(canonical).join('')}</${tag}>`;
    };
    const withoutName = canonical;
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
        const family = attr(style, 'style:family') ?? 'graphic';
        const xml = withoutName(style);
        const same = childrenOf(automatic).find(
          (node) =>
            tagOf(node) === 'style:style' &&
            attr(node, 'style:family') === family &&
            withoutName(node) === xml,
        );
        if (same) return attr(same, 'style:name') as string;
        const taken = new Set(this.namedStyles().map((item) => item.name));
        let n = 1;
        const stem = `${this.idPrefix}${prefix[family] ?? 'st'}`;
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
    if (!hasPlainGeometry(node) || !explainLive(this.styleIndex(), node).live) return null;
    blankText(this.styleSink(), node);
    this.dirty.content = true;
    const xml = buildPart({ declaration: '', nodes: [page] }).replace(/ xml:id="[^"]*"/g, '');
    const used = this.stylesXml(styleReferences(page)).xml.join('');
    const fingerprint = createHash('sha256').update(xml).update(used).digest('hex').slice(0, 32);
    return { pageIndex, fingerprint };
  }

  /**
   * Leaves an element out of its slide, and what lies over it – the picture the editor draws it
   * over, live in other colours or places, then what lay over it (`toCutoutBytes`), while its
   * slide is drawn anew. Returns its page and a fingerprint of what the page then shows; `null`
   * for an element not drawn live.
   */
  blankElement(elementId: string): { pageIndex: number; fingerprint: string } | null {
    const { node, page, pageIndex } = this.locate(elementId);
    if (!liveShapeOf(node)) return null;
    // What lies over it goes too: the cutout's third page draws that over the element.
    const children = childrenOf(page);
    const at = children.indexOf(node);
    page[tagOf(page) as string] = [
      ...children.slice(0, at),
      ...children.slice(at + 1).filter((child) => !tagOf(child)?.startsWith('draw:')),
    ];
    this.dirty.content = true;
    const xml = buildPart({ declaration: '', nodes: [page] }).replace(/ xml:id="[^"]*"/g, '');
    const used = this.stylesXml(styleReferences(page)).xml.join('');
    const fingerprint = createHash('sha256').update(xml).update(used).digest('hex').slice(0, 32);
    return { pageIndex, fingerprint };
  }

  /**
   * One hash per slide over its XML without our element ids: changes whenever anything on the
   * slide does, and stays the same for an unchanged slide of another save of the file.
   */
  fingerprints(): string[] {
    return this.pages().map((page) =>
      createHash('sha256')
        .update(buildPart({ declaration: '', nodes: [page] }).replace(/ xml:id="[^"]*"/g, ''))
        .digest('hex')
        .slice(0, 32),
    );
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
      const walk = (node: XmlNode) => {
        for (const child of childrenOf(node)) {
          if (!tagOf(child)) continue;
          for (const name of FONT_FAMILY_ATTRIBUTES) {
            const value = attr(child, name);
            if (value === undefined) continue;
            const family = value.replace(/^\s*['"]|['"]\s*$/g, '').trim();
            const next = family && substitute(family);
            if (!next || next === family) continue;
            setAttr(child, name, /\s/.test(next) ? `'${next}'` : next);
            replaced += 1;
            changed = true;
          }
          walk(child);
        }
      };
      for (const root of part.nodes) walk(root);
      return changed;
    };
    if (replace(this.content)) this.dirty.content = true;
    if (replace(this.styles)) this.dirty.styles = true;
    return replaced;
  }

  // ── Operations ──────────────────────────────────────────────────────────

  private locate(elementId: string): Located {
    const pages = this.pages();
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      const page = pages[pageIndex] as XmlNode;
      const node = this.shapesOf(page).find((shape) => attr(shape, 'xml:id') === elementId);
      if (node) return { node, page, pageIndex };
    }
    throw new OdpError('operation', `Element ${elementId} gibt es auf keiner Folie.`);
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
   * Applies operations in order. An operation that does not fit (unknown element, text on a
   * picture, …) throws an `OdpError('operation')`; the document may then be half changed, so
   * callers apply to a fresh copy and keep it only on success.
   */
  apply(
    operations: readonly SlideOperation[],
    images: ReadonlyMap<string, OdpImage> = new Map(),
  ): void {
    const size = this.pageSize();
    for (const operation of operations) {
      switch (operation.type) {
        case 'deleteSlide':
          this.page(operation.slideIndex);
          if (this.pages().length === 1)
            throw new OdpError('operation', 'Die letzte Folie lässt sich nicht löschen.');
          // Page ids first: the slides that stay keep theirs (see `ensureIds`).
          this.ensureIds();
          this.removeSlide(operation.slideIndex);
          continue;
        case 'setSlideHidden':
          this.setSlideHidden(operation.slideIndex, operation.hidden);
          continue;
        case 'moveSlide':
          this.ensureIds();
          this.moveSlide(operation.slideIndex, operation.to);
          continue;
        case 'addElement':
          this.addElement(operation, size);
          continue;
      }
      const target = this.locate(operation.elementId);
      switch (operation.type) {
        case 'setText':
          this.setText(target, operation.paragraphs);
          break;
        case 'setRichText':
          writeRichText(this.styleSink(), target.node, operation.paragraphs);
          break;
        case 'setShapeStyle':
          writeShapeStyle(this.styleSink(), target.node, operation);
          break;
        case 'setBox':
          this.setBoxOf(target, {
            x: operation.box.x * size.width,
            y: operation.box.y * size.height,
            w: operation.box.w * size.width,
            h: operation.box.h * size.height,
          });
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
        case 'deleteElement':
          this.deleteElement(target);
          break;
        case 'moveElement':
          this.moveElement(target, operation.to);
          break;
      }
      this.dirty.content = true;
    }
  }

  /** A new text frame or rectangle on top of a slide, with the id the editor gave it. */
  private addElement(
    operation: Extract<SlideOperation, { type: 'addElement' }>,
    size: { width: number; height: number },
  ): void {
    const page = this.page(operation.slideIndex);
    if (this.takenIds().has(operation.elementId)) {
      throw new OdpError('operation', `Die Id ${operation.elementId} ist schon vergeben.`);
    }
    const shapes = this.shapesOf(page);
    const label = operation.kind === 'text' ? 'Textfeld' : 'Rechteck';
    const names = new Set(shapes.map((node) => attr(node, 'draw:name')));
    let n = 1;
    while (names.has(`${label} ${n}`)) n += 1;
    const node = newElement(
      this.styleSink(),
      operation,
      {
        x: operation.box.x * size.width,
        y: operation.box.y * size.height,
        w: operation.box.w * size.width,
        h: operation.box.h * size.height,
      },
      `${label} ${n}`,
    );
    const last = shapes.at(-1);
    const siblings = childrenOf(page);
    siblings.splice(last ? siblings.indexOf(last) + 1 : 0, 0, node);
    this.dirty.content = true;
  }

  private setText({ node }: Located, paragraphs: readonly string[]): void {
    const container = this.textContainer(node);
    if (!container) throw new OdpError('operation', 'Dieses Element hat keinen Text.');
    writeParagraphs(container, paragraphs, (paragraph) => {
      const children = childrenOf(container);
      // Shape text comes after title/description and before the geometry.
      const geometry = children.findIndex((child) => tagOf(child) === 'draw:enhanced-geometry');
      children.splice(geometry < 0 ? children.length : geometry, 0, paragraph);
    });
    // A filled placeholder is no longer one (LibreOffice would otherwise show its prompt).
    if (
      attr(node, 'presentation:placeholder') === 'true' &&
      paragraphs.some((text) => text.trim())
    ) {
      removeAttr(node, 'presentation:placeholder');
    }
  }

  private setBoxOf({ node }: Located, box: CmBox): void {
    if (!hasPlainGeometry(node))
      throw new OdpError('operation', 'Dieses Element lässt sich nicht verschieben.');
    const current = boxOf(node);
    if (!current) throw new OdpError('operation', 'Dieses Element lässt sich nicht verschieben.');
    if (tagOf(node) === 'draw:g') {
      shift(node, box.x - current.x, box.y - current.y);
      return;
    }
    setBox(node, box);
  }

  private replaceImage({ node }: Located, image: OdpImage): void {
    const pictures = childrenOf(node).filter((child) => tagOf(child) === 'draw:image');
    const first = pictures[0];
    if (tagOf(node) !== 'draw:frame' || !first)
      throw new OdpError('operation', 'Dieses Element ist kein Bild.');
    const path = this.addPicture(image.bytes, image.mediaType);
    setAttr(first, 'xlink:href', path);
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
    const box = hasPlainGeometry(node) ? boxOf(node) : null;
    if (box && image.width > 0 && image.height > 0) {
      const scale = Math.min(box.w / image.width, box.h / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      setBox(node, { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h });
    }
  }

  /** Puts an element `to`th from the bottom of its slide's elements (counted without it). */
  private moveElement({ node, page }: Located, to: number): void {
    const others = this.shapesOf(page).filter((shape) => shape !== node);
    if (to > others.length) throw new OdpError('operation', 'So viele Ebenen hat die Folie nicht.');
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
  }

  private deleteElement({ node, page }: Located): void {
    removeChild(page, node);
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
    const collect = (node: XmlNode) => {
      for (const child of childrenOf(node)) {
        if (!tagOf(child)) continue;
        for (const name of FONT_FAMILY_ATTRIBUTES) {
          const value = attr(child, name);
          if (value)
            named.add(
              value
                .replace(/^\s*['"]|['"]\s*$/g, '')
                .trim()
                .toLowerCase(),
            );
        }
        collect(child);
      }
    };
    for (const part of [this.content, this.styles]) for (const root of part.nodes) collect(root);
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
    const clean = (value: string) =>
      value
        .replace(/^\s*['"]|['"]\s*$/g, '')
        .trim()
        .toLowerCase();
    const walk = (node: XmlNode, collect: (child: XmlNode) => void) => {
      for (const child of childrenOf(node)) {
        if (!tagOf(child)) continue;
        collect(child);
        walk(child, collect);
      }
    };
    const parts = [this.content, this.styles].flatMap((part) => part.nodes);
    for (const root of parts) {
      walk(root, (child) => {
        const family = attr(child, 'svg:font-family');
        const name = attr(child, 'style:name');
        if (tagOf(child) === 'style:font-face' && family && name) declared.set(name, clean(family));
      });
    }
    for (const root of parts) {
      walk(root, (child) => {
        const family = attr(child, 'fo:font-family');
        if (family) named.add(clean(family));
        const name = attr(child, 'style:font-name');
        const face = name && declared.get(name);
        if (face) named.add(face);
      });
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
          const family = (attr(face, 'svg:font-family') ?? '')
            .replace(/^\s*['"]|['"]\s*$/g, '')
            .trim();
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

  private page(index: number): XmlNode {
    const page = this.pages()[index];
    if (!page) throw new OdpError('operation', `There is no slide ${index + 1}.`);
    return page;
  }

  /** The slide's `draw:page` element as XML. */
  slideXml(index: number): string {
    return buildPart({ declaration: '', nodes: [this.page(index)] });
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
    const styles = this.namedStyles();
    const xml: string[] = [];
    const missing: string[] = [];
    for (const name of new Set(names)) {
      const found = styles.filter((style) => style.name === name);
      if (found.length === 0) missing.push(name);
      for (const style of found) xml.push(buildPart({ declaration: '', nodes: [style.node] }));
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
      const xml = buildPart({ declaration: '', nodes: [node] });
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
      const xml = buildPart({ declaration: '', nodes: [page] });
      for (const match of xml.matchAll(PICTURE_REF)) note(match[0], `slide ${index + 1}`);
    });
    for (const style of this.namedStyles()) {
      const xml = buildPart({ declaration: '', nodes: [style.node] });
      for (const match of xml.matchAll(PICTURE_REF)) note(match[0], style.name);
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
    if (!path.startsWith('Pictures/') || !isPackagePath(path) || !this.archive.has(path))
      return null;
    if (this.archive.size(path) > MAX_PICTURE_BYTES) return null;
    return this.archive.readBinary(path, MAX_PICTURE_BYTES);
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
    const xmlOf = nodes.map((node) => buildPart({ declaration: '', nodes: [node] })).join('');
    if (xmlOf) this.addStyles(xmlOf, { keepExisting: true });
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
    const pageId = attr(old, 'xml:id');
    if (pageId) setAttr(page, 'xml:id', pageId);
    const siblings = childrenOf(this.presentation() as XmlNode);
    siblings[siblings.indexOf(old)] = page;
    this.settle(page);
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
        throw new OdpError('operation', 'The slide to put back has no free page id.');
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
    const taken = this.takenIds();
    const renamed = new Map<string, string>();
    let next = 1;
    for (const node of [copy, ...descendants(copy)]) {
      for (const name of ['xml:id', 'draw:id'] as const) {
        const id = attr(node, name);
        if (!id) continue;
        if (!renamed.has(id)) {
          while (taken.has(`${this.idPrefix}${next}`)) next += 1;
          renamed.set(id, `${this.idPrefix}${next}`);
          taken.add(`${this.idPrefix}${next}`);
        }
        setAttr(node, name, renamed.get(id) as string);
      }
    }
    // References after all ids are renamed (one may point at a shape further down).
    for (const node of [copy, ...descendants(copy)]) {
      for (const name of ID_REFERENCES) {
        const target = attr(node, name);
        if (target && renamed.has(target)) setAttr(node, name, renamed.get(target) as string);
      }
    }
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

  /** Removes slide `index`. */
  removeSlide(index: number): void {
    const page = this.page(index);
    if (this.pages().length === 1) {
      throw new OdpError('operation', 'The last slide of a deck cannot be removed.');
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
   * PowerPoint's „Folie ausblenden“. Slides often share a page style, so the slide gets a copy of
   * its own in content.xml's automatic styles.
   */
  setSlideHidden(index: number, hidden: boolean): void {
    const page = this.page(index);
    const current = attr(page, 'draw:style-name');
    if (this.hiddenStyles().has(current ?? '\u0000') === hidden) return;
    const content = this.root(this.content, 'office:document-content') as XmlNode;
    let automatic = firstChild(content, 'office:automatic-styles');
    if (!automatic) {
      automatic = element('office:automatic-styles');
      const siblings = childrenOf(content);
      const body = siblings.findIndex((node) => tagOf(node) === 'office:body');
      siblings.splice(body === -1 ? siblings.length : body, 0, automatic);
    }
    const original = this.namedStyles().find(
      ({ name, node }) =>
        name === current &&
        tagOf(node) === 'style:style' &&
        attr(node, 'style:family') === 'drawing-page',
    )?.node;
    const style = original
      ? structuredClone(original)
      : element('style:style', { 'style:family': 'drawing-page' });
    const names = new Set(this.namedStyles().map(({ name }) => name));
    let n = 1;
    while (names.has(`${this.idPrefix}dp${n}`)) n += 1;
    const name = `${this.idPrefix}dp${n}`;
    setAttr(style, 'style:name', name);
    let properties = firstChild(style, 'style:drawing-page-properties');
    if (!properties) {
      properties = element('style:drawing-page-properties');
      childrenOf(style).push(properties);
    }
    setAttr(properties, 'presentation:visibility', hidden ? 'hidden' : 'visible');
    childrenOf(automatic).push(style);
    setAttr(page, 'draw:style-name', name);
    this.dirty.content = true;
  }

  /**
   * Puts the slides in `order` (page ids): those in `pages` as that XML (trusted – a stored
   * change), the others as they are; slides not in `order` go.
   */
  arrange(order: readonly string[], pages: ReadonlyMap<string, string>): void {
    if (order.length === 0) throw new OdpError('operation', 'A deck needs a slide.');
    const current = new Map(this.pages().map((page) => [attr(page, 'xml:id') ?? '', page]));
    const placed: XmlNode[] = [];
    for (const id of order) {
      const xml = pages.get(id);
      if (xml === undefined) {
        const page = current.get(id);
        if (!page) throw new OdpError('operation', `There is no slide ${id}.`);
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
   * After a page came in: ids taken elsewhere are dropped and missing ones added, animations of
   * shapes no longer there go.
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
    const ids = new Set(
      own.flatMap((node) =>
        [attr(node, 'xml:id'), attr(node, 'draw:id')].filter((id): id is string => Boolean(id)),
      ),
    );
    this.removeEffects(page, (target) => !ids.has(target));
    this.dirty.content = true;
    this.ensureIds();
  }

  /** What is wrong with XML written from outside, after cleaning it: unknown names, missing files. */
  private authoredProblems(root: XmlNode, knownStyles: ReadonlySet<string>): string[] {
    const content = this.root(this.content, 'office:document-content');
    const prefixes = new Set(['xml']);
    for (const name of content ? attributeNames(content) : []) {
      if (name.startsWith('xmlns:')) prefixes.add(name.slice('xmlns:'.length));
    }
    const problems = new Set<string>();
    const walk = (node: XmlNode) => {
      const tag = tagOf(node) as string;
      for (const name of [tag, ...attributeNames(node)]) {
        const prefix = name.includes(':') ? name.slice(0, name.indexOf(':')) : null;
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
          !this.archive.paths().some((p) => p.startsWith(`${path}/`))
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
    const used = new Set(
      [...content.matchAll(PICTURE_REF), ...styles.matchAll(PICTURE_REF)].map((m) => m[0]),
    );
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
      const walk = (node: XmlNode) => {
        for (const child of childrenOf(node)) {
          if (!tagOf(child)) continue;
          for (const attribute of attributeNames(child)) {
            if (name(attribute)) found.add(attr(child, attribute) ?? '');
          }
          walk(child);
        }
      };
      for (const part of [this.content, this.styles]) for (const root of part.nodes) walk(root);
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
    for (const path of unused) this.archive.remove(path);
    const root = this.manifest && this.root(this.manifest, 'manifest:manifest');
    if (root) {
      const entries = childrenOf(root);
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const entry = entries[i] as XmlNode;
        if (unused.includes(attr(entry, 'manifest:full-path') ?? '')) entries.splice(i, 1);
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
   * The file as LibreOffice is to draw a cutout of an element: its page twice, holding the
   * element alone – no other shape, no master shapes, no page or master background, even on a
   * hidden slide – in black: its area on the first of the two pages, its outline on the second
   * (`maskElement`) – and, when anything lies over it, that alone as it is drawn, on a white
   * page and on a black one; every other page empty. For drawing the element live in other colours or
   * places while its slide is drawn anew. `pages`: the two pages to draw (1-based, as
   * LibreOffice counts them); `fingerprint`: what they show. Changes this document: use it for
   * nothing else afterwards. `null` for an element not drawn live (no text frame or shape).
   * `plain`: its area and outline are one colour each or none, without shadow – the masks
   * painted in its colours, as see-through as `fillOpacity` and `strokeOpacity` (0–1), draw it
   * as LibreOffice does.
   */
  async toCutoutBytes(
    elementId: string,
    substitute: (family: string) => string | null,
  ): Promise<{
    bytes: Uint8Array;
    pages: number[];
    /** Two more pages hold what lies over the element, on white and on black. */
    above: boolean;
    fingerprint: string;
    plain: boolean;
    fillOpacity: number;
    strokeOpacity: number;
  } | null> {
    const { node, page, pageIndex } = this.locate(elementId);
    const shape = liveShapeOf(node);
    if (!shape) return null;
    const props = graphicPropsOf(this.styleIndex(), node);
    // Its look is one colour each or none: masks painted so draw it as LibreOffice does.
    const fillKind = props['draw:fill'] ?? (shape === 'text' ? 'none' : 'solid');
    const strokeKind = props['draw:stroke'] ?? (shape === 'text' ? 'none' : 'solid');
    const plain =
      ['none', 'solid'].includes(fillKind) &&
      ['none', 'solid'].includes(strokeKind) &&
      props['loext:fill-use-slide-background'] !== 'true' &&
      (props['draw:shadow'] ?? 'hidden') === 'hidden' &&
      !props['draw:opacity-name'];
    const share = (value: string | undefined) => {
      const percent = value === undefined ? NaN : Number.parseFloat(value);
      return Number.isFinite(percent) ? Math.min(1, Math.max(0, percent / 100)) : 1;
    };
    // What lies over it (later on the page) is drawn on a page of its own, as it is.
    const over = childrenOf(page)
      .slice(childrenOf(page).indexOf(node) + 1)
      .filter((child) => tagOf(child)?.startsWith('draw:'));
    this.keepForDrawing([pageIndex]);
    const sink = this.styleSink();
    // A page of its own colour: without a style LibreOffice paints the master's background
    // presentation style (`<master>-background`), which may be dark.
    const ground = (color: string) =>
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
    childrenOf(page).splice(0, childrenOf(page).length, node);
    setAttr(page, 'draw:style-name', ground('#ffffff'));
    const styles = this.root(this.styles, 'office:document-styles');
    const masterName = attr(page, 'draw:master-page-name');
    const master = childrenOf((styles && firstChild(styles, 'office:master-styles')) ?? {}).find(
      (child) => tagOf(child) === 'style:master-page' && attr(child, 'style:name') === masterName,
    );
    if (master) {
      childrenOf(master).length = 0;
      removeAttr(master, 'draw:style-name');
      this.dirty.styles = true;
    }
    const outline = structuredClone(page);
    const withoutIds = (at: XmlNode) => {
      removeAttr(at, 'xml:id');
      removeAttr(at, 'draw:id');
      for (const child of childrenOf(at)) if (tagOf(child)) withoutIds(child);
    };
    withoutIds(outline);
    const list = childrenOf(this.presentation() ?? {});
    const added = [outline];
    if (over.length > 0) {
      // Twice, on white and on black: LibreOffice paints every page, and the two tell how
      // opaque each pixel of what lies over the element is, and its colour.
      for (const color of ['#ffffff', '#000000']) {
        const above = structuredClone(page);
        childrenOf(above).splice(0, childrenOf(above).length, ...structuredClone(over));
        withoutIds(above);
        setAttr(above, 'draw:style-name', ground(color));
        added.push(above);
      }
    }
    list.splice(list.indexOf(page) + 1, 0, ...added);
    maskElement(sink, node, 'fill', props);
    const outlined = childrenOf(outline).find((child) => tagOf(child));
    if (outlined) maskElement(sink, outlined, 'stroke', props);
    // What the pages show, however their styles are written: a cutout is drawn once per look –
    // the element by what its masks resolve to, what lies over it by its styles.
    const unnamed = (xml: string) =>
      xml.replace(/ (?:xml:id|draw:id|style:name|[a-z]+:(?:text-)?style-name)="[^"]*"/g, '');
    const index = this.styleIndex();
    const looks = [node, outlined]
      .filter((at): at is XmlNode => at !== undefined)
      .map((at) => JSON.stringify(Object.entries(graphicPropsOf(index, at)).sort()));
    const overStyles = this.stylesXml(added.slice(1).flatMap((at) => [...styleReferences(at)])).xml;
    const fingerprint = createHash('sha256')
      // Raised when the masks are drawn differently: cutouts stored before are drawn anew.
      .update(`cutout ${CUTOUT_FORMAT}\n`)
      .update(unnamed(buildPart({ declaration: '', nodes: [page, ...added] })))
      .update(looks.join(''))
      .update(overStyles.map(unnamed).sort().join(''))
      .digest('hex')
      .slice(0, 32);
    return {
      bytes: await this.drawingBytes(substitute),
      pages: [page, ...added].map((_, i) => pageIndex + 1 + i),
      above: added.length > 1,
      fingerprint,
      plain,
      fillOpacity: share(props['draw:opacity']),
      strokeOpacity: share(props['svg:stroke-opacity']),
    };
  }

  /**
   * The file as LibreOffice is to draw a slide taken apart (the layers view): its page without
   * its elements – page and master background, master shapes – then, for every element bottom
   * first, two pages holding that element alone, on white and on black (the two tell how opaque
   * each pixel is, and its colour); every other page empty. `pages`: those to draw (1-based, as
   * LibreOffice counts them); `elementIds`: the elements in that order; `background` and
   * `layers` (in that order too): what each part shows – the same wherever the element lies in
   * the stack, so a part drawn once is drawn for good. Changes this document: use it for nothing
   * else afterwards.
   */
  async toLayerBytes(
    pageIndex: number,
    substitute: (family: string) => string | null,
  ): Promise<{
    bytes: Uint8Array;
    pages: number[];
    elementIds: string[];
    background: string;
    layers: string[];
  }> {
    const page = this.page(pageIndex);
    const shapes = this.shapesOf(page);
    const elementIds = shapes.map((node) => attr(node, 'xml:id') ?? '');
    this.keepForDrawing([pageIndex]);
    const children = childrenOf(page);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      if (shapes.includes(children[i] as XmlNode)) children.splice(i, 1);
    }
    const sink = this.styleSink();
    const onColor = (color: string) =>
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
    const styles = { white: onColor('#ffffff'), black: onColor('#000000') };
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
    const withoutIds = (at: XmlNode) => {
      removeAttr(at, 'xml:id');
      removeAttr(at, 'draw:id');
      for (const child of childrenOf(at)) if (tagOf(child)) withoutIds(child);
    };
    const added: XmlNode[] = [];
    const unnamed = (xml: string) =>
      xml.replace(/ (?:xml:id|draw:id|style:name|[a-z]+:style-name)="[^"]*"/g, '');
    const size = JSON.stringify(this.pageSize());
    const fingerprintOf = (nodes: XmlNode[], ...also: string[]) => {
      const hash = createHash('sha256')
        .update(unnamed(buildPart({ declaration: '', nodes })))
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
    const layers: string[] = [];
    for (const shape of shapes) {
      for (const style of [styles.white, styles.black]) {
        const alone = structuredClone(page);
        childrenOf(alone).splice(0, childrenOf(alone).length, structuredClone(shape));
        withoutIds(alone);
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
    return {
      bytes: await this.drawingBytes(substitute),
      pages: [page, ...added].map((_, i) => pageIndex + 1 + i),
      elementIds,
      background,
      layers,
    };
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
