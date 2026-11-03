import * as Y from 'yjs';
import type { z } from 'zod';
import {
  liveParagraphSchema,
  liveTextStyleSchema,
  type LiveElement,
  type LiveParagraph,
  type LiveRun,
  type ListNumber,
  type LiveTextStyle,
  type TextList,
} from './editing';

/*
 * Typing together in one text box (the live editor): its text is a Y.Text everyone typing in it
 * shares, merged character by character – so two people type at once, each sees the other's
 * caret, and nothing either typed is lost. The server keeps one per text being typed in, made from
 * the file when the first one starts; updates go through it to the others over the live stream.
 * The file still gets the text the usual way (`setRichText`): everyone has the same text in the
 * end, so the file does too.
 *
 * In the Y.Text a paragraph is its mark (`PARAGRAPH_MARK`) and the characters after it up to the
 * next mark. Every property is an attribute of its own, as rich text editors keep them: a
 * character carries its style (`bold`, `font`, …), a mark its paragraph's look (`p.align`, …) and
 * the style of the paragraph's end (`mark.font`, …). So formatting is `format` on the characters
 * that stay – one person making a word bold while another makes it italic gives both, and typing
 * in it meanwhile stays where it was typed.
 *
 * The text starts as the same document everywhere (`liveTextDoc`): made from the same paragraphs
 * it is the same, down to its Y ids. An editor starts typing on its own copy at once and joins the
 * server's later – the two merge as one, without the start written twice.
 */

/** Starts every paragraph in the shared text (Unicode's paragraph separator). */
export const PARAGRAPH_MARK = ' ';

/** The origin of changes made here (`applyLiveChange`), to tell them from the others'. */
export const LOCAL = 'local';

/** The Y.Text of an element in its document. */
export const liveTextOf = (doc: Y.Doc): Y.Text => doc.getText('text');

/** The style of text that has none of its own (a new text box): Inter, as blank decks name it. */
export const DEFAULT_STYLE: LiveTextStyle = {
  font: 'Inter',
  size: 24,
  color: '#000000',
  bold: false,
  italic: false,
  underline: false,
};

/** A paragraph with nothing set: what a new text box's paragraphs are. */
export const plainParagraph = (mark: LiveTextStyle): LiveParagraph => ({
  runs: [],
  mark,
  align: 'left',
  fontIndependent: false,
  lineSpacing: { type: 'proportional', value: 1 },
  spaceBefore: 0,
  spaceAfter: 0,
  marginLeft: 0,
  indent: 0,
  level: 0,
  bullet: null,
});

/**
 * The paragraphs typing in an element starts from – the same on the server and in the editor:
 * an empty placeholder has none of its prompt, a shape without any text one empty paragraph.
 */
export function typedParagraphs(
  live: Pick<LiveElement, 'paragraphs' | 'placeholder'>,
): LiveParagraph[] {
  if (live.paragraphs.length === 0) return [plainParagraph(DEFAULT_STYLE)];
  return live.placeholder
    ? live.paragraphs.slice(0, 1).map((paragraph) => ({ ...paragraph, runs: [] }))
    : live.paragraphs;
}

// ── Lists ────────────────────────────────────────────────────────────────────

/** A paragraph's list as the editor writes it (`setRichText`): from its level and bullet. */
export const listOf = (paragraph: LiveParagraph): TextList | null =>
  paragraph.level > 0 && paragraph.bullet
    ? { kind: paragraph.bullet.number ? 'number' : 'bullet', level: paragraph.level }
    : null;

/**
 * A list Slider writes itself (none of the text's own draws it): each level this many points
 * further in, its bullet or number in room this wide before the text.
 */
export const LIST_INDENT = 27;
export const LIST_LABEL_WIDTH = 27;
/** Its bullets, by level: a dot, a dash, a dot, … */
export const listBullet = (level: number) => (level % 2 === 1 ? '•' : '–');

