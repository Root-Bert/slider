import { createCanvas, loadImage } from '@napi-rs/canvas';
import { asc, eq } from 'drizzle-orm';
import type { OdpMasterPage, OdpSlide } from '@slider/odp';
import {
  freeFontName,
  layoutGuidesOf,
  type EditableElement,
  type FillLayer,
  type Guide,
  type LayoutGrid,
  type LiveTextStyle,
  type TemplateColor,
} from '@slider/shared';
import { deckBoardItems, decks, workspaceMasters } from '../db/schema';
import type { AppDeps } from '../deps';
import type { EditTarget } from './edits';
import { workspaceFontsOf } from './workspace-fonts';
import { describeMaterial, materialsOf, notesOn } from './material-tools';

/*
 * What the AI knows of a deck besides its XML (BER-183): the design it is made in – colours,
 * fonts and the sizes each role takes, the grid, guides and margins, the layouts and where things
 * usually sit – each slide as a list of its elements measured in cm, and a check of a slide's
 * layout that measures what a designer would look at (edges that almost line up, uneven gaps,
 * text too close to the edge, sizes and colours foreign to the deck). Pictures of several slides
 * at once and parts of one slide close up come from here too. All of it is read from the file and
 * the workspace; nothing here judges – the AI looks at the pictures and decides.
 */

/** What the workspace says of a deck's design besides its file. */
export interface DeckDesign {
  title: string;
  /** The template it is built on, or – a template being designed – itself. */
  template: string | null;
  /** The template's colours, with what each is for. */
  palette: TemplateColor[];
  /** The deck's own colours beside them. */
  custom: string[];
  grid: LayoutGrid | null;
  /** Guides as fractions of the page – every layout's (each has its own), once each. */
  guides: Guide[];
  /** Fonts uploaded to the workspace (they draw), by family. */
  workspaceFonts: string[];
}

/** `guides` without one twice (the same line on several layouts). */
export function uniqueGuides(guides: Iterable<Guide>): Guide[] {
  const seen = new Map<string, Guide>();
  for (const guide of guides) seen.set(`${guide.orientation}:${guide.position}`, guide);
  return [...seen.values()];
}

/**
 * The deck's design as the workspace keeps it – its template's colours, grid and guides. `file`:
 * the page ids of the deck's file and the guides its slides show – a template being designed
 * lists its layouts' guides (only those of the layouts it has: a layout gone keeps its guides for
 * undo, the AI never hears of them); a deck made from one the guides its file brings along.
 */
export async function deckDesign(
  deps: AppDeps,
  target: EditTarget,
  file: { pageIds: readonly (string | null)[]; guides: () => Promise<Guide[]> },
): Promise<DeckDesign> {
  const { deck } = target;
  let template: string | null = null;
  let palette: TemplateColor[] = [];
  let grid: LayoutGrid | null = null;
  let guides: Guide[] = [];
  if (deck.isTemplate && deck.templateDesign) {
    template = 'this deck itself – a template being designed, each slide a layout';
    palette = deck.templateDesign.colors ?? [];
    grid = deck.templateDesign.grid ?? null;
    const design = deck.templateDesign;
    guides = uniqueGuides(file.pageIds.flatMap((pageId) => layoutGuidesOf(design, pageId)));
  } else if (deck.masterId) {
    const [row] = await deps.db
      .select({
        name: workspaceMasters.name,
        colors: workspaceMasters.colors,
        design: decks.templateDesign,
      })
      .from(workspaceMasters)
      .leftJoin(decks, eq(decks.id, workspaceMasters.draftDeckId))
      .where(eq(workspaceMasters.id, deck.masterId));
    if (row) {
      template = row.name;
      palette = row.colors;
      grid = row.design?.grid ?? null;
      // Shared by its layouts (a template from before each had its own); else its file's.
      guides = row.design?.guides ?? [];
    }
  }
  const [own, fonts] = await Promise.all([
    guides.length > 0 ? Promise.resolve([]) : file.guides().catch(() => []),
    workspaceFontsOf(deps, deck.workspaceId).catch(() => []),
  ]);
  return {
    title: deck.title,
    template,
    palette,
    custom: deck.customColors,
    grid: grid && (grid.columns.count > 0 || grid.rows.count > 0) ? grid : null,
    guides: guides.length > 0 ? guides : own,
    workspaceFonts: [...new Set(fonts.map((font) => font.family))].sort(),
  };
}

// ── Measuring ────────────────────────────────────────────────────────────

/** Page size in cm. */
export interface PageSize {
  width: number;
  height: number;
}

/** Points per cm. */
const PT_PER_CM = 72 / 2.54;

const round = (value: number, places = 2) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};
const cm = (value: number) => `${round(value)}`;

/** An element's box in cm, with its right and bottom edges and centre. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  right: number;
  bottom: number;
  cx: number;
  cy: number;
}

function boxOf(element: EditableElement, size: PageSize): Box {
  const x = element.bbox.x * size.width;
  const y = element.bbox.y * size.height;
  const w = element.bbox.w * size.width;
  const h = element.bbox.h * size.height;
  return { x, y, w, h, right: x + w, bottom: y + h, cx: x + w / 2, cy: y + h / 2 };
}

/** A length of ODF (`2.5cm`, `25mm`, `1in`, `72pt`) in cm. */
function lengthCm(value: string): number | null {
  const match = /^(-?[\d.]+)(cm|mm|in|pt|pc|px)?$/.exec(value.trim());
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  const factor: Record<string, number> = {
    cm: 1,
    mm: 0.1,
    in: 2.54,
    pt: 2.54 / 72,
    pc: 2.54 / 6,
    px: 2.54 / 96,
  };
  return number * (factor[match[2] ?? 'cm'] ?? 1);
}

/** The master page a slide's XML names. */
export const masterOf = (xml: string): string | null =>
  /draw:master-page-name="([^"]*)"/.exec(xml)?.[1] ?? null;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Plain text of a piece of ODF XML, one line per paragraph. */
function plainText(xml: string): string {
  return [...xml.matchAll(/<text:(?:p|h)\b[^>]*>([\s\S]*?)<\/text:(?:p|h)>/g)]
    .map(([, inner]) =>
      (inner ?? '')
        .replace(/<text:tab\s*\/>/g, '\t')
        .replace(/<text:line-break\s*\/>/g, '\n')
        .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_, count?: string) =>
          ' '.repeat(Number(count ?? 1)),
        )
        .replace(/<[^>]+>/g, '')
        .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] ?? ''),
    )
    .join('\n')
    .trim();
}

/** The speaker notes of a slide's XML. */
export function notesOf(xml: string): string {
  const notes = /<presentation:notes\b[\s\S]*?<\/presentation:notes>/.exec(xml)?.[0];
  return notes ? plainText(notes) : '';
}

/** A stretch of text in one style. */
type Run = LiveTextStyle & { text: string };

/** An element whose text the live editor cannot take, with its runs read from its styles. */
type LookedElement = EditableElement & { looks?: Run[] };

