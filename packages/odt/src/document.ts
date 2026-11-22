import {
  attr,
  attributeNames,
  buildPart,
  childrenOf,
  cloneNode,
  element,
  parsePart,
  removeAttr,
  setAttr,
  spaceRun,
  tagOf,
  textNode,
  textOf,
  type XmlNode,
  type XmlPart,
} from '@slider/odp/xml';
import {
  isWriterLink,
  WRITER_FORMATS,
  WRITER_LIST_STEP_PT,
  writerTableGrid,
  type WriterAlign,
  type WriterBlock,
  type WriterFormat,
  type WriterFormatLook,
  type WriterKind,
  type WriterList,
  type WriterLook,
  type WriterOperation,
  type WriterPage,
  type WriterParagraph,
  type WriterParagraphBlock,
  WRITER_PICTURE_CHAR,
  type WriterPicture,
  type WriterRun,
  type WriterTableBlock,
} from '@slider/shared';
import { readCredit, writeCredit } from '@slider/odp';
import { OdtArchive } from './archive';
import { LINK_STYLE, NAMED_STYLES } from './blank';
import { OdtError } from './errors';

/*
 * A text document (.odt) as the editor sees it: its paragraphs in reading order, each with an
 * id (`xml:id`), what it is (text, title, heading, quote; in a list or not) and its runs of
 * text – and tables with paragraphs in their cells. Everything else in the file (frames, fields,
 * notes, sections, indexes, the styles) stays as it is: an operation rewrites one paragraph, the
 * rest of the XML is written back byte for byte.
 */

type Props = Record<string, string>;

const PT_PER: Record<string, number> = {
  pt: 1,
  cm: 72 / 2.54,
  mm: 72 / 25.4,
  in: 72,
  pc: 12,
  px: 0.75,
};

/** A length of the file in points; `undefined` for none or one in another measure (`%`). */
export function points(value: string | undefined): number | undefined {
  const match = /^(-?[\d.]+)(pt|cm|mm|in|pc|px)$/.exec(value?.trim() ?? '');
  if (!match) return undefined;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number * (PT_PER[match[2] ?? 'pt'] ?? 1) : undefined;
}

const cm = (pt: number) => `${Number(((pt * 2.54) / 72).toFixed(3))}cm`;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** The step of a list level: the marker hangs in it. The browser draws with the same. */
export const LIST_STEP_PT = WRITER_LIST_STEP_PT;
const BULLETS = ['•', '◦', '▪'];
const LIST_STYLES = { bullet: 'WL_Bullet', number: 'WL_Number' } as const;

const listStyleXml = (kind: 'bullet' | 'number') =>
  `<text:list-style style:name="${LIST_STYLES[kind]}">${Array.from({ length: 9 }, (_, index) => {
    const tag = `text:list-level-style-${kind}`;
    const own =
      kind === 'bullet'
        ? `text:bullet-char="${BULLETS[index % BULLETS.length]}"`
        : `style:num-suffix="." style:num-format="1"`;
    const left = cm(LIST_STEP_PT * (index + 1));
    return `<${tag} text:level="${index + 1}" ${own}><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${left}" fo:text-indent="-0.75cm" fo:margin-left="${left}"/></style:list-level-properties></${tag}>`;
  }).join('')}</text:list-style>`;

const TABLE_STYLES = `<style:style style:name="WTable" style:family="table"><style:table-properties style:width="100%" table:align="margins" fo:margin-top="0.2cm" fo:margin-bottom="0.3cm"/></style:style><style:style style:name="WCell" style:family="table-cell"><style:table-cell-properties fo:padding="0.15cm" fo:border="0.5pt solid #808080"/></style:style>`;

function snippet(xml: string): XmlNode[] {
  const [root] = parsePart(`<w>${xml}</w>`, 'style').nodes;
  return root ? childrenOf(root).filter((node) => tagOf(node) !== null) : [];
}

const isSpace = (node: XmlNode) => tagOf(node) === null && (textOf(node) ?? '').trim() === '';

/** A copy of an element without what is in it and without its id. */
function shellOf(node: XmlNode): XmlNode {
  const tag = tagOf(node) ?? 'text:list';
  const shell = element(tag);
  for (const name of attributeNames(node)) {
    if (name !== 'xml:id') setAttr(shell, name, attr(node, name) ?? '');
  }
  return shell;
}

/** How far a cell reaches over its neighbours, where it does. */
function spansOf(cell: XmlNode): { colSpan?: number; rowSpan?: number } {
  const span = (name: string) => {
    const value = Math.floor(Number(attr(cell, name) ?? 1));
    return Number.isFinite(value) && value > 1 ? Math.min(value, 1000) : undefined;
  };
  const colSpan = span('table:number-columns-spanned');
  const rowSpan = span('table:number-rows-spanned');
  return { ...(colSpan ? { colSpan } : {}), ...(rowSpan ? { rowSpan } : {}) };
}

const holds = (node: XmlNode, target: XmlNode): boolean =>
  node === target ||
  childrenOf(node).some((child) => tagOf(child) !== null && holds(child, target));

const hasElements = (node: XmlNode) => childrenOf(node).some((child) => tagOf(child) !== null);

function rename(node: XmlNode, tag: string): void {
  const current = tagOf(node);
  if (!current || current === tag) return;
  const children = childrenOf(node);
  const attributes = node[':@'];
  delete node[current];
  delete node[':@'];
  node[tag] = children;
  if (attributes) node[':@'] = attributes;
}

// ── Styles ──────────────────────────────────────────────────────────────────

type Family = 'paragraph' | 'text';
const PROPERTIES = {
  text: 'style:text-properties',
  paragraph: 'style:paragraph-properties',
} as const;

function rawProps(style: XmlNode | undefined, kind: keyof typeof PROPERTIES): Props {
  const props: Props = {};
  if (!style) return props;
  const holder = childrenOf(style).find((child) => tagOf(child) === PROPERTIES[kind]);
  if (holder) for (const name of attributeNames(holder)) props[name] = attr(holder, name) ?? '';
  return props;
}

class Styles {
  private readonly byName = new Map<string, XmlNode>();
  private readonly automatic = new Set<XmlNode>();
  private readonly defaults = new Map<string, XmlNode>();
  private readonly lists = new Map<string, XmlNode>();
  private readonly fonts = new Map<string, string>();

  constructor(
    readonly contentAutomatic: XmlNode,
    readonly common: XmlNode,
    fontDecls: readonly XmlNode[],
  ) {
    for (const style of childrenOf(common)) this.add(style, false);
    for (const style of childrenOf(contentAutomatic)) this.add(style, true);
    for (const decls of fontDecls) {
      for (const face of childrenOf(decls)) {
        const name = attr(face, 'style:name');
        const family = attr(face, 'svg:font-family');
        if (name && family) this.fonts.set(name, family.replace(/^['"]|['"]$/g, ''));
      }
    }
  }

  add(style: XmlNode, automatic: boolean): void {
    const tag = tagOf(style);
    const family = attr(style, 'style:family');
    if (tag === 'style:default-style' && family) this.defaults.set(family, style);
    if (tag === 'text:list-style') {
      const name = attr(style, 'style:name');
      if (name) this.lists.set(name, style);
    }
    if (tag !== 'style:style') return;
    const name = attr(style, 'style:name');
    if (!name || !family) return;
    this.byName.set(`${family}:${name}`, style);
    if (automatic) this.automatic.add(style);
  }

  get(family: Family, name: string | undefined): XmlNode | undefined {
    return name ? this.byName.get(`${family}:${name}`) : undefined;
  }

  isAutomatic(style: XmlNode | undefined): boolean {
    return style !== undefined && this.automatic.has(style);
  }

  automaticOf(family: Family): XmlNode[] {
    return [...this.automatic].filter((style) => attr(style, 'style:family') === family);
  }

  listStyle(name: string | undefined): XmlNode | undefined {
    return name ? this.lists.get(name) : undefined;
  }

  /** The style and the ones it builds on, itself first. */
  chain(family: Family, name: string | undefined): XmlNode[] {
    const chain: XmlNode[] = [];
    let current = this.get(family, name);
    while (current && !chain.includes(current) && chain.length < 30) {
      chain.push(current);
      current = this.get(family, attr(current, 'style:parent-style-name'));
    }
    return chain;
  }

  /** The names of a paragraph style's line, itself first. */
  names(name: string | undefined): string[] {
    return this.chain('paragraph', name).map((style) => attr(style, 'style:name') ?? '');
  }

  /** What a style says in the end: the family's default, then its line from the root down. */
  props(family: Family, name: string | undefined, kind: keyof typeof PROPERTIES): Props {
    const merged: Props = {};
    const sources = [this.defaults.get(family), ...this.chain(family, name).reverse()];
    for (const style of sources) {
      for (const [key, value] of Object.entries(rawProps(style, kind))) {
        if (key === 'fo:font-size' && value.endsWith('%')) {
          const base = points(merged[key]);
          const factor = Number.parseFloat(value) / 100;
          if (base !== undefined && Number.isFinite(factor)) merged[key] = `${base * factor}pt`;
        } else merged[key] = value;
      }
    }
    return merged;
  }

  fontOf(text: Props): string | undefined {
    const named = text['style:font-name'];
    return (named && (this.fonts.get(named) ?? named)) || text['fo:font-family'] || undefined;
  }

  /** The roots of the text and of the styles: where a font not yet named there is declared. */
  contentRoot: XmlNode | undefined;
  stylesRoot: XmlNode | undefined;

  /**
   * The name a style says a family by (`style:font-name`): the one its part of the file
   * declares for it, else one declared there now – a style of the text names fonts of
   * content.xml, a named style those of styles.xml. Read back, `fontOf` answers the same family.
   */
  fontName(family: string, part: 'content' | 'styles' = 'content'): string {
    const root = part === 'styles' ? this.stylesRoot : this.contentRoot;
    const kids = root ? childrenOf(root) : [];
    let decls = kids.find((each) => tagOf(each) === 'office:font-face-decls');
    for (const face of decls ? childrenOf(decls) : []) {
      const name = attr(face, 'style:name');
      if (name && attr(face, 'svg:font-family')?.replace(/^['"]|['"]$/g, '') === family) {
        return name;
      }
    }
    // As the other part calls it, where it does; never a name that means another family.
    let name = [...this.fonts].find(([, known]) => known === family)?.[0] ?? family;
    while (
      (this.fonts.has(name) && this.fonts.get(name) !== family) ||
      (decls && childrenOf(decls).some((face) => attr(face, 'style:name') === name))
    ) {
      name += '1';
    }
    if (root) {
      if (!decls) {
        decls = element('office:font-face-decls');
        // Its place in the file: before the styles.
        const at = kids.findIndex((each) =>
          [
            'office:styles',
            'office:automatic-styles',
            'office:master-styles',
            'office:body',
          ].includes(tagOf(each) ?? ''),
        );
        kids.splice(at < 0 ? kids.length : at, 0, decls);
      }
      childrenOf(decls).push(
        element('style:font-face', {
          'style:name': name,
          'svg:font-family': /^[A-Za-z0-9-]+$/.test(family)
            ? family
            : `'${family.replace(/'/g, '')}'`,
        }),
      );
    }
    this.fonts.set(name, family);
    return name;
  }
}