const ROMAN: [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

/** A number as a list numbering writes it (`a`: letters, `i`: Roman). */
export function listNumber(n: number, format: ListNumber): string {
  if (format === '1' || n < 1) return String(n);
  if (format === 'a' || format === 'A') {
    // a … z, aa, ab … – as LibreOffice counts without `style:num-letter-sync`.
    let letters = '';
    for (let rest = n; rest > 0; rest = Math.floor((rest - 1) / 26)) {
      letters = String.fromCharCode(97 + ((rest - 1) % 26)) + letters;
    }
    return format === 'A' ? letters.toUpperCase() : letters;
  }
  let rest = n;
  let roman = '';
  for (const [value, digits] of ROMAN) {
    while (rest >= value) {
      roman += digits;
      rest -= value;
    }
  }
  return format === 'I' ? roman.toUpperCase() : roman;
}

/**
 * What each paragraph's bullet shows (`null`: none) – a numbered one counted as LibreOffice
 * counts: back over the paragraphs of its level, passing deeper ones, up to one of a lower level,
 * without a number or numbered otherwise.
 */
export function listLabels(paragraphs: readonly LiveParagraph[]): (string | null)[] {
  const sameNumbering = (a: NonNullable<LiveParagraph['bullet']>, b: LiveParagraph['bullet']) =>
    !!b &&
    a.number === b.number &&
    (a.prefix ?? '') === (b.prefix ?? '') &&
    (a.suffix ?? '') === (b.suffix ?? '') &&
    (a.start ?? 1) === (b.start ?? 1);
  return paragraphs.map((paragraph, i) => {
    const bullet = paragraph.bullet;
    if (!bullet) return null;
    if (!bullet.number) return bullet.char;
    let count = 0;
    for (let j = i; j >= 0; j -= 1) {
      const other = paragraphs[j] as LiveParagraph;
      if (other.level < paragraph.level) break;
      if (other.level > paragraph.level) continue;
      if (!sameNumbering(bullet, other.bullet)) break;
      count += 1;
    }
    const n = (bullet.start ?? 1) + count - 1;
    return `${bullet.prefix ?? ''}${listNumber(n, bullet.number)}${bullet.suffix ?? ''}`;
  });
}

// ── Properties as attributes ─────────────────────────────────────────────────

type Value = string | number | boolean | null;
type Attributes = Record<string, Value>;

const STYLE_KEYS = [
  'font',
  'size',
  'color',
  'bold',
  'italic',
  'underline',
  'strike',
  'caps',
  'letterSpacing',
  'kerning',
  'opacity',
] as const satisfies readonly (keyof LiveTextStyle)[];
/** Style properties a style may lack (`null` as attributes). */
const OPTIONAL_STYLE_KEYS: ReadonlySet<string> = new Set([
  'strike',
  'caps',
  'letterSpacing',
  'kerning',
  'opacity',
]);
const LOOK_KEYS = [
  'align',
  'fontIndependent',
  'lineSpacing',
  'spaceBefore',
  'spaceAfter',
  'marginLeft',
  'indent',
  'level',
  'bullet',
] as const satisfies readonly (keyof LiveParagraph)[];

const lookAttribute = (key: string) => `p.${key}`;
const markAttribute = (key: string) => `mark.${key}`;
/** Every attribute a character of the text may carry – each glyph names them all (`null`: none). */
const ATTRIBUTES = [
  ...STYLE_KEYS,
  ...LOOK_KEYS.map(lookAttribute),
  ...STYLE_KEYS.map(markAttribute),
];

/** A style as attributes (`prefix`: a mark's `mark.`); absent optional ones are `null`. */
function styleAttributes(style: LiveTextStyle, name: (key: string) => string): Attributes {
  const attributes: Attributes = {};
  for (const key of STYLE_KEYS) attributes[name(key)] = style[key] ?? null;
  return attributes;
}

/** The properties the schema knows of the look's objects, in its order. */
const OBJECT_KEYS = {
  lineSpacing: Object.keys(liveParagraphSchema.shape.lineSpacing.shape),
  bullet: Object.keys(liveParagraphSchema.shape.bullet.unwrap().shape),
};

/**
 * Objects (line spacing, bullet) are JSON of the properties the schema knows, in its order – the
 * same object, the same string, wherever it was made (the file's parser, the wire).
 */
function lookAttributes(paragraph: LiveParagraph): Attributes {
  const attributes: Attributes = {};
  for (const key of LOOK_KEYS) {
    const value = paragraph[key];
    attributes[lookAttribute(key)] =
      key === 'lineSpacing' || key === 'bullet'
        ? value === null
          ? null
          : JSON.stringify(value, OBJECT_KEYS[key])
        : (value as Value);
  }
  return attributes;
}

/** A value as `schema` has it, else `undefined` – attributes come from the others, unchecked. */
function valid<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** A JSON attribute (line spacing, bullet) as `schema` has it, else `undefined`. */
function validJson<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  if (value === null) return valid(schema, null);
  if (typeof value !== 'string') return undefined;
  try {
    return valid(schema, JSON.parse(value));
  } catch {
    return undefined;
  }
}