/**
 * The runs of an element's text, with their style – an empty paragraph by its mark; for text the
 * live editor cannot take, as {@link withTextLooks} read them.
 */
function runsOf(element: EditableElement): Run[] {
  if (!element.live) return (element as LookedElement).looks ?? [];
  return element.live.paragraphs.flatMap((paragraph) =>
    paragraph.runs.length > 0 ? paragraph.runs : [{ ...paragraph.mark, text: '' }],
  );
}

/** What a style says of text, and the style it builds on. */
interface TextProps {
  font?: string;
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  parent?: string;
}

const attribute = (xml: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(xml)?.[1];

/** Reads text properties of styles by name, following each style to the one it builds on. */
class StyleReader {
  private readonly read = new Map<string, TextProps | null>();
  constructor(
    private readonly styleXml: (name: string) => string | null,
    /** The font families the file names, in lower case. */
    private readonly families: ReadonlySet<string>,
  ) {}

  /**
   * The family a `style:font-name` stands for: its declaration's name is mostly the family, or
   * the family numbered when several declarations share it („Arial 2“).
   */
  private family(name: string): string {
    const base = name.replace(/\s*\d+$/, '');
    return base && base !== name && this.families.has(base.toLowerCase()) ? base : name;
  }

  private props(name: string): TextProps | null {
    if (this.read.has(name)) return this.read.get(name)!;
    const xml = this.styleXml(name);
    let props: TextProps | null = null;
    if (xml) {
      const text = /<style:text-properties\b[^>]*>/.exec(xml)?.[0] ?? '';
      const size = attribute(text, 'fo:font-size');
      const declared = attribute(text, 'style:font-name');
      const family =
        attribute(text, 'fo:font-family') ?? (declared ? this.family(declared) : undefined);
      const weight = attribute(text, 'fo:font-weight');
      const color = attribute(text, 'fo:color');
      const style = attribute(text, 'fo:font-style');
      const head = /<style:style\b[^>]*>/.exec(xml)?.[0] ?? '';
      props = {
        ...(family ? { font: family.replace(/^['"]|['"]$/g, '') } : {}),
        ...(size?.endsWith('pt') ? { size: Number.parseFloat(size) } : {}),
        ...(color && /^#[0-9a-f]{6}$/i.test(color) ? { color: color.toLowerCase() } : {}),
        ...(weight ? { bold: weight === 'bold' || Number(weight) >= 600 } : {}),
        ...(style ? { italic: style === 'italic' || style === 'oblique' } : {}),
        ...(attribute(head, 'style:parent-style-name')
          ? { parent: attribute(head, 'style:parent-style-name') }
          : {}),
      };
    }
    this.read.set(name, props);
    return props;
  }

  /** The look of text styled by `names`, the nearest first – each followed to its parents. */
  resolve(names: readonly (string | undefined)[]): Omit<TextProps, 'parent'> {
    const out: Omit<TextProps, 'parent'> = {};
    for (const first of names) {
      let name = first;
      for (let depth = 0; name && depth < 6; depth += 1) {
        const props = this.props(name);
        if (!props) break;
        out.font ??= props.font;
        out.size ??= props.size;
        out.color ??= props.color;
        out.bold ??= props.bold;
        out.italic ??= props.italic;
        name = props.parent;
      }
    }
    return out;
  }
}

/** The text of one paragraph's XML without its tags. */
const spanText = (xml: string) =>
  xml
    .replace(/<text:(?:tab|line-break)\s*\/>/g, ' ')
    .replace(/<text:s\b[^>]*\/>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] ?? '');

/**
 * The slides with the text of elements the live editor cannot take (custom shapes, turned or
 * transformed ones) read from the styles their spans, paragraphs and frame name – so their
 * fonts, sizes and colours count too.
 */
export function withTextLooks(
  slides: OdpSlide[],
  slideXml: (index: number) => string,
  styleXml: (name: string) => string | null,
  families: ReadonlySet<string>,
): OdpSlide[] {
  const reader = new StyleReader(styleXml, families);
  return slides.map((slide) => {
    if (!slide.elements.some((element) => !element.live && textOf(element))) return slide;
    const xml = slideXml(slide.index);
    return {
      ...slide,
      elements: slide.elements.map((element): LookedElement => {
        if (element.live || !textOf(element) || !element.id) return element;
        const at = xml.indexOf(`xml:id="${element.id}"`);
        const start = xml.lastIndexOf('<', at);
        const tag = /^<([\w:-]+)/.exec(xml.slice(start))?.[1];
        const end = tag ? xml.indexOf(`</${tag}>`, at) : -1;
        if (at === -1 || end === -1) return element;
        const chunk = xml.slice(start, end);
        const opening = /^<[^>]*>/.exec(chunk)?.[0] ?? '';
        const frame = [
          attribute(opening, 'draw:text-style-name'),
          attribute(opening, 'presentation:style-name'),
          attribute(opening, 'draw:style-name'),
        ];
        const looks: Run[] = [];
        for (const [, open = '', inner = ''] of chunk.matchAll(
          /<text:(?:p|h)\b([^>]*)>([\s\S]*?)<\/text:(?:p|h)>/g,
        )) {
          const paragraph = attribute(open, 'text:style-name');
          const pieces: [string | undefined, string][] = [];
          let rest = inner;
          for (const [whole, spanOpen = '', spanInner = ''] of inner.matchAll(
            /<text:span\b([^>]*)>([\s\S]*?)<\/text:span>/g,
          )) {
            pieces.push([attribute(spanOpen, 'text:style-name'), spanText(spanInner)]);
            rest = rest.replace(whole, ' ');
          }
          pieces.push([undefined, spanText(rest)]);
          for (const [span, text] of pieces) {
            if (!text.trim()) continue;
            const look = reader.resolve([span, paragraph, ...frame]);
            if (!look.font && !look.size && !look.color) continue;
            looks.push({
              font: look.font ?? 'unknown font',
              size: look.size ?? 18,
              color: look.color ?? '#000000',
              bold: look.bold ?? false,
              italic: look.italic ?? false,
              underline: false,
              text: text.trim(),
            });
          }
        }
        return looks.length > 0 ? { ...element, looks } : element;
      }),
    };
  });
}

const textOf = (element: EditableElement) => (element.paragraphs ?? []).join('\n').trim();

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** What an element is in a deck's terms: its placeholder role, else its kind. */
const roleOf = (element: EditableElement) => element.role ?? element.kind;

/** Footers, page numbers and dates: small on purpose. */
const SMALL_ROLES = new Set(['footer', 'page-number', 'date-time', 'header']);

/** Drawn at all: an empty placeholder draws nothing on the slide. */
const draws = (element: EditableElement) => !element.live?.placeholder;

/** Covers (almost) the whole page – a background, not a thing to line up. */
function fullBleed(box: Box, size: PageSize): boolean {
  return box.w >= size.width * 0.97 || box.h >= size.height * 0.97;
}

const colorName = (hex: string) => hex.toLowerCase();

/** Relative luminance of `#rrggbb` (WCAG). */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

function fillText(layer: FillLayer): string {
  const opacity = layer.opacity < 1 ? ` at ${Math.round(layer.opacity * 100)}%` : '';
  const hidden = layer.visible ? '' : ' (hidden)';
  if (layer.type === 'solid') return `${layer.color}${opacity}${hidden}`;
  if (layer.type === 'gradient') {
    const stops = layer.stops
      .map((stop) =>
        stop.opacity !== undefined && stop.opacity < 1
          ? `${stop.color} ${Math.round(stop.opacity * 100)}%`
          : stop.color,
      )
      .join(' → ');
    return `${layer.kind} gradient ${Math.round(layer.angle)}° ${stops}${opacity}${hidden}`;
  }
  return `picture ${layer.src} (${layer.fit})${opacity}${hidden}`;
}

/** The colours an element shows: its text's and its fill's and border's. */
function colorsOf(element: EditableElement): { text: string[]; fill: string[] } {
  const text = runsOf(element)
    .filter((run) => run.text.trim())
    .map((run) => colorName(run.color));
  const fill: string[] = [];
  const look = element.look;
  if (look) {
    for (const layer of look.fills) {
      if (!layer.visible) continue;
      if (layer.type === 'solid') fill.push(colorName(layer.color));
      if (layer.type === 'gradient') fill.push(...layer.stops.map((s) => colorName(s.color)));
    }
    if (look.fills.length === 0 && look.fill) fill.push(colorName(look.fill));
    if (look.stroke) fill.push(colorName(look.stroke.color));
  }
  return { text, fill };
}

/** Counts of things, most often first. */
class Tally<K> {
  readonly counts = new Map<K, number>();
  add(key: K, by = 1) {
    this.counts.set(key, (this.counts.get(key) ?? 0) + by);
  }
  top(limit = Infinity): [K, number][] {
    return [...this.counts].sort((a, b) => b[1] - a[1]).slice(0, limit);
  }
  get first(): K | undefined {
    return this.top(1)[0]?.[0];
  }
  get total() {
    let sum = 0;
    for (const count of this.counts.values()) sum += count;
    return sum;
  }
}

/** How a role's text looks across the deck. */
interface RoleType {
  fonts: Tally<string>;
  sizes: Tally<number>;
  colors: Tally<string>;
  bold: number;
  runs: number;
  slides: Set<number>;
}

/** The deck measured once: what the brief tells and the layout check compares with. */
export interface DeckStats {
  size: PageSize;
  /** Template and own colours. */
  palette: Set<string>;
  /** Each colour, by how often text and fills show it, and on which slides. */
  colors: Map<string, { text: number; fill: number; slides: Set<number> }>;
  fonts: Tally<string>;
  types: Map<string, RoleType>;
  /** Where each placeholder role usually lies, as a rounded box key. */
  boxes: Map<string, Tally<string>>;
  /** The margins the content keeps, in cm – from the grid, else measured. */
  margins: { left: number; right: number; top: number; bottom: number } | null;
  /** Edges of the grid's columns (x) and rows (y), in cm. */
  grid: { x: number[]; y: number[] };
  guides: { x: number[]; y: number[] };
  visibleSlides: number;
}

function gridEdges(axis: LayoutGrid['columns'], length: number): number[] {
  if (axis.count <= 0) return [];
  const track = (length - 2 * axis.margin - (axis.count - 1) * axis.gutter) / axis.count;
  if (track <= 0) return [];
  const edges: number[] = [];
  for (let i = 0; i < axis.count; i += 1) {
    const start = axis.margin + i * (track + axis.gutter);
    edges.push(start, start + track);
  }
  return edges;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.floor((sorted.length - 1) / 2)] as number);
};

export function measureDeck(slides: OdpSlide[], size: PageSize, design: DeckDesign): DeckStats {
  const colors: DeckStats['colors'] = new Map();
  const note = (color: string, kind: 'text' | 'fill', slide: number) => {
    const entry = colors.get(color) ?? { text: 0, fill: 0, slides: new Set<number>() };
    entry[kind] += 1;
    entry.slides.add(slide);
    colors.set(color, entry);
  };
  const fonts = new Tally<string>();
  const types = new Map<string, RoleType>();
  const boxes = new Map<string, Tally<string>>();
  const extents: { left: number[]; right: number[]; top: number[]; bottom: number[] } = {
    left: [],
    right: [],
    top: [],
    bottom: [],
  };
  let visibleSlides = 0;
  for (const slide of slides) {
    if (slide.hidden) continue;
    visibleSlides += 1;
    const number = slide.index + 1;
    if (slide.background) note(colorName(slide.background), 'fill', number);
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const element of slide.elements) {
      if (!draws(element)) continue;
      const box = boxOf(element, size);
      const shown = colorsOf(element);
      for (const color of shown.text) note(color, 'text', number);
      for (const color of shown.fill) note(color, 'fill', number);
      const role = roleOf(element);
      const runs = runsOf(element).filter((run) => run.text.trim());
      if (runs.length > 0) {
        const type = types.get(role) ?? {
          fonts: new Tally<string>(),
          sizes: new Tally<number>(),
          colors: new Tally<string>(),
          bold: 0,
          runs: 0,
          slides: new Set<number>(),
        };
        for (const run of runs) {
          const weight = run.text.length;
          fonts.add(run.font, weight);
          type.fonts.add(run.font, weight);
          type.sizes.add(round(run.size, 1), weight);
          type.colors.add(colorName(run.color), weight);
          if (run.bold) type.bold += weight;
          type.runs += weight;
        }
        type.slides.add(number);
        types.set(role, type);
      }
      if (element.role && ['title', 'subtitle', 'outline'].includes(element.role)) {
        const tally = boxes.get(element.role) ?? new Tally<string>();
        tally.add(
          `x ${round(box.x, 1)}, y ${round(box.y, 1)}, w ${round(box.w, 1)}, h ${round(box.h, 1)}`,
        );
        boxes.set(element.role, tally);
      }
      // Backgrounds, shapes without text and page numbers do not show where content goes.
      const tiny = box.w * box.h < size.width * size.height * 0.005 && words(textOf(element)) <= 2;
      if (fullBleed(box, size) || (element.kind !== 'text' && !textOf(element)) || tiny) continue;
      left = Math.min(left, box.x);
      right = Math.max(right, box.right);
      top = Math.min(top, box.y);
      bottom = Math.max(bottom, box.bottom);
    }
    if (left < right) {
      extents.left.push(left);
      extents.right.push(size.width - right);
      extents.top.push(top);
      extents.bottom.push(size.height - bottom);
    }
  }
  const grid = design.grid;
  const margins = grid
    ? {
        left: grid.columns.count > 0 ? grid.columns.margin : median(extents.left),
        right: grid.columns.count > 0 ? grid.columns.margin : median(extents.right),
        top: grid.rows.count > 0 ? grid.rows.margin : median(extents.top),
        bottom: grid.rows.count > 0 ? grid.rows.margin : median(extents.bottom),
      }
    : extents.left.length >= 3
      ? {
          left: median(extents.left),
          right: median(extents.right),
          top: median(extents.top),
          bottom: median(extents.bottom),
        }
      : null;
  return {
    size,
    palette: new Set(
      [...design.palette.map((entry) => entry.color), ...design.custom].map(colorName),
    ),
    colors,
    fonts,
    types,
    boxes,
    margins:
      margins && Object.values(margins).every((value) => value >= 0 && value < size.width / 3)
        ? margins
        : null,
    grid: {
      x: grid ? gridEdges(grid.columns, size.width) : [],
      y: grid ? gridEdges(grid.rows, size.height) : [],
    },
    guides: {
      x: design.guides
        .filter((guide) => guide.orientation === 'vertical')
        .map((guide) => guide.position * size.width),
      y: design.guides
        .filter((guide) => guide.orientation === 'horizontal')
        .map((guide) => guide.position * size.height),
    },
    visibleSlides,
  };
}

// ── The design brief ─────────────────────────────────────────────────────

const ROLE_NAMES: Record<string, string> = {
  title: 'titles',
  subtitle: 'subtitles',
  outline: 'body text (outline placeholders)',
  text: 'other text boxes',
  shape: 'text in shapes',
  table: 'tables',
  notes: 'notes',
};

/** A font of the brief by the name new text takes: „Carlito (the file's Calibri)“. */
const briefFont = (font: string) => {
  const free = freeFontName(font);
  return free === font ? font : `${free} (the file's ${font})`;
};

function typeLine(role: string, type: RoleType): string {
  const sizes = type.sizes.top(4);
  const total = type.sizes.total || 1;
  const sizeText = sizes
    .map(
      ([value, count]) =>
        `${value} pt${sizes.length > 1 ? ` (${Math.round((count / total) * 100)}%)` : ''}`,
    )
    .join(', ');
  const fonts = type.fonts
    .top(2)
    .map(([font]) => briefFont(font))
    .join(' / ');
  const colors = type.colors
    .top(3)
    .map(([color]) => color)
    .join(', ');
  const bold = type.bold / (type.runs || 1) > 0.6 ? ', bold' : '';
  return `- ${ROLE_NAMES[role] ?? role}: ${fonts}, ${sizeText}${bold}; colours ${colors} – on ${type.slides.size} slide${type.slides.size === 1 ? '' : 's'}`;
}

/**
 * The design of the deck in words, for the AI to keep to: its page, template, colours, type,
 * grid, guides, margins, layouts and where things usually sit.
 */
export function designBrief(
  stats: DeckStats,
  design: DeckDesign,
  masters: readonly OdpMasterPage[],
  slides: readonly OdpSlide[],
  masterOfSlide: (index: number) => string | null,
  fileFonts: readonly string[],
): string {
  const { size } = stats;
  const lines: string[] = [];
  const ratio = size.width / size.height;
  const shape =
    Math.abs(ratio - 16 / 9) < 0.02
      ? '16:9'
      : Math.abs(ratio - 4 / 3) < 0.02
        ? '4:3'
        : `${round(ratio)}:1`;
  lines.push(
    `Deck „${design.title}“ – ${stats.visibleSlides} slides shown${slides.length > stats.visibleSlides ? ` (${slides.length - stats.visibleSlides} hidden)` : ''}, page ${cm(size.width)} × ${cm(size.height)} cm (${shape}). All positions below in cm from the page's top left corner; text sizes in pt.`,
  );
  lines.push(
    design.template
      ? `Template: ${design.template}.`
      : 'Template: none in the workspace – the deck’s own look is the design.',
  );

  lines.push('', 'Colours:');
  if (design.palette.length > 0) {
    lines.push(
      `- The template's palette – the colours to use: ${design.palette
        .map((entry) => (entry.name ? `${entry.name} ${entry.color}` : entry.color))
        .join(', ')}`,
    );
  }
  if (design.custom.length > 0)
    lines.push(`- The deck's own colours beside them: ${design.custom.join(', ')}`);
  const used = [...stats.colors]
    .sort((a, b) => b[1].text + b[1].fill - (a[1].text + a[1].fill))
    .slice(0, 14)
    .map(([color, use]) => {
      const as = [use.text ? `text ×${use.text}` : '', use.fill ? `fill/line ×${use.fill}` : '']
        .filter(Boolean)
        .join(', ');
      return `${color} (${as}, ${use.slides.size} slide${use.slides.size === 1 ? '' : 's'})`;
    });
  lines.push(`- In use on the slides, most first: ${used.join('; ') || 'none read'}`);

  lines.push('', 'Type:');
  const fonts = stats.fonts.top(5).map(([font]) => font);
  lines.push(`- Fonts in use, most first: ${fonts.map(briefFont).join(', ') || 'none read'}`);
  const roleOrder = ['title', 'subtitle', 'outline', 'text', 'shape', 'table'];
  const roles = [...stats.types.keys()].sort(
    (a, b) => (roleOrder.indexOf(a) + 1 || 99) - (roleOrder.indexOf(b) + 1 || 99),
  );
  for (const role of roles) lines.push(typeLine(role, stats.types.get(role)!));
  const more = [...new Set([...design.workspaceFonts, ...fileFonts])].filter(
    (font) => !fonts.some((usedFont) => usedFont.toLowerCase() === font.toLowerCase()),
  );
  if (more.length > 0)
    lines.push(
      `- Fonts available besides (the workspace's and the file's own): ${more.slice(0, 12).join(', ')}`,
    );

  lines.push('', 'Layout:');
  if (design.grid) {
    const axis = (name: string, value: LayoutGrid['columns'], edges: number[]) => {
      if (value.count <= 0) return null;
      const tracks: string[] = [];
      for (let i = 0; i < edges.length; i += 2)
        tracks.push(`${cm(edges[i]!)}–${cm(edges[i + 1]!)}`);
      return `- Grid: ${value.count} ${name}, gutter ${cm(value.gutter)}, margin ${cm(value.margin)} – ${name} at ${tracks.join(', ')}`;
    };
    const columns = axis('columns', design.grid.columns, stats.grid.x);
    const rows = axis('rows', design.grid.rows, stats.grid.y);
    if (columns) lines.push(columns);
    if (rows) lines.push(rows);
    lines.push(
      '  Elements start and end on column (and row) edges; a box may span several columns.',
    );
  }
  if (stats.guides.x.length + stats.guides.y.length > 0) {
    lines.push(
      `- Guides: ${[
        ...stats.guides.x.map((x) => `vertical at x ${cm(x)}`),
        ...stats.guides.y.map((y) => `horizontal at y ${cm(y)}`),
      ].join(', ')}`,
    );
  }
  if (stats.margins) {
    const m = stats.margins;
    lines.push(
      `- Margins the content keeps${design.grid ? '' : ' (measured over the slides)'}: left ${cm(m.left)}, right ${cm(m.right)}, top ${cm(m.top)}, bottom ${cm(m.bottom)} – content within x ${cm(m.left)}–${cm(size.width - m.right)}, y ${cm(m.top)}–${cm(size.height - m.bottom)}`,
    );
  }
  for (const role of ['title', 'subtitle', 'outline']) {
    const tally = stats.boxes.get(role);
    const [box, count] = tally?.top(1)[0] ?? [];
    if (box && count && count >= 2) {
      lines.push(`- ${ROLE_NAMES[role]} usually at ${box} (${count} of ${tally!.total})`);
    }
  }
  if (masters.length > 0) {
    const users = new Map<string, number[]>();
    for (const slide of slides) {
      const master = masterOfSlide(slide.index);
      if (master) users.set(master, [...(users.get(master) ?? []), slide.index + 1]);
    }
    lines.push('- Master pages (layouts) of the deck – their placeholders:');
    for (const master of masters) {
      const shown = master.displayName ? ` („${master.displayName}“)` : '';
      const on = users.get(master.name);
      const holders = master.placeholders
        .map((holder) => {
          const [x, y, w, h] = [holder.x, holder.y, holder.width, holder.height].map(lengthCm);
          const asks = holder.prompt ? ` asking „${holder.prompt.replace(/\s+/g, ' ')}“` : '';
          return x === null || y === null || w === null || h === null
            ? `${holder.kind}${asks}`
            : `${holder.kind}${asks} x ${cm(x!)}, y ${cm(y!)}, w ${cm(w!)}, h ${cm(h!)}`;
        })
        .join('; ');
      lines.push(
        `  - ${master.name}${shown}: ${holders || 'no placeholders'} – ${on ? `slides ${compactNumbers(on)}` : 'no slide yet'}`,
      );
    }
  }
  return lines.join('\n');
}

/** 1, 2, 3, 5, 7, 8 → „1–3, 5, 7–8“. */
function compactNumbers(numbers: readonly number[]): string {
  const parts: string[] = [];
  let start = numbers[0];
  let last = numbers[0];
  for (const value of [...numbers.slice(1), undefined]) {
    if (value !== undefined && last !== undefined && value === last + 1) {
      last = value;
      continue;
    }
    if (start !== undefined && last !== undefined)
      parts.push(start === last ? `${start}` : `${start}–${last}`);
    start = value;
    last = value;
  }
  return parts.join(', ');
}

// ── A slide as a list ────────────────────────────────────────────────────

function styleKey(run: LiveTextStyle): string {
  return [
    run.font,
    `${round(run.size, 1)} pt`,
    colorName(run.color),
    run.bold ? 'bold' : '',
    run.italic ? 'italic' : '',
    run.underline ? 'underlined' : '',
    run.caps && run.caps !== 'none' ? run.caps : '',
    run.letterSpacing ? `spacing ${round(run.letterSpacing, 1)} pt` : '',
    run.opacity !== undefined && run.opacity < 1 ? `${Math.round(run.opacity * 100)} % opaque` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function elementLines(
  element: EditableElement,
  size: PageSize,
  background: string | null,
): string[] {
  const box = boxOf(element, size);
  const flags = [
    element.rotation ? `turned ${round(element.rotation, 1)}°` : '',
    element.tilt ? `tilted x ${element.tilt.x}° y ${element.tilt.y}°` : '',
    element.live?.placeholder ? 'empty placeholder (draws nothing)' : '',
    element.locked
      ? 'locked in place by the user (its place, size and turn cannot be changed)'
      : '',
  ].filter(Boolean);
  const head = `- ${element.id || '(no id)'} ${element.kind}${element.role ? ` ${element.role}` : ''} „${element.name}“ – x ${cm(box.x)}, y ${cm(box.y)}, w ${cm(box.w)}, h ${cm(box.h)} (right ${cm(box.right)}, bottom ${cm(box.bottom)})${flags.length ? `; ${flags.join(', ')}` : ''}`;
  const lines = [head];
  const text = textOf(element);
  if (text) {
    const short = text.length > 400 ? `${text.slice(0, 400)}…` : text;
    lines.push(`  text (${words(text)} words): ${JSON.stringify(short)}`);
  } else if (element.live?.prompt) {
    lines.push(`  asks for: ${JSON.stringify(element.live.prompt.slice(0, 200))}`);
  }
  const runs = runsOf(element);
  const styles = new Tally<string>();
  for (const run of runs) styles.add(styleKey(run), Math.max(1, run.text.length));
  const total = styles.total || 1;
  const styleText = styles
    .top(3)
    .map(([key, count]) =>
      styles.counts.size > 1 ? `${key} (${Math.round((count / total) * 100)}%)` : key,
    )
    .join('; ');
  // Type only of what shows text, or will: an empty shape's defaults say nothing.
  const typed = runs.length > 0 && (text || element.live?.placeholder);
  if (typed && !element.live) lines.push(`  type: ${styleText}`);
  if (typed && element.live) {
    const paragraphs = element.live.paragraphs;
    const aligns = [...new Set(paragraphs.map((p) => p.align))].join('/');
    const lists = paragraphs.filter((p) => p.bullet).length;
    const first = paragraphs[0];
    const spacing = first
      ? first.lineSpacing.type === 'proportional'
        ? `line ${round(first.lineSpacing.value, 2)}×`
        : `line ${first.lineSpacing.type} ${round(first.lineSpacing.value, 1)} pt`
      : '';
    const room =
      first && (first.spaceBefore || first.spaceAfter)
        ? `, space before ${round(first.spaceBefore, 1)} / after ${round(first.spaceAfter, 1)} pt`
        : '';
    const live = element.live;
    const fit = [
      live.autoGrow ? 'box grows with text' : '',
      live.shrink ? 'text shrinks to fit' : '',
      live.verticalAlign !== 'top' ? `vertical ${live.verticalAlign}` : '',
    ]
      .filter(Boolean)
      .join(', ');
    lines.push(
      `  type: ${styleText}; ${aligns}${lists ? `, ${lists} list item${lists === 1 ? '' : 's'}` : ''}, ${spacing}${room}${fit ? `; ${fit}` : ''}`,
    );
  }
  const look = element.look;
  if (look) {
    const fills =
      look.fills.length > 0 ? look.fills.map(fillText).join(' + ') : (look.fill ?? 'none');
    const stroke = look.stroke
      ? `${look.stroke.color} ${round(look.stroke.width, 2)} pt${look.stroke.dash ? ` ${look.stroke.dash}` : ''}`
      : 'none';
    if (fills !== 'none' || stroke !== 'none') lines.push(`  fill ${fills}; border ${stroke}`);
    const { shadow, blur, glow, backdrop } = look.effects;
    const effects = [
      shadow
        ? `shadow ${shadow.color} ${round(shadow.opacity * 100, 0)}% offset ${round(shadow.x, 1)}/${round(shadow.y, 1)} pt blur ${round(shadow.blur, 1)} pt`
        : '',
      blur ? `soft edge ${round(blur, 1)} pt` : '',
      glow ? `glow ${glow.color} ${round(glow.opacity * 100, 0)}% ${round(glow.radius, 1)} pt` : '',
      // Baked by Slider into the fill as a picture (frosted glass); kept in its `slider:fills`.
      backdrop
        ? `background blur ${round(backdrop, 1)} pt (frosted glass: what lies behind shows blurred through its see-through fill)`
        : '',
    ].filter(Boolean);
    if (effects.length > 0) lines.push(`  effects: ${effects.join('; ')}`);
  }
  if (element.credit) lines.push(`  stock photo by ${element.credit.name}`);
  const textColor = runs.find((run) => run.text.trim())?.color;
  const behind = look?.fill ?? background;
  if (textColor && behind) {
    const ratio = contrast(textColor, behind);
    if (ratio < 4.5) lines.push(`  contrast of its text on ${behind}: ${round(ratio, 1)}:1`);
  }
  return lines;
}

/**
 * A slide as the AI reads it besides its XML: its elements measured, bottom to top – the first
 * `limit` of them, those with text before shapes without.
 */
export function slideInventory(
  slide: OdpSlide,
  size: PageSize,
  master: string | null,
  limit = Infinity,
): string {
  const background =
    slide.backgroundFills.length > 0
      ? slide.backgroundFills.map(fillText).join(' + ')
      : (slide.background ?? "the master's");
  const head = `Slide ${slide.index + 1}${slide.hidden ? ' (hidden)' : ''} – layout ${master ?? 'unknown'}, background ${background}, ${slide.elements.length} element${slide.elements.length === 1 ? '' : 's'} (bottom to top as in the XML):`;
  // A slide of hundreds of pieces (an imported PDF, a chart in shapes): what says something first.
  const listed =
    slide.elements.length <= limit
      ? slide.elements
      : [
          ...slide.elements.filter(
            (element) => textOf(element) || element.role || element.kind === 'image',
          ),
          ...slide.elements.filter(
            (element) => !(textOf(element) || element.role || element.kind === 'image'),
          ),
        ]
          .slice(0, limit)
          .sort((a, b) => slide.elements.indexOf(a) - slide.elements.indexOf(b));
  const lines = listed.flatMap((element) => elementLines(element, size, slide.background));
  const left = slide.elements.length - listed.length;
  return [
    head,
    ...lines,
    ...(left > 0 ? [`… and ${left} more shapes without text (inspect_slide lists them all).`] : []),
  ].join('\n');
}

// ── The layout check ─────────────────────────────────────────────────────

/** Two edges this close count as meant to line up but missed (cm). */
const NEAR_MIN = 0.04;
const NEAR_MAX = 0.35;

interface Item {
  element: EditableElement;
  box: Box;
  label: string;
}

/**
 * What a designer would measure on a slide, against the deck: edges that almost line up,
 * equal things unevenly spaced, text too close to the page's edge or off the grid, more sizes,
 * fonts or colours than the deck uses, text that may not fit its box, low contrast. Hints for the
 * AI to look at in the picture – each one may be on purpose.
 */
export function layoutCheck(slide: OdpSlide, stats: DeckStats): string[] {
  const { size } = stats;
  const findings: string[] = [];
  const items: Item[] = slide.elements
    .filter((element) => draws(element) && element.bbox.w > 0 && element.bbox.h > 0)
    .map((element) => ({
      element,
      box: boxOf(element, size),
      label: `${element.id}${element.role ? ` (${element.role})` : textOf(element) ? ` („${textOf(element).slice(0, 24)}${textOf(element).length > 24 ? '…' : ''}“)` : ` (${element.kind})`}`,
    }));
  const content = items.filter((item) => !fullBleed(item.box, size)).slice(0, 40);

  // Off the page.
  for (const item of items) {
    const out = [
      ['left', -item.box.x],
      ['right', item.box.right - size.width],
      ['top', -item.box.y],
      ['bottom', item.box.bottom - size.height],
    ] as const;
    for (const [edge, by] of out) {
      const text = Boolean(textOf(item.element));
      if (by > (text ? 0.05 : 0.3)) {
        findings.push(`${item.label} reaches ${cm(by)} cm beyond the ${edge} edge of the slide.`);
      }
    }
  }

  // Edges that almost line up: left, right and centre of things one above the other, top,
  // bottom and middle of things side by side – not of a box and what lies in it.
  const edges: [string, 'x' | 'y', (box: Box) => number][] = [
    ['left edges', 'x', (box) => box.x],
    ['right edges', 'x', (box) => box.right],
    ['centres', 'x', (box) => box.cx],
    ['tops', 'y', (box) => box.y],
    ['bottoms', 'y', (box) => box.bottom],
    ['middles', 'y', (box) => box.cy],
  ];
  // On a smaller page the same miss is the same share of it.
  const scale = size.width / 33.87;
  const near: string[] = [];
  const paired = new Set<string>();
  for (let i = 0; i < content.length; i += 1) {
    for (let j = i + 1; j < content.length; j += 1) {
      const a = content[i]!;
      const b = content[j]!;
      const stacked = a.box.bottom <= b.box.y + 0.05 || b.box.bottom <= a.box.y + 0.05;
      const besides = a.box.right <= b.box.x + 0.05 || b.box.right <= a.box.x + 0.05;
      for (const [name, axis, edge] of edges) {
        if (axis === 'x' ? !stacked : !besides) continue;
        const d = Math.abs(edge(a.box) - edge(b.box));
        const key = `${i}:${j}`;
        if (d > NEAR_MIN * scale && d < NEAR_MAX * scale && !paired.has(key)) {
          paired.add(key);
          near.push(
            `${name} of ${a.label} (${cm(edge(a.box))}) and ${b.label} (${cm(edge(b.box))})`,
          );
        }
      }
    }
  }
  if (near.length > 0) {
    findings.push(
      `Almost lined up – line them up exactly or set them clearly apart: ${near.slice(0, 6).join('; ')}${near.length > 6 ? `; and ${near.length - 6} more` : ''}.`,
    );
  }

  // Equal things unevenly spaced: rows and columns of boxes of about the same size.
  const similar = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * 0.12 + 0.1;
  const groups = (axis: 'row' | 'column') => {
    const found: Item[][] = [];
    for (const item of content) {
      const group = found.find((members) =>
        members.every((member) =>
          axis === 'row'
            ? similar(member.box.h, item.box.h) && Math.abs(member.box.y - item.box.y) < 0.4
            : similar(member.box.w, item.box.w) && Math.abs(member.box.x - item.box.x) < 0.4,
        ),
      );
      if (group) group.push(item);
      else found.push([item]);
    }
    return found.filter((members) => members.length >= 3);
  };
  for (const axis of ['row', 'column'] as const) {
    for (const members of groups(axis)) {
      const sorted = [...members].sort((a, b) =>
        axis === 'row' ? a.box.x - b.box.x : a.box.y - b.box.y,
      );
      const gaps = sorted
        .slice(1)
        .map((item, i) =>
          axis === 'row' ? item.box.x - sorted[i]!.box.right : item.box.y - sorted[i]!.box.bottom,
        );
      if (gaps.some((gap) => gap < -0.05)) continue;
      const spread = Math.max(...gaps) - Math.min(...gaps);
      if (spread > 0.15) {
        findings.push(
          `Uneven gaps in the ${axis} ${sorted.map((item) => item.element.id).join(', ')}: ${gaps.map(cm).join(', ')} cm.`,
        );
      }
    }
  }

  // Overlapping texts.
  const texts = content.filter((item) => textOf(item.element));
  const overlaps: string[] = [];
  for (let i = 0; i < texts.length; i += 1) {
    for (let j = i + 1; j < texts.length; j += 1) {
      const a = texts[i]!.box;
      const b = texts[j]!.box;
      const w = Math.min(a.right, b.right) - Math.max(a.x, b.x);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      if (w > 0.1 && h > 0.1 && w * h > 0.05 * Math.min(a.w * a.h, b.w * b.h)) {
        overlaps.push(`${texts[i]!.label} and ${texts[j]!.label}`);
      }
    }
  }
  if (overlaps.length > 0) {
    findings.push(
      `Text boxes overlap – check that their texts do not: ${overlaps.slice(0, 4).join('; ')}${overlaps.length > 4 ? `; and ${overlaps.length - 4} more` : ''}.`,
    );
  }

  // Margins.
  const margins = stats.margins;
  if (margins) {
    for (const item of content) {
      if (!textOf(item.element) || SMALL_ROLES.has(item.element.role ?? '')) continue;
      const sides = [
        ['left', item.box.x, margins.left],
        ['right', size.width - item.box.right, margins.right],
        ['top', item.box.y, margins.top],
        ['bottom', size.height - item.box.bottom, margins.bottom],
      ] as const;
      for (const [side, distance, margin] of sides) {
        if (distance > 0.05 && distance < margin - 0.3) {
          findings.push(
            `${item.label} is ${cm(distance)} cm from the ${side} edge – the deck keeps ${cm(margin)} cm.`,
          );
        }
      }
    }
  }

  // The grid.
  const lines = {
    x: [...stats.grid.x, ...stats.guides.x],
    y: [...stats.grid.y, ...stats.guides.y],
  };
  if (lines.x.length > 0) {
    const off: string[] = [];
    for (const item of content) {
      for (const [name, value] of [
        ['left', item.box.x],
        ['right', item.box.right],
      ] as const) {
        const nearest = lines.x.reduce((best, line) =>
          Math.abs(line - value) < Math.abs(best - value) ? line : best,
        );
        const d = Math.abs(nearest - value);
        if (d > 0.05 && d < 0.6)
          off.push(`${item.label} ${name} ${cm(value)} (grid/guide at ${cm(nearest)})`);
      }
    }
    if (off.length > 0)
      findings.push(
        `Just off the grid or guides: ${off.slice(0, 6).join('; ')}${off.length > 6 ? `; and ${off.length - 6} more` : ''}.`,
      );
  }

  // Type.
  const sizes = new Set<number>();
  const fonts = new Set<string>();
  const small: { id: string; size: number }[] = [];
  let totalWords = 0;
  for (const item of items) {
    const role = roleOf(item.element);
    const runs = runsOf(item.element).filter((run) => run.text.trim());
    totalWords += words(textOf(item.element));
    for (const run of runs) {
      sizes.add(round(run.size, 1));
      fonts.add(run.font);
    }
    const smallest = Math.min(...runs.map((run) => run.size));
    if (runs.length > 0 && smallest < 10 && !SMALL_ROLES.has(role)) {
      small.push({ id: item.element.id, size: round(smallest, 1) });
    }
    const usual = stats.types.get(role);
    const main = runs.length > 0 ? new Tally<number>() : null;
    for (const run of runs) main?.add(round(run.size, 1), run.text.length);
    const mainSize = main?.first;
    const deckSize = usual?.sizes.first;
    if (
      mainSize &&
      deckSize &&
      usual &&
      usual.slides.size >= 3 &&
      ['title', 'subtitle', 'outline'].includes(role) &&
      Math.abs(mainSize - deckSize) > deckSize * 0.15
    ) {
      findings.push(
        `${item.label} is set at ${mainSize} pt – the deck's ${ROLE_NAMES[role]} are mostly ${deckSize} pt.`,
      );
    }
    const live = item.element.live;
    if (live && runs.length > 0 && !live.autoGrow && !live.shrink) {
      // A drawn shape's text has only its text area (a hexagon's middle).
      const area = live.textArea ?? { left: 0, top: 0, right: 0, bottom: 0 };
      const inner = {
        w:
          item.box.w * PT_PER_CM * (1 - area.left - area.right) -
          live.padding.left -
          live.padding.right,
        h:
          item.box.h * PT_PER_CM * (1 - area.top - area.bottom) -
          live.padding.top -
          live.padding.bottom,
      };
      if (inner.w > 0 && inner.h > 0) {
        let needed = 0;
        for (const paragraph of live.paragraphs) {
          const runSize = Math.max(paragraph.mark.size, ...paragraph.runs.map((run) => run.size));
          const chars = paragraph.runs.reduce((sum, run) => sum + run.text.length, 0);
          const width = Math.max(1, inner.w - paragraph.marginLeft);
          const lineCount = Math.max(1, Math.ceil((chars * runSize * 0.5) / width));
          const factor =
            paragraph.lineSpacing.type === 'proportional' ? paragraph.lineSpacing.value * 1.2 : 1;
          const lineHeight =
            paragraph.lineSpacing.type === 'proportional'
              ? runSize * factor
              : Math.max(runSize, paragraph.lineSpacing.value);
          needed += lineCount * lineHeight + paragraph.spaceBefore + paragraph.spaceAfter;
        }
        if (needed > inner.h * 1.3) {
          findings.push(
            `${item.label} may hold more text than fits (an estimate: about ${Math.round(needed)} pt of text in ${Math.round(inner.h)} pt) – check the picture.`,
          );
        }
      }
    }
  }
  if (small.length > 0) {
    const range = [...new Set(small.map((entry) => entry.size))].sort((a, b) => a - b);
    findings.push(
      `Text below 10 pt – hard to read on a slide (${range.join(', ')} pt): ${small
        .slice(0, 8)
        .map((entry) => entry.id)
        .join(', ')}${small.length > 8 ? ` and ${small.length - 8} more` : ''}.`,
    );
  }
  if (sizes.size > 4)
    findings.push(
      `${sizes.size} text sizes on one slide (${[...sizes].sort((a, b) => b - a).join(', ')} pt) – fewer make a clearer hierarchy.`,
    );
  if (fonts.size > 2) findings.push(`${fonts.size} fonts on one slide: ${[...fonts].join(', ')}.`);
  if (totalWords > 90)
    findings.push(`${totalWords} words on the slide – a lot to read while listening.`);

  // Colours foreign to the deck.
  const foreign = new Set<string>();
  for (const item of items) {
    const shown = colorsOf(item.element);
    for (const color of [...shown.text, ...shown.fill]) {
      if (color === '#ffffff' || color === '#000000' || stats.palette.has(color)) continue;
      const use = stats.colors.get(color);
      const elsewhere = use ? [...use.slides].some((number) => number !== slide.index + 1) : false;
      if (stats.palette.size > 0 || (!elsewhere && stats.visibleSlides >= 4)) foreign.add(color);
    }
  }
  if (foreign.size > 0) {
    findings.push(
      stats.palette.size > 0
        ? `Colours outside the template's palette: ${[...foreign].join(', ')}.`
        : `Colours no other slide uses: ${[...foreign].join(', ')}.`,
    );
  }

  // Contrast.
  for (const item of items) {
    const color = runsOf(item.element).find((run) => run.text.trim())?.color;
    const behind = item.element.look?.fill ?? slide.background;
    if (color && behind && contrast(color, behind) < 3) {
      findings.push(
        `${item.label}: text ${color} on ${behind} has a contrast of ${round(contrast(color, behind), 1)}:1 – hard to read.`,
      );
    }
  }
  return findings;
}

/** The layout check as the AI reads it. */
export function layoutCheckText(slide: OdpSlide, stats: DeckStats): string {
  if (slide.hidden) return `Layout check of slide ${slide.index + 1}: hidden, not checked.`;
  const findings = layoutCheck(slide, stats);
  return findings.length === 0
    ? `Layout check of slide ${slide.index + 1} (measured from the XML): nothing found – still judge the picture.`
    : `Layout check of slide ${slide.index + 1} (measured from the XML – hints, some may be on purpose; the picture decides):\n${findings.map((finding) => `- ${finding}`).join('\n')}`;
}

// ── Pictures ─────────────────────────────────────────────────────────────

/** How wide the pictures made here are, in pixels. */
const SHEET_WIDTH = 2400;

/** A slide on a contact sheet. */
export interface SheetCell {
  number: number;
  picture: Uint8Array | null;
  /** Shown under the number: „hidden“, „changed“. */
  note?: string;
}

async function pictureOf(bytes: Uint8Array | null) {
  if (!bytes) return null;
  try {
    return await loadImage(Buffer.from(bytes));
  } catch {
    return null;
  }
}

/** Several slides on one picture, numbered, left to right and top to bottom. */
export async function contactSheet(
  cells: readonly SheetCell[],
  aspect: number,
): Promise<Uint8Array> {
  const columns = cells.length <= 4 ? 2 : cells.length <= 9 ? 3 : cells.length <= 16 ? 4 : 5;
  const gap = 16;
  const cellWidth = Math.floor((SHEET_WIDTH - gap * (columns + 1)) / columns);
  const cellHeight = Math.round(cellWidth / aspect);
  const rows = Math.ceil(cells.length / columns);
  // Each slide's number in a strip above it, so nothing of the slide is covered.
  const label = Math.max(20, Math.round(cellWidth / 18));
  const strip = Math.round(label * 1.5);
  const canvas = createCanvas(SHEET_WIDTH, rows * (strip + cellHeight + gap) + gap);
  const context = canvas.getContext('2d');
  context.fillStyle = '#d9dce1';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const images = await Promise.all(cells.map((cell) => pictureOf(cell.picture)));
  cells.forEach((cell, i) => {
    const x = gap + (i % columns) * (cellWidth + gap);
    const top = gap + Math.floor(i / columns) * (strip + cellHeight + gap);
    const y = top + strip;
    const image = images[i];
    context.fillStyle = '#ffffff';
    context.fillRect(x, y, cellWidth, cellHeight);
    if (image) {
      context.globalAlpha = cell.note === 'hidden' ? 0.35 : 1;
      context.drawImage(image, x, y, cellWidth, cellHeight);
      context.globalAlpha = 1;
    }
    const changed = cell.note === 'changed';
    context.strokeStyle = changed ? '#e8590c' : '#9aa0a6';
    context.lineWidth = changed ? 6 : 1;
    context.strokeRect(x, y, cellWidth, cellHeight);
    context.font = `bold ${label}px sans-serif`;
    context.fillStyle = changed ? '#e8590c' : '#111827';
    context.fillText(
      `${cell.number}${cell.note ? ` · ${cell.note}` : ''}`,
      x + 2,
      top + label * 1.1,
    );
  });
  return new Uint8Array(await canvas.encode('webp', 85));
}

/** A part of a slide's drawing close up: `area` in cm on a page of `size`. */
export async function zoomArea(
  drawing: Uint8Array,
  area: { x: number; y: number; width: number; height: number },
  size: PageSize,
): Promise<{
  bytes: Uint8Array;
  area: { x: number; y: number; width: number; height: number };
} | null> {
  const image = await pictureOf(drawing);
  if (!image) return null;
  const scale = image.width / size.width;
  const x = Math.max(0, Math.min(size.width, area.x));
  const y = Math.max(0, Math.min(size.height, area.y));
  const width = Math.min(size.width - x, area.width);
  const height = Math.min(size.height - y, area.height);
  if (width <= 0.05 || height <= 0.05) return null;
  const sw = width * scale;
  const sh = height * scale;
  const out = Math.min(SHEET_WIDTH / sw, 1600 / sh, 4);
  const canvas = createCanvas(Math.max(1, Math.round(sw * out)), Math.max(1, Math.round(sh * out)));
  canvas
    .getContext('2d')
    .drawImage(image, x * scale, y * scale, sw, sh, 0, 0, canvas.width, canvas.height);
  return {
    bytes: new Uint8Array(await canvas.encode('webp', 90)),
    area: { x: round(x), y: round(y), width: round(width), height: round(height) },
  };
}

/** Files of the board the AI's first message names at most. */
const BRIEF_FILES = 40;

/**
 * The first message's few lines about the deck's material page: what lies there – each file's
 * name, kind, size and the beginning of its text – never what it says; the contents come only
 * through the material tools (`material-tools.ts`). `null` when the board is empty.
 */
export async function materialsBrief(deps: AppDeps, deckId: string): Promise<string | null> {
  const [rows, items] = await Promise.all([
    materialsOf(deps, deckId),
    deps.db
      .select()
      .from(deckBoardItems)
      .where(eq(deckBoardItems.deckId, deckId))
      .orderBy(asc(deckBoardItems.createdAt)),
  ]);
  if (rows.length === 0 && items.length === 0) return null;
  const lines = rows.slice(0, BRIEF_FILES).map((row) => {
    const summary = row.summary?.replace(/\s+/g, ' ').trim();
    // The notes people put on it, short: what they point at matters for the request.
    const notes = notesOn(items, row.id).map((note) => `\n  ${note.slice(0, 300)}`);
    return `- ${describeMaterial(row)}${summary ? ` – ${summary.slice(0, 160)}` : ''}${notes.join('')}`;
  });
  if (rows.length > BRIEF_FILES) lines.push(`- … and ${rows.length - BRIEF_FILES} more`);
  const files = new Set(rows.map((row) => row.id));
  const loose = items.filter((item) => !item.boundIds.some((id) => files.has(id))).length;
  if (loose > 0) lines.push(`- ${loose} note(s) and link(s) on the board itself`);
  return `The presentation's material (on its own page „Material“ beside the slides – never part of the deck): ${rows.length} file(s). Their contents are not in this message: read what the request needs with read_material, read_sheet, search_materials and view_material (list_materials lists everything, notes and links included).\n${lines.join('\n')}`;
}