interface Marks {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  highlight: string | undefined;
}

function marksOf(text: Props): Marks {
  const weight = text['fo:font-weight'];
  const style = text['fo:font-style'];
  const underline = text['style:text-underline-style'];
  const strike = text['style:text-line-through-style'];
  const color = text['fo:color'];
  const back = text['fo:background-color'];
  return {
    bold: weight === 'bold' || Number(weight) >= 600,
    italic: style === 'italic' || style === 'oblique',
    underline: underline !== undefined && underline !== 'none',
    strike: strike !== undefined && strike !== 'none',
    color: color && HEX.test(color) ? color.toLowerCase() : '#000000',
    highlight: back && HEX.test(back) ? back.toLowerCase() : undefined,
  };
}

const ALIGNS: Record<string, WriterAlign> = {
  start: 'left',
  left: 'left',
  end: 'right',
  right: 'right',
  center: 'center',
  justify: 'justify',
};
const ALIGN_OUT: Record<WriterAlign, string> = {
  left: 'start',
  right: 'end',
  center: 'center',
  justify: 'justify',
};

function lookOf(styles: Styles, text: Props, paragraph: Props): WriterLook {
  const size = points(text['fo:font-size']) ?? 12;
  const marks = marksOf(text);
  const line = paragraph['fo:line-height'];
  let lineHeight = 1;
  if (line?.endsWith('%')) lineHeight = Number.parseFloat(line) / 100 || 1;
  else if (points(line) !== undefined) lineHeight = (points(line) ?? size) / (size * 1.2);
  return {
    font: styles.fontOf(text) ?? 'Liberation Serif',
    size,
    color: marks.color,
    bold: marks.bold,
    italic: marks.italic,
    lineHeight: Math.min(4, Math.max(0.5, lineHeight)),
    spaceBefore: Math.max(0, points(paragraph['fo:margin-top']) ?? 0),
    spaceAfter: Math.max(0, points(paragraph['fo:margin-bottom']) ?? 0),
    indentLeft: points(paragraph['fo:margin-left']) ?? 0,
    indentRight: points(paragraph['fo:margin-right']) ?? 0,
    indentFirst: points(paragraph['fo:text-indent']) ?? 0,
    align: ALIGNS[paragraph['fo:text-align'] ?? ''] ?? 'left',
  };
}

// ── Reading order ───────────────────────────────────────────────────────────

interface ParagraphItem {
  type: 'paragraph';
  node: XmlNode;
  parent: XmlNode;
  /** The lists and items around it, outermost first: list, item, list, item, … */
  chain: XmlNode[];
  list: WriterList | undefined;
  /** In an index the program writes itself: shown, never typed in. */
  generated: boolean;
  /** The write-protected section it lies in („Ebenen“' lock, LibreOffice's protection). */
  protect?: XmlNode | undefined;
  /** The text or cell it belongs to. */
  scope: XmlNode;
}
/** What is around the blocks being read. */
interface ScanContext {
  generated: boolean;
  flat: boolean;
  /** The write-protected section around them, if any. */
  protect?: XmlNode | undefined;
}
interface TableItem {
  type: 'table';
  node: XmlNode;
  parent: XmlNode;
  scope: XmlNode;
  protect?: XmlNode | undefined;
  rows: { node: XmlNode; parent: XmlNode; cells: { node: XmlNode; items: ParagraphItem[] }[] }[];
}
type Item = ParagraphItem | TableItem;

const INLINE = new Set([
  'text:span',
  'text:s',
  'text:tab',
  'text:line-break',
  'text:a',
  'text:soft-page-break',
  'text:bookmark',
  'text:bookmark-start',
  'text:bookmark-end',
]);

const PICTURE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};
const MAX_PICTURE = 40 * 1024 ** 2;

const missing = () => new OdtError('operation', 'Diesen Absatz gibt es nicht mehr.');
/** Thrown for an operation whose target is gone: dropped, the rest of the step still goes in. */
class Dropped extends Error {}

/** The picture a frame shows, where it is one the browser can be handed. */
function pictureOf(frame: XmlNode): WriterPicture | undefined {
  const image = childrenOf(frame).find((each) => tagOf(each) === 'draw:image');
  const href = image ? attr(image, 'xlink:href') : undefined;
  const type = href ? PICTURE_TYPES[href.split('.').pop()?.toLowerCase() ?? ''] : undefined;
  if (!href || !type || !/^(\.\/)?Pictures\/[^/]+$/.test(href)) return undefined;
  const credit = readCredit(frame);
  return {
    path: href.replace(/^\.\//, ''),
    width: points(attr(frame, 'svg:width')) ?? 200,
    height: points(attr(frame, 'svg:height')) ?? 150,
    ...(credit && { credit }),
  };
}

/** The frames standing in a paragraph's lines, in their order – not what lies in one of them. */
function lineFrames(node: XmlNode, out: XmlNode[] = []): XmlNode[] {
  for (const child of childrenOf(node)) {
    if (tagOf(child) === 'draw:frame') {
      if (attr(child, 'text:anchor-type') === 'as-char' && pictureOf(child)) out.push(child);
    } else if (tagOf(child) !== null) lineFrames(child, out);
  }
  return out;
}

/** The file's named style of each format that is no heading – LibreOffice's own names. */
const NAMED_STYLE_OF = {
  text: 'Text_20_body',
  title: 'Title',
  subtitle: 'Subtitle',
  quote: 'Quotations',
  preformatted: 'Preformatted_20_Text',
  caption: 'Caption',
  header: 'Header',
  footer: 'Footer',
} as const;

/** The words of a head's or foot's lines, one line of them – its page numbers left out. */
function wordsIn(node: XmlNode): string {
  const tag = tagOf(node);
  if (tag === null) return textOf(node) ?? '';
  if (tag === 'text:page-number' || tag === 'text:page-count') return '';
  if (tag === 'text:s' || tag === 'text:tab' || tag === 'text:line-break') return ' ';
  const inner = childrenOf(node).map(wordsIn).join('');
  return tag === 'text:p' || tag === 'text:h' ? ` ${inner} ` : inner;
}
const lineOfWords = (node: XmlNode | undefined) =>
  node ? wordsIn(node).replace(/\s+/g, ' ').trim().slice(0, 500) : '';
const isLine = (node: XmlNode) => tagOf(node) === 'text:p' || tagOf(node) === 'text:h';

/** A line spacing as the file says it: a share of the font's own line. */
const percent = (factor: number) => `${Math.round(factor * 100)}%`;

function sameRun(a: WriterRun, b: WriterRun): boolean {
  return (
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.underline) === Boolean(b.underline) &&
    Boolean(a.strike) === Boolean(b.strike) &&
    a.color === b.color &&
    a.highlight === b.highlight &&
    a.link === b.link &&
    a.font === b.font &&
    a.size === b.size &&
    a.style === b.style
  );
}

export class OdtDocument {
  private items: Item[] | null = null;
  private dirty = false;
  private stylesDirty = false;
  private manifest: XmlPart | null = null;
  private signatures: Record<Family, Map<string, string> | null> = { paragraph: null, text: null };

  private constructor(
    private readonly archive: OdtArchive,
    private readonly content: XmlPart,
    private readonly stylesPart: XmlPart,
    private readonly body: XmlNode,
    private readonly styles: Styles,
  ) {
    this.assignIds();
  }

  static async open(bytes: Uint8Array): Promise<OdtDocument> {
    const archive = await OdtArchive.open(bytes);
    const read = async (path: string) => {
      try {
        return parsePart(await archive.readText(path), path);
      } catch (error) {
        if (error instanceof OdtError) throw error;
        throw new OdtError('corrupt', error instanceof Error ? error.message : String(error));
      }
    };
    const content = await read('content.xml');
    const stylesPart = archive.has('styles.xml')
      ? await read('styles.xml')
      : parsePart('<office:document-styles><office:styles/></office:document-styles>', 'styles');
    const root = content.nodes.find((node) => tagOf(node) === 'office:document-content');
    const child = (node: XmlNode | undefined, tag: string) =>
      node ? childrenOf(node).find((each) => tagOf(each) === tag) : undefined;
    const body = child(child(root, 'office:body'), 'office:text');
    if (!root || !body) throw new OdtError('unsupported', 'The file holds no text.');
    let automatic = child(root, 'office:automatic-styles');
    if (!automatic) {
      automatic = element('office:automatic-styles');
      const kids = childrenOf(root);
      kids.splice(Math.max(0, kids.indexOf(child(root, 'office:body') ?? body)), 0, automatic);
    }
    const stylesRoot = stylesPart.nodes.find((node) => tagOf(node) === 'office:document-styles');
    if (!stylesRoot) throw new OdtError('corrupt', 'styles.xml has no styles.');
    let common = child(stylesRoot, 'office:styles');
    if (!common) {
      common = element('office:styles');
      childrenOf(stylesRoot).unshift(common);
    }
    const fontDecls = [
      child(stylesRoot, 'office:font-face-decls'),
      child(root, 'office:font-face-decls'),
    ];
    const styles = new Styles(
      automatic,
      common,
      fontDecls.filter((each): each is XmlNode => each !== undefined),
    );
    styles.contentRoot = root;
    styles.stylesRoot = stylesRoot;
    return new OdtDocument(archive, content, stylesPart, body, styles);
  }