/**
 * The style an attribute set says (`name`: its attribute names – a mark's are `mark.…`), each
 * property it lacks or holds nonsense in from `fallback`. An optional one set to `null` is unset.
 */
function styleFrom(
  attributes: Readonly<Record<string, unknown>>,
  name: (key: string) => string,
  fallback: LiveTextStyle,
): LiveTextStyle {
  const style: Record<string, unknown> = {};
  for (const key of STYLE_KEYS) {
    const value = attributes[name(key)];
    // An optional property set to `null` is unset – not one to take from `fallback`.
    if (value === null && OPTIONAL_STYLE_KEYS.has(key)) continue;
    const chosen =
      valid(liveTextStyleSchema.shape[key] as z.ZodType<unknown>, value) ?? fallback[key];
    if (chosen !== undefined) style[key] = chosen;
  }
  return style as LiveTextStyle;
}

/** A paragraph's look (its runs empty) from a mark's attributes, what it lacks from `fallback`. */
function lookFrom(
  attributes: Readonly<Record<string, unknown>>,
  fallback: LiveParagraph,
): LiveParagraph {
  const shape = liveParagraphSchema.shape;
  const look: Record<string, unknown> = {
    runs: [],
    mark: styleFrom(attributes, markAttribute, fallback.mark),
  };
  for (const key of LOOK_KEYS) {
    const value = attributes[lookAttribute(key)];
    const read =
      key === 'lineSpacing' || key === 'bullet'
        ? validJson(shape[key] as z.ZodType<unknown>, value)
        : valid(shape[key] as z.ZodType<unknown>, value);
    look[key] = read === undefined ? fallback[key] : read;
  }
  return look as LiveParagraph;
}

// ── Glyphs: the text one character at a time ─────────────────────────────────

/** One character of the text with every attribute it carries. */
interface Glyph {
  char: string;
  attributes: Attributes;
  /** The attributes as one string: equal ones, equal keys. */
  key: string;
}

/** The glyphs of `text`, all carrying `attributes` (completed: every one named, `null` if not set). */
function glyphsWith(text: string, attributes: Readonly<Record<string, unknown>>): Glyph[] {
  const full: Attributes = {};
  for (const name of ATTRIBUTES) {
    const value = attributes[name];
    full[name] =
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? value
        : null;
  }
  const key = JSON.stringify(ATTRIBUTES.map((name) => full[name]));
  // By code point: a character outside the BMP stays one piece.
  return Array.from(text, (char) => ({ char, attributes: full, key }));
}

function glyphsOf(paragraphs: readonly LiveParagraph[]): Glyph[] {
  const glyphs: Glyph[] = [];
  for (const paragraph of paragraphs) {
    glyphs.push(
      ...glyphsWith(PARAGRAPH_MARK, {
        ...lookAttributes(paragraph),
        ...styleAttributes(paragraph.mark, markAttribute),
      }),
    );
    for (const run of paragraph.runs) {
      // A paragraph separator in a run (pasted) would be taken for a paragraph: a line break.
      const text = run.text.replace(/[\u2028\u2029]/g, '\n');
      glyphs.push(
        ...glyphsWith(
          text,
          styleAttributes(run, (key) => key),
        ),
      );
    }
  }
  return glyphs;
}

/** The glyphs as paragraphs; a paragraph mark lost (or text before the first) takes `fallback`'s look. */
function paragraphsOf(glyphs: readonly Glyph[], fallback: LiveParagraph): LiveParagraph[] {
  const paragraphs: LiveParagraph[] = [];
  const fallbackLook = (): LiveParagraph => ({ ...fallback, runs: [] });
  // Read once per paragraph and set of attributes – a text has few, and checking is not free.
  let styles = new Map<string, LiveTextStyle>();
  for (const { char, attributes, key } of glyphs) {
    if (char === PARAGRAPH_MARK) {
      paragraphs.push(lookFrom(attributes, fallback));
      styles = new Map();
      continue;
    }
    if (paragraphs.length === 0) paragraphs.push(fallbackLook());
    const paragraph = paragraphs.at(-1) as LiveParagraph;
    let style = styles.get(key);
    if (!style) {
      style = styleFrom(attributes, (name) => name, paragraph.mark);
      styles.set(key, style);
    }
    const last = paragraph.runs.at(-1);
    if (last && sameStyle(last, style)) last.text += char;
    else paragraph.runs.push({ ...style, text: char } satisfies LiveRun);
  }
  if (paragraphs.length === 0) paragraphs.push(fallbackLook());
  return paragraphs;
}

const sameStyle = (a: LiveTextStyle, b: LiveTextStyle) =>
  STYLE_KEYS.every((key) => (a[key] ?? null) === (b[key] ?? null));

/** The shared text's glyphs, as its delta says. */
function glyphsIn(text: Y.Text): Glyph[] {
  const glyphs: Glyph[] = [];
  for (const op of text.toDelta() as { insert: unknown; attributes?: Attributes }[]) {
    if (typeof op.insert === 'string') glyphs.push(...glyphsWith(op.insert, op.attributes ?? {}));
  }
  return glyphs;
}

/** UTF-16 units before each glyph (Y.Text counts those), the total last. */
function unitsOf(glyphs: readonly Glyph[]): number[] {
  const units = [0];
  for (const { char } of glyphs) units.push((units.at(-1) as number) + char.length);
  return units;
}

/** Inserts glyphs at `index` (UTF-16 units), one insert per stretch of the same attributes. */
function insertGlyphs(text: Y.Text, index: number, glyphs: readonly Glyph[]): void {
  let at = index;
  let i = 0;
  while (i < glyphs.length) {
    const first = glyphs[i] as Glyph;
    let chunk = first.char;
    let j = i + 1;
    while (j < glyphs.length && (glyphs[j] as Glyph).key === first.key) {
      chunk += (glyphs[j] as Glyph).char;
      j += 1;
    }
    text.insert(at, chunk, first.attributes);
    at += chunk.length;
    i = j;
  }
}

/** Where two glyph lists differ: the same up to `start`, and again from `endA` in `a` / `endB` in `b`. */
function differ(
  a: readonly Glyph[],
  b: readonly Glyph[],
  same: (x: Glyph, y: Glyph) => boolean,
): { start: number; endA: number; endB: number } {
  let start = 0;
  while (start < a.length && start < b.length && same(a[start] as Glyph, b[start] as Glyph)) {
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && same(a[endA - 1] as Glyph, b[endB - 1] as Glyph)) {
    endA -= 1;
    endB -= 1;
  }
  return { start, endA, endB };
}