  /** Whether an operation changed the file. */
  get changed(): boolean {
    return this.dirty;
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  private scan(
    container: XmlNode,
    scope: XmlNode,
    out: Item[],
    context: ScanContext,
  ): void {
    for (const node of childrenOf(container)) {
      const tag = tagOf(node);
      if (tag === 'text:p' || tag === 'text:h') {
        out.push({
          type: 'paragraph',
          node,
          parent: container,
          chain: [],
          list: undefined,
          generated: context.generated,
          protect: context.protect,
          scope,
        });
      } else if (tag === 'text:list') {
        this.scanList(node, [], attr(node, 'text:style-name'), scope, out, context);
      } else if (tag === 'text:section') {
        const protect = attr(node, 'text:protected') === 'true' ? node : context.protect;
        this.scan(node, scope, out, { ...context, protect });
      } else if (tag === 'table:table') {
        if (context.flat) {
          for (const row of this.rowsOf(node)) {
            for (const cell of row.cells) this.scan(cell, scope, out, context);
          }
        } else out.push(this.scanTable(node, container, scope, context));
      } else if (tag?.startsWith('text:') && tag.endsWith('-index')) {
        // „Inhaltsverzeichnis“ and its kin: the program's own text.
        for (const part of childrenOf(node)) {
          if (tagOf(part) === 'text:index-body') {
            this.scan(part, scope, out, { ...context, generated: true });
          }
        }
      } else if (tag === 'text:table-of-content') {
        for (const part of childrenOf(node)) {
          if (tagOf(part) === 'text:index-body') {
            this.scan(part, scope, out, { ...context, generated: true });
          }
        }
      } else if (tag === 'text:index-title') {
        this.scan(node, scope, out, context);
      }
    }
  }

  private scanList(
    list: XmlNode,
    above: XmlNode[],
    styleName: string | undefined,
    scope: XmlNode,
    out: Item[],
    context: ScanContext,
  ): void {
    const level = above.length / 2;
    for (const item of childrenOf(list)) {
      const tag = tagOf(item);
      if (tag !== 'text:list-item' && tag !== 'text:list-header') continue;
      const chain = [...above, list, item];
      for (const node of childrenOf(item)) {
        const inner = tagOf(node);
        if (inner === 'text:p' || inner === 'text:h') {
          out.push({
            type: 'paragraph',
            node,
            parent: item,
            chain,
            list: { kind: this.listKind(styleName, level), level: Math.min(8, level) },
            generated: context.generated,
            protect: context.protect,
            scope,
          });
        } else if (inner === 'text:list') {
          this.scanList(
            node,
            chain,
            attr(node, 'text:style-name') ?? styleName,
            scope,
            out,
            context,
          );
        }
      }
    }
  }

  private listKind(styleName: string | undefined, level: number): 'bullet' | 'number' {
    const style = this.styles.listStyle(styleName);
    const entry = style
      ? childrenOf(style).find((each) => attr(each, 'text:level') === String(level + 1))
      : undefined;
    return entry && tagOf(entry) === 'text:list-level-style-number' ? 'number' : 'bullet';
  }

  private rowsOf(table: XmlNode): { node: XmlNode; parent: XmlNode; cells: XmlNode[] }[] {
    const rows: { node: XmlNode; parent: XmlNode; cells: XmlNode[] }[] = [];
    const walk = (parent: XmlNode) => {
      for (const node of childrenOf(parent)) {
        const tag = tagOf(node);
        if (tag === 'table:table-row') {
          rows.push({
            node,
            parent,
            cells: childrenOf(node).filter((cell) => tagOf(cell) === 'table:table-cell'),
          });
        } else if (
          tag === 'table:table-header-rows' ||
          tag === 'table:table-rows' ||
          tag === 'table:table-row-group'
        ) {
          walk(node);
        }
      }
    };
    walk(table);
    return rows;
  }

  private scanTable(
    node: XmlNode,
    parent: XmlNode,
    scope: XmlNode,
    { generated, protect }: ScanContext,
  ): TableItem {
    return {
      type: 'table',
      node,
      parent,
      scope,
      protect,
      rows: this.rowsOf(node).map((row) => ({
        node: row.node,
        parent: row.parent,
        cells: row.cells.map((cell) => {
          const items: Item[] = [];
          this.scan(cell, cell, items, { generated, flat: true, protect });
          return { node: cell, items: items as ParagraphItem[] };
        }),
      })),
    };
  }

  private all(): Item[] {
    if (!this.items) {
      const items: Item[] = [];
      this.scan(this.body, this.body, items, { generated: false, flat: false });
      this.items = items;
    }
    return this.items;
  }

  private *paragraphs(): Generator<ParagraphItem> {
    for (const item of this.all()) {
      if (item.type === 'paragraph') yield item;
      else for (const row of item.rows) for (const cell of row.cells) yield* cell.items;
    }
  }

  /**
   * Every paragraph and table gets an id – the ones a file came without count up from the
   * first free `w…`, so reading the same file twice names them alike. Kept in the file with the
   * first step written.
   */
  private assignIds(): void {
    const seen = new Set<string>();
    const pending: { node: XmlNode; name: string }[] = [];
    const take = (node: XmlNode, name: string) => {
      const id = attr(node, name);
      if (id && /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(id) && !seen.has(id)) seen.add(id);
      else pending.push({ node, name });
    };
    for (const item of this.all()) {
      if (item.type === 'table') take(item.node, 'table:name');
    }
    for (const paragraph of this.paragraphs()) take(paragraph.node, 'xml:id');
    let next = 0;
    for (const { node, name } of pending) {
      let id: string;
      do {
        next += 1;
        id = `w${next}`;
      } while (seen.has(id));
      seen.add(id);
      setAttr(node, name, id);
    }
  }

  private kindOf(item: ParagraphItem): { kind: WriterKind; level?: number } {
    if (tagOf(item.node) === 'text:h') {
      const level = Number(attr(item.node, 'text:outline-level') ?? 1);
      return { kind: 'heading', level: Math.min(6, Math.max(1, Math.floor(level) || 1)) };
    }
    const names = this.styles.names(attr(item.node, 'text:style-name'));
    if (names.includes('Title')) return { kind: 'title' };
    if (names.includes('Subtitle')) return { kind: 'subtitle' };
    if (names.includes('Quotations')) return { kind: 'quote' };
    if (names.includes('Preformatted_20_Text')) return { kind: 'preformatted' };
    if (names.includes('Caption')) return { kind: 'caption' };
    return { kind: 'text' };
  }

  private readParagraph(item: ParagraphItem): WriterParagraphBlock {
    const styleName = attr(item.node, 'text:style-name');
    const text = this.styles.props('paragraph', styleName, 'text');
    const paragraph = this.styles.props('paragraph', styleName, 'paragraph');
    const leaf = this.styles.get('paragraph', styleName);
    const own = this.styles.isAutomatic(leaf) ? rawProps(leaf, 'paragraph') : {};
    // Its own line spacing is the paragraph's word, not its format's look.
    const ownLine = own['fo:line-height']?.endsWith('%')
      ? Number.parseFloat(own['fo:line-height']) / 100
      : Number.NaN;
    const spaced = Number.isFinite(ownLine) && ownLine > 0;
    const { 'fo:line-height': _line, ...unspaced } = paragraph;
    const inherited = spaced
      ? this.styles.props(
          'paragraph',
          attr(leaf as XmlNode, 'style:parent-style-name'),
          'paragraph',
        )['fo:line-height']
      : undefined;
    const look = lookOf(
      this.styles,
      text,
      spaced ? { ...unspaced, ...(inherited && { 'fo:line-height': inherited }) } : paragraph,
    );
    const runs: WriterRun[] = [];
    const pictures: WriterPicture[] = [];
    let locked = item.generated;

    const push = (value: string, marks: Marks, extra: Partial<WriterRun>, props: Props) => {
      if (value === '') return;
      const font = this.styles.fontOf(props);
      const size = points(props['fo:font-size']);
      const run: WriterRun = { text: value, ...extra };
      if (marks.bold) run.bold = true;
      if (marks.italic) run.italic = true;
      if (marks.underline) run.underline = true;
      if (marks.strike) run.strike = true;
      if (marks.color !== look.color) run.color = marks.color;
      if (marks.highlight) run.highlight = marks.highlight;
      if (font && font !== look.font) run.font = font;
      if (size !== undefined && Math.abs(size - look.size) > 0.01) run.size = size;
      const last = runs.at(-1);
      if (last && !last.picture && sameRun(last, run)) last.text += value;
      else runs.push(run);
    };
    const frame = (node: XmlNode, top: boolean, extra: Partial<WriterRun>) => {
      const picture = pictureOf(node);
      const inLine = attr(node, 'text:anchor-type') === 'as-char';
      if (picture && inLine) {
        // Standing in the line it is part of the text: one character of it.
        runs.push({
          text: WRITER_PICTURE_CHAR,
          picture,
          ...(extra.link && { link: extra.link }),
        });
        return;
      }
      if (picture) pictures.push(picture);
      // What the editor cannot draw in the line, or what lies deeper: the paragraph is left alone.
      if (!top || inLine) locked = true;
    };
    const walk = (nodes: XmlNode[], props: Props, extra: Partial<WriterRun>, top: boolean) => {
      for (const node of nodes) {
        const tag = tagOf(node);
        const marks = marksOf(props);
        if (tag === null) push(textOf(node) ?? '', marks, extra, props);
        else if (tag === 'text:s') push(spaceRun(attr(node, 'text:c')), marks, extra, props);
        else if (tag === 'text:tab') push('\t', marks, extra, props);
        else if (tag === 'text:line-break') push('\n', marks, extra, props);
        else if (tag === 'text:span') {
          const name = attr(node, 'text:style-name');
          const inner = { ...props, ...this.styles.props('text', name, 'text') };
          walk(childrenOf(node), inner, name ? { ...extra, style: name } : extra, false);
        } else if (tag === 'text:a') {
          const href = attr(node, 'xlink:href') ?? '';
          const name = attr(node, 'text:style-name') ?? 'Internet_20_link';
          const inner = { ...props, ...this.styles.props('text', name, 'text') };
          if (isWriterLink(href)) walk(childrenOf(node), inner, { ...extra, link: href }, false);
          else {
            // A jump inside the document: its text shows, the editor does not rewrite it.
            locked = true;
            walk(childrenOf(node), inner, extra, false);
          }
        } else if (tag === 'draw:frame') frame(node, top, extra);
        else if (tag === 'text:note') {
          locked = true;
          const citation = childrenOf(node).find((each) => tagOf(each) === 'text:note-citation');
          if (citation) walk(childrenOf(citation), props, extra, false);
        } else if (tag === 'office:annotation' || tag === 'office:annotation-end') {
          locked = true;
        } else if (!INLINE.has(tag)) {
          // A field, a tracked change, something drawn: its text shows as the file has it.
          locked = true;
          if (!tag.startsWith('draw:') && !tag.startsWith('text:change')) {
            walk(childrenOf(node), props, extra, false);
          }
        }
      }
    };
    walk(childrenOf(item.node), text, {}, true);
    // Pictures and not a word beside them: they stand alone, as one the editor put there.
    if (runs.length > 0 && runs.every((run) => run.picture)) {
      pictures.push(...runs.flatMap((run) => run.picture ?? []));
      runs.length = 0;
      locked = true;
    }

    const block: WriterParagraphBlock = {
      type: 'paragraph',
      id: attr(item.node, 'xml:id') ?? '',
      ...this.kindOf(item),
      runs,
      look,
    };
    const align = ALIGNS[own['fo:text-align'] ?? ''];
    if (align) block.align = align;
    if (item.list) block.list = item.list;
    if (paragraph['fo:break-before'] === 'page') block.breakBefore = true;
    if (spaced) block.lineHeight = Math.min(4, Math.max(0.5, ownLine));
    if (locked) block.locked = true;
    if (item.protect && item.scope === this.body) block.protect = true;
    if (pictures.length > 0) block.pictures = pictures;
    return block;
  }

  private readTable(item: TableItem): WriterTableBlock {
    const widths: number[] = [];
    for (const column of childrenOf(item.node)) {
      if (tagOf(column) !== 'table:table-column') continue;
      const repeat = Math.min(
        64,
        Math.max(1, Number(attr(column, 'table:number-columns-repeated') ?? 1) || 1),
      );
      const style = childrenOf(this.styles.contentAutomatic).find(
        (each) =>
          attr(each, 'style:family') === 'table-column' &&
          attr(each, 'style:name') === attr(column, 'table:style-name'),
      );
      const props = style ? childrenOf(style).find((each) => tagOf(each) !== null) : undefined;
      const width =
        points(props ? attr(props, 'style:column-width') : undefined) ??
        (Number.parseFloat((props && attr(props, 'style:rel-column-width')) || '') || 1);
      for (let index = 0; index < repeat; index += 1) widths.push(Math.max(0.01, width));
    }
    const rows = item.rows.map((row) =>
      row.cells.map((cell) => ({
        blocks: cell.items.map((each) => this.readParagraph(each)),
        ...spansOf(cell.node),
      })),
    );
    // Counted through the cells others reach over – a row of merged cells holds fewer.
    const count = Math.max(1, writerTableGrid(rows).columns);
    const columns = widths.length >= count ? widths.slice(0, count) : Array(count).fill(1);
    const total = columns.reduce((sum: number, width: number) => sum + width, 0);
    return {
      type: 'table',
      id: attr(item.node, 'table:name') ?? '',
      columns: columns.map((width: number) => width / total),
      rows,
      ...(item.protect && { protect: true }),
    };
  }

  /** The document's paragraphs and tables in reading order. */
  blocks(): WriterBlock[] {
    return this.all().map((item) =>
      item.type === 'paragraph' ? this.readParagraph(item) : this.readTable(item),
    );
  }

  /** How each of the editor's formats looks in this file. */
  formats(): Record<WriterFormat, WriterLook> {
    const look = (name: string): WriterLook => {
      const known = this.styles.get('paragraph', name);
      if (!known) {
        // Not in the file yet: as it will be once someone picks it.
        const [style] = snippet(NAMED_STYLES[name] ?? NAMED_STYLES.Standard ?? '');
        const parent = style ? attr(style, 'style:parent-style-name') : undefined;
        const base = parent
          ? look(parent)
          : lookOf(this.styles, this.styles.props('paragraph', undefined, 'text'), {});
        const text = rawProps(style, 'text');
        const paragraph = rawProps(style, 'paragraph');
        const marks = marksOf(text);
        return {
          ...base,
          font: text['style:font-name'] || base.font,
          size: points(text['fo:font-size']) ?? base.size,
          bold: text['fo:font-weight'] ? marks.bold : base.bold,
          italic: text['fo:font-style'] ? marks.italic : base.italic,
          color: text['fo:color'] ? marks.color : base.color,
          lineHeight: paragraph['fo:line-height']?.endsWith('%')
            ? Number.parseFloat(paragraph['fo:line-height']) / 100
            : base.lineHeight,
          spaceBefore: points(paragraph['fo:margin-top']) ?? base.spaceBefore,
          spaceAfter: points(paragraph['fo:margin-bottom']) ?? base.spaceAfter,
          indentLeft: points(paragraph['fo:margin-left']) ?? base.indentLeft,
          indentRight: points(paragraph['fo:margin-right']) ?? base.indentRight,
        };
      }
      return lookOf(
        this.styles,
        this.styles.props('paragraph', name, 'text'),
        this.styles.props('paragraph', name, 'paragraph'),
      );
    };
    return Object.fromEntries(
      WRITER_FORMATS.map((format) => [format, look(this.namedStyle(format, false))]),
    ) as Record<WriterFormat, WriterLook>;
  }

  /** All its words, a paragraph a line – for the search. */
  text(): string {
    const lines: string[] = [];
    for (const paragraph of this.paragraphs()) {
      lines.push(
        this.readParagraph(paragraph)
          .runs.map((run) => run.text)
          .join(''),
      );
    }
    return lines.join('\n');
  }

  // ── The page ──────────────────────────────────────────────────────────────

  private stylesRoot(): XmlNode {
    const root = this.stylesPart.nodes.find((node) => tagOf(node) === 'office:document-styles');
    if (!root) throw new OdtError('corrupt', 'styles.xml has no styles.');
    return root;
  }

  private pageParts(create: boolean): {
    master: XmlNode | undefined;
    layout: XmlNode | undefined;
    props: XmlNode | undefined;
  } {
    const root = this.stylesRoot();
    const section = (tag: string) => {
      let found = childrenOf(root).find((each) => tagOf(each) === tag);
      if (!found && create) {
        found = element(tag);
        childrenOf(root).push(found);
      }
      return found;
    };
    const masters = section('office:master-styles');
    const automatic = section('office:automatic-styles');
    const all = masters
      ? childrenOf(masters).filter((each) => tagOf(each) === 'style:master-page')
      : [];
    let master = all.find((each) => attr(each, 'style:name') === 'Standard') ?? all[0];
    if (!master && create && masters) {
      master = element('style:master-page', {
        'style:name': 'Standard',
        'style:page-layout-name': 'WPage',
      });
      childrenOf(masters).push(master);
    }
    const layoutName = master ? attr(master, 'style:page-layout-name') : undefined;
    let layout = automatic
      ? childrenOf(automatic).find(
          (each) => tagOf(each) === 'style:page-layout' && attr(each, 'style:name') === layoutName,
        )
      : undefined;
    if (!layout && create && automatic && master) {
      layout = element('style:page-layout', { 'style:name': layoutName ?? 'WPage' });
      if (!layoutName) setAttr(master, 'style:page-layout-name', 'WPage');
      childrenOf(automatic).push(layout);
    }
    let props = layout
      ? childrenOf(layout).find((each) => tagOf(each) === 'style:page-layout-properties')
      : undefined;
    if (!props && create && layout) {
      props = element('style:page-layout-properties');
      childrenOf(layout).unshift(props);
    }
    return { master, layout, props };
  }

  private footerOf(master: XmlNode | undefined): XmlNode | undefined {
    return master ? childrenOf(master).find((each) => tagOf(each) === 'style:footer') : undefined;
  }

  private headerOf(master: XmlNode | undefined): XmlNode | undefined {
    return master ? childrenOf(master).find((each) => tagOf(each) === 'style:header') : undefined;
  }

  /** The layout's room for a head or foot: none, then 0.5 cm of air to the text. */
  private partStyle(layout: XmlNode, part: 'header' | 'footer') {
    if (childrenOf(layout).some((each) => tagOf(each) === `style:${part}-style`)) return;
    const air = part === 'header' ? 'fo:margin-bottom' : 'fo:margin-top';
    const style = snippet(
      `<style:${part}-style><style:header-footer-properties fo:min-height="0cm" ${air}="0.5cm"/></style:${part}-style>`,
    );
    // The head's room before the foot's, as the file's schema has them.
    const kids = childrenOf(layout);
    const foot = kids.findIndex((each) => tagOf(each) === 'style:footer-style');
    kids.splice(part === 'header' && foot >= 0 ? foot : kids.length, 0, ...style);
  }

  /** A head of these words alone (none for no words) – what it held before goes. */
  private setHeader(master: XmlNode, layout: XmlNode, words: string) {
    const kids = childrenOf(master);
    const old = this.headerOf(master);
    if (old) kids.splice(kids.indexOf(old), 1);
    if (!words) return;
    this.namedStyle('header', true);
    const head = element('style:header', {}, [
      element('text:p', { 'text:style-name': 'Header' }, [textNode(words)]),
    ]);
    const foot = this.footerOf(master);
    kids.splice(foot ? kids.indexOf(foot) : kids.length, 0, head);
    this.partStyle(layout, 'header');
  }

  /** The foot's own words (over a line with the number alone, which stays). */
  private setFooterWords(master: XmlNode, layout: XmlNode, words: string) {
    let foot = this.footerOf(master);
    if (foot) {
      const lines = childrenOf(foot);
      for (const line of lines.filter((each) => isLine(each) && lineOfWords(each) !== '')) {
        lines.splice(lines.indexOf(line), 1);
      }
    }
    if (words) {
      this.namedStyle('footer', true);
      const line = element('text:p', { 'text:style-name': 'Footer' }, [textNode(words)]);
      if (foot) childrenOf(foot).unshift(line);
      else {
        foot = element('style:footer', {}, [line]);
        childrenOf(master).push(foot);
      }
      this.partStyle(layout, 'footer');
    } else if (foot && !childrenOf(foot).some((each) => tagOf(each) !== null)) {
      const kids = childrenOf(master);
      kids.splice(kids.indexOf(foot), 1);
    }
  }

  page(): WriterPage {
    const { master, props } = this.pageParts(false);
    const length = (name: string, fallback: number) =>
      points(props ? attr(props, name) : undefined) ?? fallback;
    const all = points(props ? attr(props, 'fo:margin') : undefined) ?? (2 * 72) / 2.54;
    const footer = this.footerOf(master);
    const header = lineOfWords(this.headerOf(master));
    const footerWords = lineOfWords(footer);
    return {
      width: length('fo:page-width', (21 * 72) / 2.54),
      height: length('fo:page-height', (29.7 * 72) / 2.54),
      marginTop: length('fo:margin-top', all),
      marginRight: length('fo:margin-right', all),
      marginBottom: length('fo:margin-bottom', all),
      marginLeft: length('fo:margin-left', all),
      numbers: footer !== undefined && JSON.stringify(footer).includes('text:page-number'),
      ...(header && { header }),
      ...(footerWords && { footer: footerWords }),
    };
  }

  private setPage(page: WriterPage): void {
    const { master, layout, props } = this.pageParts(true);
    if (!master || !layout || !props) throw new OdtError('corrupt', 'The file has no page.');
    // Head and foot are written anew only where their words changed: what else they hold stays.
    const was = this.page();
    if ((page.header ?? '') !== (was.header ?? '')) {
      this.setHeader(master, layout, (page.header ?? '').trim());
    }
    if ((page.footer ?? '') !== (was.footer ?? '')) {
      this.setFooterWords(master, layout, (page.footer ?? '').trim());
    }
    removeAttr(props, 'fo:margin');
    setAttr(props, 'fo:page-width', cm(page.width));
    setAttr(props, 'fo:page-height', cm(page.height));
    setAttr(props, 'fo:margin-top', cm(page.marginTop));
    setAttr(props, 'fo:margin-right', cm(page.marginRight));
    setAttr(props, 'fo:margin-bottom', cm(page.marginBottom));
    setAttr(props, 'fo:margin-left', cm(page.marginLeft));
    setAttr(props, 'style:print-orientation', page.width > page.height ? 'landscape' : 'portrait');
    const footer = this.footerOf(master);
    const has = footer !== undefined && JSON.stringify(footer).includes('text:page-number');
    if (page.numbers && !has) {
      this.namedStyle('footer', true);
      const line = element('text:p', { 'text:style-name': 'Footer' }, [
        element('text:page-number', { 'text:select-page': 'current' }, [textNode('1')]),
      ]);
      if (footer) childrenOf(footer).push(line);
      else childrenOf(master).push(element('style:footer', {}, [line]));
      this.partStyle(layout, 'footer');
    } else if (!page.numbers && has && footer) {
      // The lines that are nothing but the number go; one with words of its own stays.
      const lines = childrenOf(footer);
      for (const line of lines.filter(
        (each) =>
          isLine(each) &&
          lineOfWords(each) === '' &&
          JSON.stringify(each).includes('text:page-number'),
      )) {
        lines.splice(lines.indexOf(line), 1);
      }
      if (!lines.some((each) => tagOf(each) !== null)) {
        const kids = childrenOf(master);
        kids.splice(kids.indexOf(footer), 1);
      }
    }
    this.stylesDirty = true;
  }

  // ── Styles written ────────────────────────────────────────────────────────

  /** The named style of a format (`footer` and `link` besides) – added to the file on demand. */
  private namedStyle(format: WriterFormat | 'header' | 'footer', create: boolean): string {
    const name = format.startsWith('heading')
      ? `Heading_20_${format.slice(-1)}`
      : NAMED_STYLE_OF[format as Exclude<WriterFormat, `heading${number}`> | 'header' | 'footer'];
    if (create) this.ensureNamed(name);
    return name;
  }

  /**
   * A format's look changed in the file's named style of it: every paragraph of the format
   * follows through its style's line, unless its own style says that very thing itself.
   */
  private setFormatLook(format: WriterFormat, change: WriterFormatLook): void {
    const style = this.styles.get('paragraph', this.namedStyle(format, true));
    if (!style) throw new Dropped();
    const kids = childrenOf(style);
    const holder = (tag: string, first: boolean) => {
      let found = kids.find((each) => tagOf(each) === tag);
      if (!found) {
        found = element(tag);
        if (first) kids.unshift(found);
        else kids.push(found);
      }
      return found;
    };
    const paragraph = holder(PROPERTIES.paragraph, true);
    const text = holder(PROPERTIES.text, false);
    const set = (names: string[], value: string) => {
      for (const each of names) setAttr(text, each, value);
    };
    if (change.font !== undefined) {
      set(
        ['style:font-name', 'style:font-name-asian', 'style:font-name-complex'],
        this.styles.fontName(change.font, 'styles'),
      );
      removeAttr(text, 'fo:font-family');
    }
    if (change.size !== undefined) {
      set(
        ['fo:font-size', 'style:font-size-asian', 'style:font-size-complex'],
        `${Number(change.size.toFixed(2))}pt`,
      );
    }
    if (change.bold !== undefined) {
      set(
        ['fo:font-weight', 'style:font-weight-asian', 'style:font-weight-complex'],
        change.bold ? 'bold' : 'normal',
      );
    }
    if (change.italic !== undefined) {
      set(
        ['fo:font-style', 'style:font-style-asian', 'style:font-style-complex'],
        change.italic ? 'italic' : 'normal',
      );
    }
    if (change.color !== undefined) setAttr(text, 'fo:color', change.color.toLowerCase());
    if (change.lineHeight !== undefined) {
      setAttr(paragraph, 'fo:line-height', percent(change.lineHeight));
      removeAttr(paragraph, 'style:line-height-at-least');
      removeAttr(paragraph, 'style:line-spacing');
    }
    const space = (name: string, value: number | undefined) => {
      if (value === undefined) return;
      // All four at once would win over the one side said here.
      const all = attr(paragraph, 'fo:margin');
      if (all !== undefined) {
        for (const side of ['top', 'bottom', 'left', 'right']) {
          if (attr(paragraph, `fo:margin-${side}`) === undefined) {
            setAttr(paragraph, `fo:margin-${side}`, all);
          }
        }
        removeAttr(paragraph, 'fo:margin');
      }
      setAttr(paragraph, name, `${Number(value.toFixed(2))}pt`);
    };
    space('fo:margin-top', change.spaceBefore);
    space('fo:margin-bottom', change.spaceAfter);
    for (const each of [paragraph, text]) {
      if (attributeNames(each).length === 0 && !hasElements(each))
        kids.splice(kids.indexOf(each), 1);
    }
    this.stylesDirty = true;
  }

  private ensureNamed(name: string): void {
    if (this.styles.get('paragraph', name)) return;
    const [style] = snippet(NAMED_STYLES[name] ?? '');
    if (!style) return;
    const parent = attr(style, 'style:parent-style-name');
    if (parent) this.ensureNamed(parent);
    // A family of its own (Preformatted Text's mono) needs its font face in this file too.
    const text = childrenOf(style).find((each) => tagOf(each) === 'style:text-properties');
    const family = text && attr(text, 'style:font-name');
    if (text && family) {
      const face = this.styles.fontName(family, 'styles');
      for (const key of ['style:font-name', 'style:font-name-asian', 'style:font-name-complex']) {
        setAttr(text, key, face);
      }
    }
    childrenOf(this.styles.common).push(style);
    this.styles.add(style, false);
    this.stylesDirty = true;
  }

  private ensureLinkStyle(): void {
    if (this.styles.get('text', 'Internet_20_link')) return;
    const [style] = snippet(LINK_STYLE);
    if (!style) return;
    childrenOf(this.styles.common).push(style);
    this.styles.add(style, false);
    this.stylesDirty = true;
  }

  private ensureAutomatic(marker: string, xml: string): void {
    const automatic = this.styles.contentAutomatic;
    if (childrenOf(automatic).some((each) => attr(each, 'style:name') === marker)) return;
    for (const style of snippet(xml)) {
      childrenOf(automatic).push(style);
      this.styles.add(style, true);
    }
  }

  /**
   * An automatic style: `base` (one of the file's own, copied with all it says) or a new one on
   * `parent`, changed by `change`. One that says the same exists: that one. One that says
   * nothing: its parent's name.
   */
  private derive(
    family: Family,
    base: XmlNode | undefined,
    parent: string | undefined,
    change: (text: XmlNode, paragraph: XmlNode) => void,
  ): string | undefined {
    const style = base ? cloneNode(base) : element('style:style', { 'style:family': family });
    setAttr(style, 'style:name', '');
    if (!base && parent) setAttr(style, 'style:parent-style-name', parent);
    const kids = childrenOf(style);
    const holder = (tag: string, first: boolean) => {
      let found = kids.find((each) => tagOf(each) === tag);
      if (!found) {
        found = element(tag);
        if (first) kids.unshift(found);
        else kids.push(found);
      }
      return found;
    };
    const paragraph = holder(PROPERTIES.paragraph, true);
    const text = holder(PROPERTIES.text, false);
    change(text, paragraph);
    for (const each of [paragraph, text]) {
      if (attributeNames(each).length === 0 && !hasElements(each))
        kids.splice(kids.indexOf(each), 1);
    }
    if (!hasElements(style) && !attr(style, 'style:master-page-name')) {
      return attr(style, 'style:parent-style-name');
    }
    let known = this.signatures[family];
    if (!known) {
      known = new Map();
      for (const each of this.styles.automaticOf(family)) {
        const copy = cloneNode(each);
        const name = attr(each, 'style:name') ?? '';
        setAttr(copy, 'style:name', '');
        if (!known.has(JSON.stringify(copy))) known.set(JSON.stringify(copy), name);
      }
      this.signatures[family] = known;
    }
    const signature = JSON.stringify(style);
    const existing = known.get(signature);
    if (existing) return existing;
    const prefix = family === 'text' ? 'Wt' : 'Wp';
    let number = known.size + 1;
    while (this.styles.get(family, `${prefix}${number}`)) number += 1;
    const name = `${prefix}${number}`;
    setAttr(style, 'style:name', name);
    childrenOf(this.styles.contentAutomatic).push(style);
    this.styles.add(style, true);
    known.set(signature, name);
    return name;
  }

  // ── Writing a paragraph ───────────────────────────────────────────────────

  private find(id: string): Item | undefined {
    for (const item of this.all()) {
      if (item.type === 'table') {
        if (attr(item.node, 'table:name') === id) return item;
        for (const row of item.rows) {
          for (const cell of row.cells) {
            const found = cell.items.find((each) => attr(each.node, 'xml:id') === id);
            if (found) return found;
          }
        }
      } else if (attr(item.node, 'xml:id') === id) return item;
    }
    return undefined;
  }

  private paragraph(id: string): ParagraphItem {
    const item = this.find(id);
    if (!item || item.type !== 'paragraph') throw new Dropped();
    return item;
  }

  /** Frames a paragraph let go of in this round of steps: the one that takes their picture gets them. */
  private spareFrames: XmlNode[] = [];

  /**
   * The frame of a picture standing in the line: the file's own where the paragraph (or one
   * changed just before) had it – its name, its style and what else it says stay – else a new one.
   */
  private frameFor(picture: WriterPicture, own: XmlNode[]): XmlNode {
    const refuse = () => new OdtError('operation', 'Dieses Bild ist nicht im Dokument.');
    if (!/^Pictures\/[^/\\]+$/.test(picture.path) || !this.archive.has(picture.path))
      throw refuse();
    if (!PICTURE_TYPES[picture.path.split('.').pop()?.toLowerCase() ?? '']) throw refuse();
    const take = (pool: XmlNode[]) => {
      const at = pool.findIndex((each) => pictureOf(each)?.path === picture.path);
      return at < 0 ? undefined : pool.splice(at, 1)[0];
    };
    const kept = take(own) ?? take(this.spareFrames);
    if (!kept) {
      const made = element(
        'draw:frame',
        {
          'draw:name': `Bild_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
          'text:anchor-type': 'as-char',
          'svg:width': cm(picture.width),
          'svg:height': cm(picture.height),
          'draw:z-index': '0',
        },
        [
          element('draw:image', {
            'xlink:href': picture.path,
            'xlink:type': 'simple',
            'xlink:show': 'embed',
            'xlink:actuate': 'onLoad',
          }),
        ],
      );
      if (picture.credit) writeCredit(made, picture.credit);
      return made;
    }
    const was = pictureOf(kept);
    if (
      was &&
      (Math.abs(was.width - picture.width) > 0.05 || Math.abs(was.height - picture.height) > 0.05)
    ) {
      setAttr(kept, 'svg:width', cm(picture.width));
      setAttr(kept, 'svg:height', cm(picture.height));
      // A size said as a share of the page would win over the one just set.
      removeAttr(kept, 'style:rel-width');
      removeAttr(kept, 'style:rel-height');
    }
    return kept;
  }

  private inline(
    runs: readonly WriterRun[],
    paragraphText: Props,
    frames: XmlNode[] = [],
  ): XmlNode[] {
    const out: XmlNode[] = [];
    const textNodes = (value: string): XmlNode[] => {
      const nodes: XmlNode[] = [];
      // A space at the start, at the end or after a space would be dropped by a reader.
      const parts = value.split(/(\t|\n| {2,}|^ | $)/);
      for (const part of parts) {
        if (part === '') continue;
        if (part === '\t') nodes.push(element('text:tab'));
        else if (part === '\n') nodes.push(element('text:line-break'));
        else if (/^ +$/.test(part) && (part.length > 1 || parts.length > 1)) {
          if (part.length > 1 && nodes.length > 0) {
            nodes.push(textNode(' '));
            nodes.push(
              element('text:s', part.length > 2 ? { 'text:c': String(part.length - 1) } : {}),
            );
          } else
            nodes.push(element('text:s', part.length > 1 ? { 'text:c': String(part.length) } : {}));
        } else nodes.push(textNode(part));
      }
      return nodes;
    };
    const linkProps = () => this.styles.props('text', 'Internet_20_link', 'text');
    let link = null as { href: string; node: XmlNode } | null;
    const place = (piece: XmlNode[], href: string | undefined) => {
      if (!href) {
        link = null;
        out.push(...piece);
        return;
      }
      if (link?.href !== href) {
        link = {
          href,
          node: element('text:a', {
            'xlink:type': 'simple',
            'xlink:href': href,
            'text:style-name': 'Internet_20_link',
            'text:visited-style-name': 'Internet_20_link',
          }),
        };
        out.push(link.node);
      }
      childrenOf(link.node).push(...piece);
    };
    for (const run of runs) {
      if (run.text === '') continue;
      if (run.picture) {
        if (run.text !== WRITER_PICTURE_CHAR) {
          throw new OdtError('operation', 'Dieses Bild ist nicht im Dokument.');
        }
        if (run.link) this.ensureLinkStyle();
        place([this.frameFor(run.picture, frames)], run.link);
        continue;
      }
      const known = this.styles.get('text', run.style);
      const automatic = this.styles.isAutomatic(known);
      if (run.link) this.ensureLinkStyle();
      const basis = {
        ...paragraphText,
        ...(run.link ? linkProps() : {}),
        ...this.styles.props('text', known ? run.style : undefined, 'text'),
      };
      const base = marksOf(basis);
      const paragraphColor = marksOf(paragraphText).color;
      const wanted = {
        bold: Boolean(run.bold),
        italic: Boolean(run.italic),
        // A link looks like one: its format's line stays under it.
        underline: Boolean(run.underline) || (run.link !== undefined && base.underline),
        strike: Boolean(run.strike),
        color: (run.color ?? (run.link ? base.color : paragraphColor)).toLowerCase(),
        highlight: run.highlight?.toLowerCase(),
        // Its own font and size, else the paragraph's – whatever the stretch's style says.
        font: run.font ?? this.styles.fontOf(paragraphText),
        size: run.size ?? points(paragraphText['fo:font-size']) ?? 12,
      };
      const baseFont = this.styles.fontOf(basis);
      const baseSize = points(basis['fo:font-size']) ?? 12;
      const name = this.derive(
        'text',
        automatic ? known : undefined,
        known && !automatic ? run.style : undefined,
        (text) => {
          const set = (names: string[], value: string) => {
            for (const each of names) setAttr(text, each, value);
          };
          if (wanted.bold !== base.bold) {
            set(
              ['fo:font-weight', 'style:font-weight-asian', 'style:font-weight-complex'],
              wanted.bold ? 'bold' : 'normal',
            );
          }
          if (wanted.italic !== base.italic) {
            set(
              ['fo:font-style', 'style:font-style-asian', 'style:font-style-complex'],
              wanted.italic ? 'italic' : 'normal',
            );
          }
          if (wanted.underline !== base.underline) {
            if (wanted.underline) {
              setAttr(text, 'style:text-underline-style', 'solid');
              setAttr(text, 'style:text-underline-width', 'auto');
              setAttr(text, 'style:text-underline-color', 'font-color');
            } else setAttr(text, 'style:text-underline-style', 'none');
          }
          if (wanted.strike !== base.strike) {
            setAttr(text, 'style:text-line-through-style', wanted.strike ? 'solid' : 'none');
            if (wanted.strike) setAttr(text, 'style:text-line-through-type', 'single');
          }
          if (wanted.color !== base.color) setAttr(text, 'fo:color', wanted.color);
          if (wanted.highlight !== base.highlight) {
            setAttr(text, 'fo:background-color', wanted.highlight ?? 'transparent');
          }
          if (wanted.font !== undefined && wanted.font !== baseFont) {
            set(
              ['style:font-name', 'style:font-name-asian', 'style:font-name-complex'],
              this.styles.fontName(wanted.font),
            );
            // A family said outright would win over the name in some readers.
            removeAttr(text, 'fo:font-family');
          }
          if (Math.abs(wanted.size - baseSize) > 0.01) {
            set(
              ['fo:font-size', 'style:font-size-asian', 'style:font-size-complex'],
              `${Number(wanted.size.toFixed(2))}pt`,
            );
          }
        },
      );
      const nodes = textNodes(run.text);
      const piece = name ? [element('text:span', { 'text:style-name': name }, nodes)] : nodes;
      place(piece, run.link);
    }
    return out;
  }

  private setParagraph(id: string, next: WriterParagraph): void {
    let item = this.paragraph(id);
    const now = this.kindOf(item);
    const level = next.kind === 'heading' ? (next.level ?? 1) : undefined;
    const sameKind = now.kind === next.kind && now.level === level;
    const currentName = attr(item.node, 'text:style-name');
    const current = this.styles.get('paragraph', currentName);
    const automatic = this.styles.isAutomatic(current);
    const named = sameKind
      ? ((automatic ? attr(current as XmlNode, 'style:parent-style-name') : currentName) ??
        'Standard')
      : this.namedStyle(
          next.kind === 'heading' ? (`heading${level ?? 1}` as WriterFormat) : next.kind,
          true,
        );
    const inherited = this.styles.props('paragraph', named, 'paragraph');
    const styleName = this.derive(
      'paragraph',
      sameKind && automatic ? current : undefined,
      named,
      (_text, paragraph) => {
        if (next.align) setAttr(paragraph, 'fo:text-align', ALIGN_OUT[next.align]);
        else removeAttr(paragraph, 'fo:text-align');
        const breaks = inherited['fo:break-before'] === 'page';
        if (Boolean(next.breakBefore) === breaks) removeAttr(paragraph, 'fo:break-before');
        else setAttr(paragraph, 'fo:break-before', next.breakBefore ? 'page' : 'auto');
        if (next.lineHeight) {
          setAttr(paragraph, 'fo:line-height', percent(next.lineHeight));
          removeAttr(paragraph, 'style:line-height-at-least');
          removeAttr(paragraph, 'style:line-spacing');
        } else if (attr(paragraph, 'fo:line-height')?.endsWith('%')) {
          // As its format says; a spacing the file gave in another way stays.
          removeAttr(paragraph, 'fo:line-height');
        }
      },
    );
    rename(item.node, next.kind === 'heading' ? 'text:h' : 'text:p');
    if (next.kind === 'heading') setAttr(item.node, 'text:outline-level', String(level ?? 1));
    else removeAttr(item.node, 'text:outline-level');
    if (styleName) setAttr(item.node, 'text:style-name', styleName);
    else removeAttr(item.node, 'text:style-name');

    // What floats beside the text (a picture anchored to the paragraph) stays with it.
    const kids = childrenOf(item.node);
    const floating = kids.filter(
      (each) => tagOf(each)?.startsWith('draw:') && attr(each, 'text:anchor-type') !== 'as-char',
    );
    const text = this.styles.props('paragraph', styleName, 'text');
    const frames = lineFrames(item.node);
    kids.splice(0, kids.length, ...floating, ...this.inline(next.runs, text, frames));
    // A picture that left this paragraph may stand in the next one changed (parted, joined).
    this.spareFrames.push(...frames);

    const sameList = item.list?.kind === next.list?.kind && item.list?.level === next.list?.level;
    if (!sameList) {
      if (item.chain.length > 0) this.liftOut(item);
      this.items = null;
      if (next.list) {
        item = this.paragraph(id);
        this.wrapInList(item, next.list);
      }
    }
    this.items = null;
    this.dirty = true;
  }

  /** Takes a paragraph out of its list: what stood before it stays a list, what came after becomes one of its own. */
  private liftOut(item: ParagraphItem): void {
    const { chain, node } = item;
    const top = chain[0];
    if (!top) return;
    const container = this.parentOf(top, item.scope);
    let after: XmlNode | null = null;
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const holder = chain[index] as XmlNode;
      const child = index === chain.length - 1 ? node : (chain[index + 1] as XmlNode);
      const kids = childrenOf(holder);
      const at = kids.indexOf(child);
      const tail = kids.splice(at + 1);
      if (index === chain.length - 1) kids.splice(at, 1);
      const rest: XmlNode[] = [...(after ? [after] : []), ...tail];
      if (rest.some((each) => tagOf(each) !== null)) {
        const shell = shellOf(holder);
        childrenOf(shell).push(...rest);
        after = shell;
      } else after = null;
    }
    const kids = childrenOf(container);
    kids.splice(kids.indexOf(top) + 1, 0, node, ...(after ? [after] : []));
    // Shells left with nothing in them go, innermost first.
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const holder = chain[index] as XmlNode;
      if (hasElements(holder)) break;
      const above = index === 0 ? container : (chain[index - 1] as XmlNode);
      const siblings = childrenOf(above);
      siblings.splice(siblings.indexOf(holder), 1);
    }
  }

  /** The element `node` is a child of, searched below `scope`. */
  private parentOf(node: XmlNode, scope: XmlNode): XmlNode {
    const search = (holder: XmlNode): XmlNode | null => {
      const kids = childrenOf(holder);
      if (kids.includes(node)) return holder;
      for (const kid of kids) {
        if (tagOf(kid) === null) continue;
        const found = search(kid);
        if (found) return found;
      }
      return null;
    };
    const found = search(scope);
    if (!found) throw missing();
    return found;
  }

  private wrapInList(item: ParagraphItem, list: WriterList): void {
    const styleName = LIST_STYLES[list.kind];
    this.ensureAutomatic(styleName, listStyleXml(list.kind));
    let inner: XmlNode = element('text:list-item', {}, [item.node]);
    for (let level = 0; level < list.level; level += 1) {
      inner = element('text:list-item', {}, [element('text:list', {}, [inner])]);
    }
    const wrapped = element('text:list', { 'text:style-name': styleName }, [inner]);
    const kids = childrenOf(item.parent);
    kids.splice(kids.indexOf(item.node), 1, wrapped);
    // Lists of the same kind standing next to each other are one list: they count on together.
    const neighbour = (from: number, step: 1 | -1): XmlNode | undefined => {
      for (let index = from + step; index >= 0 && index < kids.length; index += step) {
        const each = kids[index] as XmlNode;
        if (isSpace(each)) continue;
        return tagOf(each) === 'text:list' && attr(each, 'text:style-name') === styleName
          ? each
          : undefined;
      }
      return undefined;
    };
    let merged = wrapped;
    const before = neighbour(kids.indexOf(wrapped), -1);
    if (before) {
      childrenOf(before).push(...childrenOf(wrapped));
      kids.splice(kids.indexOf(wrapped), 1);
      merged = before;
    }
    const after = neighbour(kids.indexOf(merged), 1);
    if (after) {
      childrenOf(merged).push(...childrenOf(after));
      kids.splice(kids.indexOf(after), 1);
    }
  }

  // ── Inserting and removing ────────────────────────────────────────────────

  private taken(id: string): boolean {
    return this.find(id) !== undefined;
  }

  /** A new, plain paragraph at the place an operation names – out of any list around it. */
  private insertPlain(
    id: string,
    place: { afterId?: string | undefined; beforeId?: string | undefined },
  ): XmlNode {
    if (this.taken(id)) throw new OdtError('operation', 'Diesen Absatz gibt es schon.');
    // As the editor draws a new paragraph: in the file's format for text.
    const node = element('text:p', {
      'xml:id': id,
      'text:style-name': this.namedStyle('text', true),
    });
    this.placeNode(node, id, place);
    return node;
  }

  /** A block put in the text beside another one (`afterId` / `beforeId`), else at its end. */
  private placeNode(
    node: XmlNode,
    id: string,
    place: { afterId?: string | undefined; beforeId?: string | undefined },
  ): void {
    const refId = place.afterId ?? place.beforeId;
    const after = place.afterId !== undefined;
    if (!refId) {
      childrenOf(this.body).push(node);
    } else {
      const ref = this.find(refId);
      if (!ref) throw new Dropped();
      if (ref.protect && ref.scope === this.body) {
        // Beside a locked one: beside its protected section, never into it.
        const kids = childrenOf(this.parentOf(ref.protect, this.body));
        kids.splice(kids.indexOf(ref.protect) + (after ? 1 : 0), 0, node);
      } else if (ref.type === 'paragraph' && ref.chain.length > 0) {
        // Beside a list's paragraph: as an item of that list first, then lifted out of it –
        // which splits the list exactly there.
        const item = ref.chain.at(-1) as XmlNode;
        const list = ref.chain.at(-2) as XmlNode;
        const fresh = element('text:list-item', {}, [node]);
        const kids = childrenOf(list);
        kids.splice(kids.indexOf(item) + (after ? 1 : 0), 0, fresh);
        this.items = null;
        const placed = this.paragraph(id);
        this.liftOut(placed);
      } else {
        const kids = childrenOf(ref.parent);
        kids.splice(kids.indexOf(ref.node) + (after ? 1 : 0), 0, node);
      }
    }
    this.items = null;
    this.dirty = true;
  }

  /** A block of the text taken out where it is and put in beside another one, as it is. */
  private moveBlock(op: Extract<WriterOperation, { type: 'moveBlock' }>): void {
    const item = this.find(op.id);
    if (!item || item.scope !== this.body || op.afterId === op.id || op.beforeId === op.id) {
      throw new Dropped();
    }
    const refId = op.afterId ?? op.beforeId;
    if (refId && !this.find(refId)) throw new Dropped();
    // Out of its list first: it stands on its own (its paragraph says again where it keeps one).
    if (item.type === 'paragraph' && item.chain.length > 0) this.liftOut(item);
    const parent = this.parentOf(item.node, this.body);
    const kids = childrenOf(parent);
    kids.splice(kids.indexOf(item.node), 1);
    this.items = null;
    if (item.type === 'paragraph') {
      this.placeNode(item.node, op.id, op);
      return;
    }
    // A table goes where a paragraph would (beside a list's paragraph it splits the list).
    const spot = `m${op.id}`.slice(0, 40);
    const placeholder = element('text:p', { 'xml:id': spot });
    this.placeNode(placeholder, spot, op);
    this.replace(placeholder, item.node);
    this.dirty = true;
  }

  private remove(id: string): void {
    const item = this.find(id);
    if (!item) throw new Dropped();
    const scope = item.scope;
    const inScope =
      scope === this.body
        ? this.all().length
        : [...this.paragraphs()].filter((each) => each.scope === scope).length;
    // A text and a cell keep one paragraph: there is always somewhere to type.
    if (inScope <= 1) throw new Dropped();
    const kids = childrenOf(item.parent);
    kids.splice(kids.indexOf(item.node), 1);
    if (item.type === 'paragraph') {
      this.spareFrames.push(...lineFrames(item.node));
      for (let index = item.chain.length - 1; index >= 0; index -= 1) {
        const holder = item.chain[index] as XmlNode;
        if (hasElements(holder)) break;
        const above =
          index === 0 ? this.parentOf(holder, scope) : (item.chain[index - 1] as XmlNode);
        const siblings = childrenOf(above);
        siblings.splice(siblings.indexOf(holder), 1);
      }
    }
    this.items = null;
    this.dirty = true;
  }

  /**
   * Locks a block of the text in a write-protected section of its own (LibreOffice's „Schreibschutz“
   * on a section), or unlocks it: its own section goes, a file's section around more than it is
   * opened as a whole.
   */
  private protectBlock(op: Extract<WriterOperation, { type: 'protectBlock' }>): void {
    const item = this.find(op.id);
    if (!item || item.scope !== this.body) throw new Dropped();
    if (op.protect) {
      if (item.protect) return;
      // Out of its list first, as when it is moved: the section holds it alone.
      if (item.type === 'paragraph' && item.chain.length > 0) this.liftOut(item);
      const names = new Set<string>();
      const collect = (node: XmlNode) => {
        for (const kid of childrenOf(node)) {
          if (tagOf(kid) === null) continue;
          if (tagOf(kid) === 'text:section') names.add(attr(kid, 'text:name') ?? '');
          collect(kid);
        }
      };
      collect(this.body);
      let count = names.size + 1;
      while (names.has(`Gesperrt ${count}`)) count += 1;
      const section = element('text:section', {
        'text:name': `Gesperrt ${count}`,
        'text:protected': 'true',
      });
      this.replace(item.node, section);
      childrenOf(section).push(item.node);
    } else {
      const section = item.protect;
      if (!section) return;
      const blocks = childrenOf(section).filter((kid) => tagOf(kid) !== null);
      if (blocks.length === 1 && blocks[0] === item.node) this.replace(section, item.node);
      else removeAttr(section, 'text:protected');
    }
    this.items = null;
    this.dirty = true;
  }

  private replace(placeholder: XmlNode, node: XmlNode): void {
    const parent = this.parentOf(placeholder, this.body);
    const kids = childrenOf(parent);
    kids.splice(kids.indexOf(placeholder), 1, node);
    this.items = null;
  }

  private cell(id: string, styleName = 'WCell'): XmlNode {
    return element(
      'table:table-cell',
      { 'table:style-name': styleName, 'office:value-type': 'string' },
      [element('text:p', { 'xml:id': id, 'text:style-name': this.namedStyle('text', true) })],
    );
  }

  private insertTable(op: Extract<WriterOperation, { type: 'insertTable' }>): void {
    const ids = op.cells.flat();
    const columns = op.cells[0]?.length ?? 0;
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id) => this.taken(id)) ||
      op.cells.some((row) => row.length !== columns)
    ) {
      throw new OdtError('operation', 'Diese Tabelle passt nicht in das Dokument.');
    }
    this.ensureAutomatic('WTable', TABLE_STYLES);
    const placeholder = this.insertPlain(op.id, op);
    const table = element('table:table', { 'table:name': op.id, 'table:style-name': 'WTable' }, [
      element('table:table-column', { 'table:number-columns-repeated': String(columns) }),
      ...op.cells.map((row) =>
        element(
          'table:table-row',
          {},
          row.map((id) => this.cell(id)),
        ),
      ),
    ]);
    this.replace(placeholder, table);
  }

  private table(id: string): TableItem {
    const item = this.find(id);
    if (!item || item.type !== 'table') throw new Dropped();
    return item;
  }

  private insertRow(op: Extract<WriterOperation, { type: 'insertRow' }>): void {
    const table = this.table(op.tableId);
    const model = table.rows[Math.max(0, Math.min(op.after, table.rows.length - 1))];
    if (!model) throw new Dropped();
    if (op.cells.length !== model.cells.length || op.cells.some((id) => this.taken(id))) {
      throw new OdtError('operation', 'Diese Zeile passt nicht in die Tabelle.');
    }
    const row = shellOf(model.node);
    childrenOf(row).push(
      ...op.cells.map((id, index) => {
        const like = model.cells[index]?.node;
        return this.cell(id, (like && attr(like, 'table:style-name')) || 'WCell');
      }),
    );
    const kids = childrenOf(model.parent);
    kids.splice(kids.indexOf(model.node) + (op.after < 0 ? 0 : 1), 0, row);
    this.items = null;
    this.dirty = true;
  }

  private removeRow(op: Extract<WriterOperation, { type: 'removeRow' }>): void {
    const table = this.table(op.tableId);
    const row = table.rows[op.row];
    if (!row || table.rows.length <= 1) throw new Dropped();
    const kids = childrenOf(row.parent);
    kids.splice(kids.indexOf(row.node), 1);
    this.items = null;
    this.dirty = true;
  }

  /**
   * The table's cells laid out anew. Paragraphs keep their nodes – a merged cell takes what its
   * neighbours held as it is, a parted one hands it back – and rows and cells that stay keep
   * theirs, with all the file says about them.
   */
  private setCells(op: Extract<WriterOperation, { type: 'setCells' }>): void {
    const table = this.table(op.tableId);
    const refuse = () => new OdtError('operation', 'Diese Zellen passen nicht in die Tabelle.');
    const before = writerTableGrid(
      table.rows.map((row) => row.cells.map((cell) => spansOf(cell.node))),
    );
    const grid = writerTableGrid(op.rows);
    // The table keeps its columns, unless the step says how many there are now.
    if (!grid.whole || grid.columns !== (op.columns?.length ?? Math.max(1, before.columns))) {
      throw refuse();
    }
    const named = op.rows.flatMap((row) => row.flatMap((cell) => cell.ids));
    const wanted = new Set(named);
    if (wanted.size !== named.length) throw refuse();

    // What a cell holds, in groups that move as one: a named paragraph (or the list, the table
    // around it) and what stands behind it without a name of its own.
    type OldCell = { node: XmlNode; row: number; column: number };
    type Group = { nodes: XmlNode[]; cell: OldCell; placed: boolean };
    const groups = new Map<string, Group>();
    const known = new Set<string>();
    const styleAt: (string | undefined)[] = [];
    table.rows.forEach((row, rowIndex) => {
      row.cells.forEach((cell, index) => {
        const column = before.at[rowIndex]?.[index] ?? 0;
        styleAt[column] ??= attr(cell.node, 'table:style-name');
        const old: OldCell = { node: cell.node, row: rowIndex, column };
        const idsIn = new Map<XmlNode, string[]>();
        for (const item of cell.items) {
          const id = attr(item.node, 'xml:id') ?? '';
          known.add(id);
          if (!wanted.has(id)) continue;
          const top = childrenOf(cell.node).find((child) => holds(child, item.node));
          if (top) idsIn.set(top, [...(idsIn.get(top) ?? []), id]);
        }
        let group: Group | null = null;
        const ahead: XmlNode[] = [];
        for (const child of childrenOf(cell.node)) {
          const ids = idsIn.get(child);
          if (ids) {
            group = { nodes: [...ahead.splice(0), child], cell: old, placed: false };
            for (const id of ids) groups.set(id, group);
          } else if (group) group.nodes.push(child);
          else ahead.push(child);
        }
      });
    });
    if (named.some((id) => !known.has(id) && this.taken(id))) {
      throw new OdtError('operation', 'Diesen Absatz gibt es schon.');
    }

    const usedCells = new Set<XmlNode>();
    const above: (string | undefined)[] = [];
    let needsOwn = false;
    const built = op.rows.map((row, rowIndex) => {
      let from: number | undefined;
      const cells = row.map((cell, index) => {
        const column = grid.at[rowIndex]?.[index] ?? 0;
        const parts: XmlNode[] = [];
        let home: OldCell | undefined;
        let like: string | undefined;
        for (const id of cell.ids) {
          const group = groups.get(id);
          if (group && !group.placed) {
            group.placed = true;
            parts.push(...group.nodes);
            like ??= attr(group.cell.node, 'table:style-name');
            if (!home && !usedCells.has(group.cell.node)) home = group.cell;
          } else if (!group && !known.has(id)) {
            parts.push(
              element('text:p', {
                'xml:id': id,
                'text:style-name': this.namedStyle('text', true),
              }),
            );
          }
        }
        // A cell always has a paragraph to type in.
        if (!parts.some((part) => tagOf(part) !== null)) throw refuse();
        let node: XmlNode;
        if (home) {
          node = home.node;
          usedCells.add(node);
          from ??= home.row;
        } else {
          const style = like ?? above[column] ?? styleAt[column] ?? styleAt.findLast(Boolean);
          if (!style) needsOwn = true;
          node = element('table:table-cell', {
            'table:style-name': style ?? 'WCell',
            'office:value-type': 'string',
          });
        }
        const span = (name: string, value: number | undefined) => {
          if (value && value > 1) setAttr(node, name, String(value));
          else removeAttr(node, name);
        };
        span('table:number-columns-spanned', cell.colSpan);
        span('table:number-rows-spanned', cell.rowSpan);
        const kids = childrenOf(node);
        kids.splice(0, kids.length, ...parts);
        above[column] = attr(node, 'table:style-name');
        return { node, column };
      });
      return { cells, from };
    });
    if (needsOwn) this.ensureAutomatic('WTable', TABLE_STYLES);

    // Rows: one that holds a cell that stayed is that cell's row; between those, the rows left
    // over are taken in their order, and what is new is made like the row before it.
    const claim: (number | undefined)[] = [];
    let last = -1;
    built.forEach((row, index) => {
      if (row.from !== undefined && row.from > last) {
        claim[index] = row.from;
        last = row.from;
      }
    });
    let free = 0;
    built.forEach((_, index) => {
      if (claim[index] !== undefined) {
        free = (claim[index] ?? 0) + 1;
        return;
      }
      const next = claim.slice(index + 1).find((each) => each !== undefined) ?? table.rows.length;
      if (free < next) {
        claim[index] = free;
        free += 1;
      }
    });
    const stays = new Set(claim.filter((each) => each !== undefined));
    let previous: { node: XmlNode; parent: XmlNode } | undefined;
    const first = table.rows[0];
    built.forEach((row, index) => {
      const old = claim[index] === undefined ? undefined : table.rows[claim[index] ?? 0];
      let placed: { node: XmlNode; parent: XmlNode };
      if (old) placed = { node: old.node, parent: old.parent };
      else {
        const model = previous ?? first;
        if (!model) throw refuse();
        placed = { node: shellOf(model.node), parent: model.parent };
        const siblings = childrenOf(model.parent);
        siblings.splice(siblings.indexOf(model.node) + (previous ? 1 : 0), 0, placed.node);
      }
      const places: XmlNode[] = [];
      for (let column = 0; column < grid.columns; column += 1) {
        const owner = grid.owner[index]?.[column];
        const own = owner?.row === index ? row.cells[owner.index] : undefined;
        places.push(own && own.column === column ? own.node : element('table:covered-table-cell'));
      }
      const kids = childrenOf(placed.node);
      kids.splice(0, kids.length, ...places);
      previous = placed;
    });
    table.rows.forEach((row, index) => {
      if (stays.has(index)) return;
      const siblings = childrenOf(row.parent);
      const at = siblings.indexOf(row.node);
      if (at >= 0) siblings.splice(at, 1);
    });
    this.items = null;
    this.dirty = true;
    if (op.columns) {
      this.setColumns({ type: 'setColumns', tableId: op.tableId, columns: op.columns });
    }
  }

  /** The columns' widths, each a style of its own – as a share and as a length of the table's width. */
  private setColumns(op: Extract<WriterOperation, { type: 'setColumns' }>): void {
    const table = this.table(op.tableId);
    const count = Math.max(
      1,
      writerTableGrid(table.rows.map((row) => row.cells.map((cell) => spansOf(cell.node)))).columns,
    );
    if (op.columns.length !== count) {
      throw new OdtError('operation', 'Diese Spalten passen nicht in die Tabelle.');
    }
    const automatic = childrenOf(this.styles.contentAutomatic);
    const own = automatic.find(
      (each) =>
        attr(each, 'style:family') === 'table' &&
        attr(each, 'style:name') === attr(table.node, 'table:style-name'),
    );
    const props = own ? childrenOf(own).find((each) => tagOf(each) !== null) : undefined;
    const page = this.page();
    const width =
      points(props ? attr(props, 'style:width') : undefined) ??
      Math.max(72, page.width - page.marginLeft - page.marginRight);
    const total = op.columns.reduce((sum, share) => sum + share, 0);
    const kids = childrenOf(table.node);
    // What the file said of a column besides its width stays with it.
    const shells: XmlNode[] = [];
    const isColumns = (node: XmlNode) =>
      tagOf(node) === 'table:table-column' ||
      tagOf(node) === 'table:table-columns' ||
      tagOf(node) === 'table:table-header-columns';
    const collect = (holder: XmlNode) => {
      for (const node of childrenOf(holder)) {
        if (tagOf(node) === 'table:table-column') {
          const repeat = Math.min(
            64,
            Math.max(1, Number(attr(node, 'table:number-columns-repeated') ?? 1) || 1),
          );
          for (let index = 0; index < repeat; index += 1) shells.push(node);
        } else if (isColumns(node)) collect(node);
      }
    };
    collect(table.node);
    const at = Math.max(0, kids.findIndex(isColumns));
    const columns = op.columns.map((share, index) => {
      const part = share / total;
      const length = cm(part * width);
      const rel = Math.max(1, Math.round(part * 65535));
      const name = `WCol${length.replace(/[^0-9]/g, '_')}r${rel}`;
      if (!automatic.some((each) => attr(each, 'style:name') === name)) {
        const style = element(
          'style:style',
          { 'style:name': name, 'style:family': 'table-column' },
          [
            element('style:table-column-properties', {
              'style:column-width': length,
              'style:rel-column-width': `${rel}*`,
            }),
          ],
        );
        automatic.push(style);
        this.styles.add(style, true);
      }
      const column = shells[index]
        ? shellOf(shells[index] as XmlNode)
        : element('table:table-column');
      removeAttr(column, 'table:number-columns-repeated');
      setAttr(column, 'table:style-name', name);
      return column;
    });
    const rest = kids.filter((node) => !isColumns(node));
    kids.splice(0, kids.length, ...rest);
    kids.splice(Math.min(at, kids.length), 0, ...columns);
    this.items = null;
    this.dirty = true;
  }

  private insertPicture(op: Extract<WriterOperation, { type: 'insertPicture' }>): void {
    const { path, width, height, credit } = op.picture;
    if (!/^Pictures\/[A-Za-z0-9_.-]+$/.test(path) || !this.archive.has(path)) {
      throw new OdtError('operation', 'Dieses Bild ist nicht im Dokument.');
    }
    const node = this.insertPlain(op.id, op);
    if (op.align) {
      const align = op.align;
      const styleName = this.derive(
        'paragraph',
        undefined,
        attr(node, 'text:style-name'),
        (_text, paragraph) => setAttr(paragraph, 'fo:text-align', ALIGN_OUT[align]),
      );
      if (styleName) setAttr(node, 'text:style-name', styleName);
    }
    const frame = element(
      'draw:frame',
      {
        'draw:name': `Bild_${op.id}`,
        'text:anchor-type': 'as-char',
        'svg:width': cm(width),
        'svg:height': cm(height),
        'draw:z-index': '0',
      },
      [
        element('draw:image', {
          'xlink:href': path,
          'xlink:type': 'simple',
          'xlink:show': 'embed',
          'xlink:actuate': 'onLoad',
        }),
      ],
    );
    // A photo service's photo names who took it, as on a slide.
    if (credit) writeCredit(frame, credit);
    childrenOf(node).push(frame);
  }

  private applyOne(op: WriterOperation): void {
    // A locked block (or a cell of a locked table) is changed by nothing but its unlocking.
    if (op.type !== 'protectBlock') {
      const target = 'tableId' in op ? op.tableId : 'id' in op ? op.id : undefined;
      if (target && this.find(target)?.protect) throw new Dropped();
    }
    switch (op.type) {
      case 'protectBlock':
        this.protectBlock(op);
        return;
      case 'setParagraph': {
        const item = this.paragraph(op.id);
        if (item.generated) throw new Dropped();
        this.setParagraph(op.id, op.paragraph);
        return;
      }
      case 'insertParagraph':
        this.insertPlain(op.id, op);
        this.setParagraph(op.id, op.paragraph);
        return;
      case 'remove':
        this.remove(op.id);
        return;
      case 'insertTable':
        this.insertTable(op);
        return;
      case 'insertRow':
        this.insertRow(op);
        return;
      case 'removeRow':
        this.removeRow(op);
        return;
      case 'setCells':
        this.setCells(op);
        return;
      case 'setColumns':
        this.setColumns(op);
        return;
      case 'insertPicture':
        this.insertPicture(op);
        return;
      case 'moveBlock':
        this.moveBlock(op);
        return;
      case 'setPage':
        this.setPage(op.page);
        this.dirty = true;
        return;
      case 'setFormatLook':
        this.setFormatLook(op.format, op.look);
        this.dirty = true;
        return;
    }
  }

  /**
   * Writes the operations in their order. One whose paragraph is gone (someone deleted it
   * meanwhile) is left out – its index is answered – and the others still go in.
   */
  apply(operations: readonly WriterOperation[]): number[] {
    const dropped: number[] = [];
    this.spareFrames = [];
    operations.forEach((op, index) => {
      try {
        this.applyOne(op);
      } catch (error) {
        if (!(error instanceof Dropped)) throw error;
        this.items = null;
        dropped.push(index);
      }
    });
    this.spareFrames = [];
    return dropped;
  }

  // ── Pictures ──────────────────────────────────────────────────────────────

  /** Puts a picture's bytes into the file; answers its part's path for `insertPicture`. */
  async addPicture(bytes: Uint8Array, mimeType: string): Promise<string> {
    const extension = Object.entries(PICTURE_TYPES).find(([, type]) => type === mimeType)?.[0];
    if (!extension) throw new OdtError('operation', 'Dieses Bildformat geht hier nicht.');
    const path = `Pictures/${crypto.randomUUID().replace(/-/g, '')}.${extension}`;
    this.archive.write(path, bytes, false);
    if (this.archive.has('META-INF/manifest.xml')) {
      this.manifest ??= parsePart(
        await this.archive.readText('META-INF/manifest.xml'),
        'manifest.xml',
      );
      const root = this.manifest.nodes.find((node) => tagOf(node) === 'manifest:manifest');
      if (root) {
        childrenOf(root).push(
          element('manifest:file-entry', {
            'manifest:full-path': path,
            'manifest:media-type': mimeType,
          }),
        );
      }
    }
    this.dirty = true;
    return path;
  }

  /** A picture of the file, or `null` where the path names none the browser may be handed. */
  async picture(path: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
    const type = PICTURE_TYPES[path.split('.').pop()?.toLowerCase() ?? ''];
    if (!type || !/^Pictures\/[^/\\]+$/.test(path) || !this.archive.has(path)) return null;
    return { bytes: await this.archive.readBinary(path, MAX_PICTURE), mimeType: type };
  }

  async toBytes(): Promise<Uint8Array> {
    this.archive.write('content.xml', buildPart(this.content));
    if (this.stylesDirty) this.archive.write('styles.xml', buildPart(this.stylesPart));
    if (this.manifest) this.archive.write('META-INF/manifest.xml', buildPart(this.manifest));
    return this.archive.toBytes();
  }
}