const sameChar = (x: Glyph, y: Glyph) => x.char === y.char;
const sameGlyph = (x: Glyph, y: Glyph) => x.char === y.char && x.key === y.key;

// ── Writing the text ─────────────────────────────────────────────────────────

/** FNV-1a over the glyphs, from `basis` – two bases, two hashes that collide independently. */
function hashOf(glyphs: readonly Glyph[], basis: number): number {
  let hash = basis;
  for (const { char, key } of glyphs) {
    for (const part of [char, key]) {
      for (let i = 0; i < part.length; i += 1) {
        hash ^= part.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
    }
  }
  return hash >>> 0;
}

/**
 * A shared text made from paragraphs (the file's, `typedParagraphs`): the same paragraphs make
 * the same document, down to its ids, wherever it is made – the server's and an editor's merge as
 * one. It is written under a client id of its own (a hash of it, never 0); what the document gets
 * later is written under its own random id. `start` names that beginning – the id, the length and
 * a second hash, so two texts whose ids happen to collide are still told apart: equal starts
 * merge, other ones are carried over (`rebaseLive`).
 */
export function liveTextDoc(paragraphs: readonly LiveParagraph[]): { doc: Y.Doc; start: string } {
  // Never throws: a value the schema would not take (the file's parser is lenient) goes in as it
  // is – the same everywhere – and reads back as the paragraph has it.
  const glyphs = glyphsOf(paragraphs);
  const id = hashOf(glyphs, 0x811c9dc5) || 1;
  const doc = new Y.Doc();
  const own = doc.clientID;
  doc.clientID = id;
  insertGlyphs(liveTextOf(doc), 0, glyphs);
  doc.clientID = own;
  return { doc, start: `${id}.${glyphs.length}.${hashOf(glyphs, 0x050c5d1f)}` };
}

/**
 * The shared text as paragraphs. A paragraph mark lost to two edits at once (both joined the same
 * paragraphs) or text before the first mark take `fallback`'s look; a property missing (or not
 * readable – the others wrote it) the paragraph's or `fallback`'s.
 */
export function readLiveText(text: Y.Text, fallback: LiveParagraph): LiveParagraph[] {
  return paragraphsOf(glyphsIn(text), fallback);
}

/**
 * Makes the shared text say `after`: characters that differ from what it says now are deleted and
 * inserted – typing one character inserts one – and properties that changed on characters that
 * stay are formatted (`format`), so what others type or format elsewhere, or in the same place,
 * at the same time stays. Diffed against the text as it is (not as the caller last saw it): a text
 * that lost a paragraph mark to two edits at once gets it back here. Made as `origin` (`LOCAL`:
 * typed here, for ⌘Z to take back).
 */
export function applyLiveChange(
  text: Y.Text,
  after: readonly LiveParagraph[],
  origin: unknown = LOCAL,
): void {
  const old = glyphsIn(text);
  const next = glyphsOf(after);
  // As few characters changed as can be, wherever they are (a mark put back at the start and a
  // key typed at the end are two small changes, not the whole text written again).
  // Only deleted, where the same characters could be the ones going: the earliest go – not past
  // the change before (`floor`). A paragraph deleted whole then takes its own mark with it, and
  // the next keeps its own – with whatever look the others give it meanwhile – rather than taking
  // on the deleted one's.
  let floor = 0;
  const hunks = hunksOf(old, next, sameChar).map((hunk) => {
    let { from, to } = hunk;
    while (hunk.insert.length === 0 && from > floor && old[from - 1]?.char === old[to - 1]?.char) {
      from -= 1;
      to -= 1;
    }
    floor = to;
    return { ...hunk, from, to };
  });
  const formats = restyled(old, next, placesOf(old.length, hunks));
  if (hunks.length === 0 && formats.length === 0) return;
  const oldUnits = unitsOf(old);
  const write = () => {
    // From the end: the places of the hunks before stay as they were.
    for (const { from, to, insert } of [...hunks].reverse()) {
      const at = oldUnits[from] as number;
      const removed = (oldUnits[to] as number) - at;
      if (removed > 0) text.delete(at, removed);
      insertGlyphs(text, at, insert);
    }
    // In the text as it is now: every character in place.
    for (const { index, length, attributes } of formats) text.format(index, length, attributes);
  };
  if (text.doc) text.doc.transact(write, origin);
  else write();
}

/**
 * The formats that give the characters both lists keep (`places`: where each of `old` is in
 * `next`, `-1` if gone) their look in `next`: the attributes that changed, by stretch, at their
 * places (UTF-16 units) in `next`.
 */
function restyled(
  old: readonly Glyph[],
  next: readonly Glyph[],
  places: Int32Array,
): { index: number; length: number; attributes: Attributes }[] {
  const units = unitsOf(next);
  const formats: { index: number; length: number; attributes: Attributes; key: string }[] = [];
  for (let i = 0; i < old.length; i += 1) {
    const place = places[i] as number;
    if (place < 0) continue;
    const was = old[i] as Glyph;
    const now = next[place] as Glyph;
    if (now.key === was.key) continue;
    const changed: Attributes = {};
    for (const name of ATTRIBUTES) {
      if (now.attributes[name] !== was.attributes[name])
        changed[name] = now.attributes[name] ?? null;
    }
    const key = JSON.stringify(changed);
    const index = units[place] as number;
    const last = formats.at(-1);
    if (last && last.index + last.length === index && last.key === key) {
      last.length += now.char.length;
    } else formats.push({ index, length: now.char.length, attributes: changed, key });
  }
  return formats;
}

/** A change from one glyph list to another: `base[from..to)` becomes `insert`. */
interface Hunk {
  from: number;
  to: number;
  insert: Glyph[];
}

/** Beyond this many differences the diff is one change (prefix and suffix kept) – a rewrite. */
const MAX_DIFFERENCES = 2_000;

/**
 * The changes from `a` to `b`, as few as can be (Myers' diff, glyphs alike as `same` says). Past
 * {@link MAX_DIFFERENCES} the one change between their common start and end.
 */
function hunksOf(
  a: readonly Glyph[],
  b: readonly Glyph[],
  same: (x: Glyph, y: Glyph) => boolean,
): Hunk[] {
  const { start, endA, endB } = differ(a, b, same);
  const n = endA - start;
  const m = endB - start;
  if (n === 0 && m === 0) return [];
  const whole = [{ from: start, to: endA, insert: b.slice(start, endB) }];
  // Furthest reaching paths per diagonal, one copy per number of differences, for the way back.
  const max = Math.min(n + m, MAX_DIFFERENCES);
  const offset = max + 1;
  const reach = new Int32Array(2 * max + 3).fill(-1);
  reach[offset + 1] = 0;
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d += 1) {
    trace.push(reach.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d ||
        (k !== d && (reach[offset + k - 1] as number) < (reach[offset + k + 1] as number))
          ? (reach[offset + k + 1] as number)
          : (reach[offset + k - 1] as number) + 1;
      let y = x - k;
      while (x < n && y < m && same(a[start + x] as Glyph, b[start + y] as Glyph)) {
        x += 1;
        y += 1;
      }
      reach[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return whole;
  // Back from the end: each difference one glyph deleted from `a` or inserted from `b`; the
  // ones next to each other make one change.
  const hunks: Hunk[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const before = trace[d] as Int32Array;
    const k = x - y;
    const inserting =
      k === -d ||
      (k !== d && (before[offset + k - 1] as number) < (before[offset + k + 1] as number));
    const previousK = inserting ? k + 1 : k - 1;
    const previousX = before[offset + previousK] as number;
    const previousY = previousX - previousK;
    const hunk: Hunk = inserting
      ? { from: start + previousX, to: start + previousX, insert: [b[start + previousY] as Glyph] }
      : { from: start + previousX, to: start + previousX + 1, insert: [] };
    const later = hunks.at(-1);
    if (later && later.from === hunk.to) {
      later.from = hunk.from;
      later.insert = [...hunk.insert, ...later.insert];
    } else hunks.push(hunk);
    x = previousX;
    y = previousY;
  }
  return hunks.reverse();
}

/** Where each glyph of `base` is in the list `hunks` make of it (`-1`: deleted there). */
function placesOf(length: number, hunks: readonly Hunk[]): Int32Array {
  const at = new Int32Array(length).fill(-1);
  let i = 0;
  let j = 0;
  for (const { from, to, insert } of hunks) {
    while (i < from) at[i++] = j++;
    i = to;
    j += insert.length;
  }
  while (i < length) at[i++] = j++;
  return at;
}

/**
 * A glyph both changed the look of: each attribute as the side that changed it has it – both
 * changed one, theirs.
 */
function mergedGlyph(base: Glyph, mine: Glyph, theirs: Glyph): Glyph {
  if (mine.key === base.key) return theirs;
  if (theirs.key === base.key || theirs.key === mine.key) return mine;
  const attributes: Attributes = {};
  for (const name of ATTRIBUTES) {
    const was = base.attributes[name];
    attributes[name] =
      theirs.attributes[name] !== was
        ? (theirs.attributes[name] ?? null)
        : (mine.attributes[name] ?? null);
  }
  return glyphsWith(base.char, attributes)[0] as Glyph;
}

/** `list` begins with `head`, glyph for glyph. */
const startsWith = (list: readonly Glyph[], head: readonly Glyph[]) =>
  head.length <= list.length && head.every((glyph, i) => sameGlyph(glyph, list[i] as Glyph));

const sameGlyphs = (a: readonly Glyph[], b: readonly Glyph[]) =>
  a.length === b.length && a.every((glyph, i) => sameGlyph(glyph, b[i] as Glyph));

/**
 * What an editor typed on a start other than the shared text's (the file changed before it
 * joined, the server made it anew, or another hand changed the file under the typing): `mine` was
 * `start`, `theirs` is the other text. Merged three ways, character by character: what either
 * deleted goes, what either inserted stays – both where they inserted at the same place (theirs
 * first), once where they inserted the same – and the characters both kept get the look each side
 * gave them (theirs where both did).
 */
export function rebaseLive(
  start: readonly LiveParagraph[],
  mine: readonly LiveParagraph[],
  theirs: readonly LiveParagraph[],
  fallback: LiveParagraph,
): LiveParagraph[] {
  const base = glyphsOf(start);
  const own = glyphsOf(mine);
  const other = glyphsOf(theirs);
  if (sameGlyphs(base, own)) return [...theirs];
  if (sameGlyphs(base, other)) return [...mine];
  const ownHunks = hunksOf(base, own, sameChar);
  const otherHunks = hunksOf(base, other, sameChar);
  const ownAt = placesOf(base.length, ownHunks);
  const otherAt = placesOf(base.length, otherHunks);
  const inserted = new Map<number, Glyph[][]>();
  for (const hunks of [otherHunks, ownHunks]) {
    for (const { from, insert } of hunks) {
      if (insert.length === 0) continue;
      // The same text inserted on both sides is kept once – also when one side typed on after it
      // (one starts with the other): the longer then.
      const at = inserted.get(from) ?? [];
      const overlap = at.findIndex(
        (earlier) => startsWith(earlier, insert) || startsWith(insert, earlier),
      );
      if (overlap === -1) at.push(insert);
      else if (insert.length > (at[overlap] as Glyph[]).length) at[overlap] = insert;
      inserted.set(from, at);
    }
  }
  const glyphs: Glyph[] = [];
  for (let i = 0; i <= base.length; i += 1) {
    for (const insert of inserted.get(i) ?? []) glyphs.push(...insert);
    const ownPlace = ownAt[i] ?? -1;
    const otherPlace = otherAt[i] ?? -1;
    // Kept by both (deleted by either: gone).
    if (i < base.length && ownPlace >= 0 && otherPlace >= 0) {
      glyphs.push(
        mergedGlyph(base[i] as Glyph, own[ownPlace] as Glyph, other[otherPlace] as Glyph),
      );
    }
  }
  return paragraphsOf(glyphs, fallback);
}

// ── Where a caret is ─────────────────────────────────────────────────────────

/** A place in the text: paragraph and characters (UTF-16 units) before it in that paragraph. */
export interface LiveTextPoint {
  paragraph: number;
  offset: number;
}

/**
 * Where each paragraph's characters start in the shared text (after its mark) – text before the
 * first mark (it lost its own) is a paragraph of its own, as `readLiveText` reads it.
 */
function paragraphStarts(value: string): number[] {
  const starts = value.startsWith(PARAGRAPH_MARK) ? [] : [0];
  for (let i = 0; i < value.length; i += 1) if (value[i] === PARAGRAPH_MARK) starts.push(i + 1);
  return starts;
}

/** The index in the shared text of a place in its paragraphs (as `readLiveText` gives them). */
export function indexOfPoint(text: Y.Text, point: LiveTextPoint): number {
  const value = text.toString();
  const starts = paragraphStarts(value);
  const start = starts[point.paragraph];
  if (start === undefined) return value.length;
  const next = starts[point.paragraph + 1];
  // Its end: before the next paragraph's mark.
  const end = next === undefined ? value.length : next - 1;
  return Math.min(start + point.offset, end);
}

/** The place in the paragraphs of an index in the shared text. */
export function pointOfIndex(text: Y.Text, index: number): LiveTextPoint {
  const starts = paragraphStarts(text.toString());
  let paragraph = 0;
  while (paragraph + 1 < starts.length && (starts[paragraph + 1] as number) <= index)
    paragraph += 1;
  return { paragraph, offset: Math.max(0, index - (starts[paragraph] ?? 0)) };
}

/** An update that holds nothing: no characters, nothing deleted. */
export function isEmptyUpdate(update: Uint8Array): boolean {
  const { structs, ds } = Y.decodeUpdate(update);
  return structs.length === 0 && ds.clients.size === 0;
}

/**
 * An update builds on something `doc` does not have – it skips ahead of what `doc` knows of a
 * client, or places a character next to (or in) one neither has: applied, it would wait forever
 * for what it misses.
 */
export function updateHasGaps(doc: Y.Doc, update: Uint8Array): boolean {
  const known = Y.decodeStateVector(Y.encodeStateVector(doc));
  const { from, to } = Y.parseUpdateMeta(update);
  for (const [client, clock] of from) if (clock > (known.get(client) ?? 0)) return true;
  // In `doc`, or among what the update brings itself.
  const has = (id: { client: number; clock: number } | null) =>
    !id ||
    id.clock < (known.get(id.client) ?? 0) ||
    (id.clock >= (from.get(id.client) ?? Infinity) && id.clock < (to.get(id.client) ?? 0));
  for (const struct of Y.decodeUpdate(update).structs) {
    if (struct instanceof Y.Skip) return true;
    if (!(struct instanceof Y.Item)) continue;
    const parent = struct.parent as unknown;
    const parentId =
      parent && typeof parent === 'object' && 'client' in parent
        ? (parent as { client: number; clock: number })
        : null;
    if (!has(struct.origin) || !has(struct.rightOrigin) || !has(parentId)) return true;
  }
  return false;
}

// ── Over the wire ────────────────────────────────────────────────────────────

/** Bytes as base64, for JSON (updates, caret positions). */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
