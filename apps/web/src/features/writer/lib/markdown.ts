import {
  MAX_LIST_LEVEL,
  MAX_WRITER_OPERATIONS,
  WRITER_PICTURE_CHAR,
  isWriterLink,
  writerFormatOf,
  writerText,
  type WriterAnchor,
  type WriterBlock,
  type WriterContent,
  type WriterEditInput,
  type WriterEditResult,
  type WriterOperation,
  type WriterParagraphBlock,
  type WriterRun,
  type WriterStep,
} from '@slider/shared';
import {
  applySteps,
  caret,
  newId,
  sliceRuns,
  stepsBetween,
  type Blocks,
  type Edit,
  type Formats,
  type Point,
} from './model';

/*
 * A Markdown file in Writer (`packages/odt` MarkdownDocument on the server): its lines are the
 * paragraphs the server sends. Drawn as it is written („Markdown“), every paragraph stays a line
 * of plain characters; drawn rendered („Gerendert“), the lines are read as Markdown here and
 * what is changed is written back into them.
 */

/** Which way a Markdown file is shown: as it is written, or as it reads. */
export const MARKDOWN_VIEWS = ['rendered', 'raw'] as const;
export type MarkdownView = (typeof MARKDOWN_VIEWS)[number];

const plainLine = (block: WriterParagraphBlock) =>
  block.kind === 'text' &&
  !block.list &&
  !block.align &&
  !block.lineHeight &&
  !block.breakBefore &&
  !block.locked &&
  !block.pictures?.length &&
  block.runs.length <= 1 &&
  (block.runs.length === 0 || Object.keys(block.runs[0]!).length === 1);

/**
 * An edit as the raw file can hold it: lines of characters – a mark, a format, a list, a table, a
 * picture become nothing (their characters stay). Blocks already plain are kept as they are.
 */
export function plainEdit(edit: Edit): Edit {
  let changed = false;
  const blocks: Blocks = edit.blocks.flatMap((block): WriterParagraphBlock[] => {
    if (block.type !== 'paragraph') {
      changed = true;
      return [];
    }
    if (plainLine(block)) return [block];
    changed = true;
    const text = writerText(block).replaceAll(WRITER_PICTURE_CHAR, '').replace(/\r?\n/g, ' ');
    return [
      {
        type: 'paragraph',
        id: block.id,
        kind: 'text',
        runs: text ? [{ text }] : [],
        look: block.look,
      },
    ];
  });
  return changed && blocks.length > 0 ? { ...edit, blocks } : edit;
}

// ── Rendered: the lines read as Markdown ────────────────────────────────────

/** A line of the file as the server sends it: its id and its characters. */
export interface Line {
  id: string;
  text: string;
}

/** Where a character of a rendered paragraph stands in the file. */
interface Pos {
  line: string;
  col: number;
}

interface Part {
  line: Line;
  from: number;
  text: string;
}

/** A piece of the file drawn together: a paragraph, a heading, a list item, a code block. */
interface Unit {
  blocks: WriterParagraphBlock[];
  /** Its lines as written – fences, markers, wrapped lines, a heading's underline. */
  lines: Line[];
  /** What stands between it and the next: blank lines, a quote's empty `>`. */
  gap: Line[];
  /** The first line's characters before its words: `## `, `  - `, `> `. */
  prefix: string;
  /** A paragraph's lines (it may go on over several). */
  parts?: Part[];
  /** A heading underlined (`===`/`---`). */
  setext?: Line;
  /** A code block: its fences (none: indented by four). */
  code?: { open: Line | null; close: Line | null; indent: string };
  /** The first block of the unit after it in the file. */
  next?: string;
}

export interface Rendered {
  /** Blank lines before the first block. */
  head: Line[];
  units: Unit[];
  blocks: WriterParagraphBlock[];
  /** Each rendered block's characters in the file, one more for its end. */
  maps: Map<string, Pos[]>;
}

const BLANK = /^\s*$/;
const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const ATX = /^( {0,3}#{1,6})(?:[ \t]+|$)(.*?)(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*)|$)/;
const QUOTE = /^( {0,3}> ?)(.*)$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const TABLE = /^\s*\|/;
const HTML = /^ {0,3}<(?:\/?[a-zA-Z][\w-]*(?:[\s/>]|$)|!--)/;
const INDENTED = /^(?: {4}|\t)/;

const PUNCT = /[!-/:-@[-`{-~]/;
const LINK = /^\[((?:\\.|[^\]\\])*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/;
const IMAGE = /^!\[(?:\\.|[^\]\\])*\]\([^)]*\)/;
const AUTOLINK = /^<((?:https?:\/\/|mailto:)[^>\s]+)>/;
const word = (char: string | undefined) => !!char && /[\p{L}\p{N}]/u.test(char);
const range = (from: number, length: number) => Array.from({ length }, (_, index) => from + index);

const marksKey = (run: WriterRun) =>
  `${run.bold ? 'b' : ''}${run.italic ? 'i' : ''}${run.strike ? 's' : ''}|${run.font ?? ''}|${run.link ?? ''}`;

/** A paragraph's characters read for their marks; `cols`: where each drawn character stands. */
export function parseInline(src: string, code: string): { runs: WriterRun[]; cols: number[] } {
  const runs: WriterRun[] = [];
  const cols: number[] = [];
  const marks = { bold: false, italic: false, strike: false };
  let text = '';
  let places: number[] = [];
  const push = (chars: string, at: number[], extra: Partial<WriterRun> = {}) => {
    if (chars === '') return;
    const run: WriterRun = {
      text: chars,
      ...(marks.bold && { bold: true }),
      ...(marks.italic && { italic: true }),
      ...(marks.strike && { strike: true }),
      ...extra,
    };
    const last = runs.at(-1);
    if (last && marksKey(last) === marksKey(run)) last.text += chars;
    else runs.push(run);
    cols.push(...at);
  };
  const flush = () => {
    push(text, places);
    text = '';
    places = [];
  };
  const keep = (from: number, length: number) => {
    text += src.slice(from, from + length);
    places.push(...range(from, length));
  };
  /** The same sign again further on, not escaped: the mark closes there. */
  const closes = (sign: string, from: number) => {
    for (let at = from; at < src.length; at += 1) {
      if (src[at] === '\\') at += 1;
      else if (src.startsWith(sign, at)) return at > from;
    }
    return false;
  };
  for (let at = 0; at < src.length; at += 1) {
    const char = src[at]!;
    const rest = src.slice(at);
    if (char === '\\' && PUNCT.test(src[at + 1] ?? '')) {
      keep(at + 1, 1);
      at += 1;
      continue;
    }
    if (char === '`') {
      const ticks = /^`+/.exec(rest)![0];
      let close = -1;
      for (let from = at + ticks.length; from < src.length;) {
        const found = src.indexOf(ticks, from);
        if (found < 0) break;
        const run = /^`+/.exec(src.slice(found))![0];
        if (run.length === ticks.length) {
          close = found;
          break;
        }
        from = found + run.length;
      }
      if (close < 0) {
        keep(at, ticks.length);
        at += ticks.length - 1;
        continue;
      }
      flush();
      let start = at + ticks.length;
      let end = close;
      const inner = src.slice(start, end);
      if (inner.length > 2 && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim()) {
        start += 1;
        end -= 1;
      }
      push(src.slice(start, end), range(start, end - start), { font: code });
      at = close + ticks.length - 1;
      continue;
    }
    const inWord = word(src[at - 1]) && word(src[at + 1]);
    const pair = rest.slice(0, 2);
    if ((pair === '**' || pair === '__') && !(char === '_' && word(src[at - 1]))) {
      if (marks.bold || closes(pair, at + 2)) {
        flush();
        marks.bold = !marks.bold;
        at += 1;
        continue;
      }
    }
    if ((char === '*' || char === '_') && !(char === '_' && inWord)) {
      if (marks.italic || (src[at + 1] !== ' ' && closes(char, at + 1))) {
        flush();
        marks.italic = !marks.italic;
        continue;
      }
    }
    if (pair === '~~' && (marks.strike || closes('~~', at + 2))) {
      flush();
      marks.strike = !marks.strike;
      at += 1;
      continue;
    }
    const image = char === '!' ? IMAGE.exec(rest) : null;
    if (image) {
      keep(at, image[0].length);
      at += image[0].length - 1;
      continue;
    }
    const link = char === '[' ? LINK.exec(rest) : null;
    if (link && isWriterLink(link[2]!)) {
      flush();
      const inner = parseInline(link[1]!, code);
      let index = 0;
      for (const { text: chars, ...own } of inner.runs) {
        const at0 = inner.cols.slice(index, index + chars.length).map((col) => at + 1 + col);
        index += chars.length;
        push(chars, at0, { ...own, link: link[2]! });
      }
      at += link[0].length - 1;
      continue;
    }
    const auto = char === '<' ? AUTOLINK.exec(rest) : null;
    if (auto) {
      flush();
      push(auto[1]!, range(at + 1, auto[1]!.length), { link: auto[1]! });
      at += auto[0].length - 1;
      continue;
    }
    keep(at, 1);
  }
  flush();
  cols.push(src.length);
  return { runs, cols };
}

/** Characters as Markdown writes them: what would start a mark is escaped. */
function escapeText(text: string): string {
  let out = '';
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]!;
    const next = text[at + 1];
    if (char === '\\' && (next === undefined || PUNCT.test(next))) out += '\\\\';
    else if (char === '*' || char === '`') out += `\\${char}`;
    else if (char === '_' && !(word(text[at - 1]) && word(next))) out += '\\_';
    else if (char === '~' && (next === '~' || text[at - 1] === '~')) out += '\\~';
    else if (char === '[' && text.indexOf('](', at) > at) out += '\\[';
    else if (char === '<' && AUTOLINK.test(text.slice(at))) out += '\\<';
    else out += char;
  }
  return out;
}

/** Runs as Markdown: `**bold**`, `*italic*`, `~~struck~~`, `` `code` ``, `[link](…)`. */
export function writeInline(runs: readonly WriterRun[], code: string): string {
  const merged: WriterRun[] = [];
  for (const run of runs) {
    if (run.text === '' || run.picture) continue;
    const last = merged.at(-1);
    if (last && marksKey(last) === marksKey(run))
      merged[merged.length - 1] = { ...last, text: last.text + run.text };
    else merged.push(run);
  }
  return merged
    .map((run) => {
      const text = run.text.replace(/\r?\n/g, ' ');
      if (run.font === code) {
        const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((ticks) => ticks.length));
        const ticks = '`'.repeat(longest + 1);
        const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
        const inline = `${ticks}${pad}${text}${pad}${ticks}`;
        return run.link ? `[${inline}](${run.link})` : inline;
      }
      if (run.link && text === run.link && !run.bold && !run.italic && !run.strike)
        return `<${text}>`;
      // Spaces stand outside the marks: `** x**` would mark nothing.
      const [, lead = '', core = '', trail = ''] = /^(\s*)(.*?)(\s*)$/s.exec(text) ?? [];
      if (core === '') return text;
      let inner = escapeText(core);
      if (run.strike) inner = `~~${inner}~~`;
      if (run.italic) inner = `*${inner}*`;
      if (run.bold) inner = `**${inner}**`;
      if (run.link) inner = `[${inner}](${run.link})`;
      return `${lead}${inner}${trail}`;
    })
    .join('');
}

/** A paragraph's words that would read as the start of a block are escaped: `\#`, `1\.`. */
function guardStart(text: string): string {
  const trimmed = text.replace(/^[ \t]+/, '');
  const number = /^(\d{1,9})([.)])(?=[ \t]|$)/.exec(trimmed);
  if (number) return `${number[1]}\\${trimmed.slice(number[1]!.length)}`;
  const block =
    /^(#{1,6}(?=[ \t]|$)|[-+>](?=[ \t]|$)|\||<[a-zA-Z/!]|`{3}|~{3}|=+[ \t]*$)/.test(trimmed) ||
    RULE.test(trimmed);
  return block ? `\\${trimmed}` : trimmed;
}

const blank = (block: WriterParagraphBlock) => block.runs.every((run) => run.text === '');

/** The file's lines read as Markdown: the blocks to draw, and where each came from. */
export function readMarkdown(lines: readonly Line[], formats: Formats): Rendered {
  const code = formats.preformatted.font;
  const head: Line[] = [];
  const units: Unit[] = [];
  const maps = new Map<string, Pos[]>();
  /** The list items' indents above, the outermost first. */
  let indents: number[] = [];

  const paragraph = (
    id: string,
    kind: WriterParagraphBlock['kind'],
    parts: Part[],
    extra: Pick<WriterParagraphBlock, 'level' | 'list'> = {},
  ): WriterParagraphBlock => {
    // Wrapped lines are one paragraph: joined by a space, each character's place kept.
    let src = '';
    const places: Pos[] = [];
    parts.forEach((part, index) => {
      if (index > 0) {
        src += ' ';
        places.push({ line: part.line.id, col: part.from });
      }
      src += part.text;
      for (let col = 0; col < part.text.length; col += 1)
        places.push({ line: part.line.id, col: part.from + col });
    });
    const last = parts.at(-1)!;
    places.push({ line: last.line.id, col: last.from + last.text.length });
    const inline = kind === 'preformatted' ? null : parseInline(src, code);
    maps.set(id, inline ? inline.cols.map((col) => places[col]!) : places);
    // A heading's words are bold as it is: each stretch says its weight itself.
    const read = inline ? inline.runs : src ? [{ text: src }] : [];
    const runs = kind === 'heading' ? read.map((run) => ({ ...run, bold: true })) : read;
    return {
      type: 'paragraph',
      id,
      kind,
      ...(extra.level !== undefined && { level: extra.level }),
      ...(extra.list && { list: extra.list }),
      runs,
      look: formats[writerFormatOf({ kind, level: extra.level })],
    };
  };
  /** What the editor does not draw (a table, HTML, front matter): shown as written, not typed in. */
  const locked = (
    group: Line[],
    text = group.map((line) => line.text).join('\n'),
  ): WriterParagraphBlock => {
    const id = group[0]!.id;
    const map: Pos[] = [];
    group.forEach((line, index) => {
      if (index > 0) map.push({ line: line.id, col: 0 });
      for (let col = 0; col < line.text.length; col += 1) map.push({ line: line.id, col });
    });
    map.push({ line: group.at(-1)!.id, col: group.at(-1)!.text.length });
    maps.set(
      id,
      map.length === text.length + 1
        ? map
        : range(0, text.length + 1).map(() => ({ line: id, col: 0 })),
    );
    return {
      type: 'paragraph',
      id,
      kind: 'text',
      locked: true,
      runs: [{ text, font: code, color: '#787774' }],
      look: formats.text,
    };
  };
  const add = (unit: Omit<Unit, 'gap'>) => {
    const last = units.at(-1);
    if (last) last.next = unit.blocks[0]!.id;
    units.push({ ...unit, gap: [] });
  };

  let at = 0;
  // Front matter (`---` … `---` on the first lines) is shown as written.
  if (lines[0]?.text === '---') {
    const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line.text));
    if (end > 0) {
      const group = lines.slice(0, end + 1);
      add({ blocks: [locked(group)], lines: group, prefix: '' });
      at = end + 1;
    }
  }
  while (at < lines.length) {
    const line = lines[at]!;
    const text = line.text;
    const last = units.at(-1);
    if (BLANK.test(text)) {
      (last ? last.gap : head).push(line);
      at += 1;
      continue;
    }
    // The paragraph right above, still open: a next line goes on in it.
    const open = last && last.gap.length === 0 && last.parts ? last : null;
    const fence = FENCE.exec(text);
    if (fence && !(fence[2]![0] === '`' && fence[3]!.includes('`'))) {
      indents = [];
      const sign = fence[2]!;
      const closing = new RegExp(`^ {0,3}${sign[0] === '`' ? '`' : '~'}{${sign.length},}\\s*$`);
      let end = at + 1;
      while (end < lines.length && !closing.test(lines[end]!.text)) end += 1;
      const body = lines.slice(at + 1, end);
      const close = lines[end] ?? null;
      const indent = fence[1]!;
      const blocks = body.length
        ? body.map((each) => {
            const from = Math.min(
              indent.length,
              each.text.length - each.text.replace(/^ +/, '').length,
            );
            return paragraph(each.id, 'preformatted', [
              { line: each, from, text: each.text.slice(from) },
            ]);
          })
        : [paragraph(`${line.id}.c`, 'preformatted', [{ line, from: text.length, text: '' }])];
      add({
        blocks,
        lines: lines.slice(at, close ? end + 1 : end),
        prefix: '',
        code: { open: line, close, indent },
      });
      at = close ? end + 1 : end;
      continue;
    }
    if (INDENTED.test(text) && !open && !(indents.length && last?.blocks[0]?.list)) {
      indents = [];
      let end = at;
      while (end < lines.length && INDENTED.test(lines[end]!.text)) end += 1;
      const body = lines.slice(at, end);
      add({
        blocks: body.map((each) => {
          const from = each.text.startsWith('\t') ? 1 : 4;
          return paragraph(each.id, 'preformatted', [
            { line: each, from, text: each.text.slice(from) },
          ]);
        }),
        lines: body,
        prefix: '',
        code: { open: null, close: null, indent: '    ' },
      });
      at = end;
      continue;
    }
    // `===` or `---` under a paragraph's one line: it is a heading.
    const setext = SETEXT.exec(text);
    const openBlock = open?.blocks[0];
    if (
      setext &&
      open &&
      openBlock?.kind === 'text' &&
      !openBlock.list &&
      open.parts!.length === 1
    ) {
      const level = setext[1]![0] === '=' ? 1 : 2;
      open.blocks[0] = paragraph(openBlock.id, 'heading', open.parts!, { level });
      open.setext = line;
      open.parts = undefined;
      open.lines.push(line);
      at += 1;
      continue;
    }
    const atx = ATX.exec(text);
    if (atx) {
      indents = [];
      const words = atx[2] ?? '';
      const from = words ? text.indexOf(words, atx[1]!.length) : text.length;
      add({
        blocks: [
          paragraph(line.id, 'heading', [{ line, from, text: words }], {
            level: atx[1]!.trim().length,
          }),
        ],
        lines: [line],
        prefix: text.slice(0, from),
      });
      at += 1;
      continue;
    }
    if (RULE.test(text)) {
      indents = [];
      add({ blocks: [locked([line], '———')], lines: [line], prefix: '' });
      at += 1;
      continue;
    }
    if (TABLE.test(text) || HTML.test(text)) {
      indents = [];
      const table = TABLE.test(text);
      let end = at + 1;
      while (
        end < lines.length &&
        !BLANK.test(lines[end]!.text) &&
        (!table || TABLE.test(lines[end]!.text))
      )
        end += 1;
      const group = lines.slice(at, end);
      add({ blocks: [locked(group)], lines: group, prefix: '' });
      at = end;
      continue;
    }
    const item = ITEM.exec(text);
    if (item && !(open && /\d/.test(item[2]!) && !item[4])) {
      const indent = item[1]!.length;
      while (indents.length && indents.at(-1)! > indent) indents.pop();
      if (!indents.length || indents.at(-1)! < indent) indents.push(indent);
      const words = item[4] ?? '';
      const from = item[3] ? item[1]!.length + item[2]!.length + item[3].length : text.length;
      const kind = /\d/.test(item[2]!) ? 'number' : 'bullet';
      const parts = [{ line, from, text: words }];
      add({
        blocks: [
          paragraph(line.id, 'text', parts, {
            list: { kind, level: Math.min(MAX_LIST_LEVEL, indents.length - 1) },
          }),
        ],
        lines: [line],
        prefix: text.slice(0, from),
        parts,
      });
      at += 1;
      continue;
    }
    const quote = QUOTE.exec(text);
    if (quote) {
      indents = [];
      if (BLANK.test(quote[2]!)) {
        // A quote's empty line: between two of its paragraphs.
        (last ? last.gap : head).push(line);
        at += 1;
        continue;
      }
      if (open && openBlock?.kind === 'quote') {
        open.parts!.push({ line, from: quote[1]!.length, text: quote[2]! });
        open.blocks[0] = paragraph(openBlock.id, 'quote', open.parts!);
        open.lines.push(line);
        at += 1;
        continue;
      }
      const parts = [{ line, from: quote[1]!.length, text: quote[2]! }];
      add({
        blocks: [paragraph(line.id, 'quote', parts)],
        lines: [line],
        prefix: quote[1]!,
        parts,
      });
      at += 1;
      continue;
    }
    // A line of words: the paragraph above goes on (a list item's, a quote's too), or one begins.
    const from = text.length - text.replace(/^\s+/, '').length;
    const part = { line, from, text: text.slice(from) };
    if (open && openBlock && openBlock.kind !== 'heading') {
      open.parts!.push(part);
      open.blocks[0] = paragraph(openBlock.id, openBlock.kind, open.parts!, {
        ...(openBlock.list && { list: openBlock.list }),
      });
      open.lines.push(line);
      at += 1;
      continue;
    }
    indents = [];
    add({ blocks: [paragraph(line.id, 'text', [part])], lines: [line], prefix: '', parts: [part] });
    at += 1;
  }
  return { head, units, blocks: units.flatMap((unit) => unit.blocks), maps };
}

/** What makes a rendered paragraph the same: its kind, its list, its words and their marks. */
const signature = (block: WriterParagraphBlock, code: string) =>
  [
    block.kind,
    block.kind === 'heading' ? (block.level ?? 1) : '',
    block.list ? `${block.list.kind}${block.list.level}` : '',
    block.locked ? `L${writerText(block)}` : wordsOf(block, code),
  ].join('|');

/** A block's words as Markdown – a heading's without `**`: it is bold as it is. */
const wordsOf = (block: WriterParagraphBlock, code: string) =>
  writeInline(
    block.kind === 'heading' ? block.runs.map(({ bold: _bold, ...run }) => run) : block.runs,
    code,
  );

/**
 * The rendered blocks written back into the file's lines: what is unchanged keeps its lines as
 * they were (their ids, their own way of writing); what is new or changed is written anew, with
 * the block's id for its first line.
 */
export function writeMarkdown(old: Rendered, blocks: Blocks, formats: Formats): Line[] {
  const code = formats.preformatted.font;
  const list = blocks.filter((block): block is WriterParagraphBlock => block.type === 'paragraph');
  const unitOf = new Map<string, Unit>();
  for (const unit of old.units) for (const block of unit.blocks) unitOf.set(block.id, unit);
  const was = new Map(old.blocks.map((block) => [block.id, signature(block, code)]));
  const same = (block: WriterParagraphBlock) => was.get(block.id) === signature(block, code);

  type Out = Line | { base: string; text: string };
  const out: Out[] = [...old.head];
  const placed = new Set<Line>();
  const put = (...lines: Line[]) => {
    for (const line of lines) {
      if (placed.has(line)) continue;
      placed.add(line);
      out.push(line);
    }
  };
  let prev: { block: WriterParagraphBlock } | null = null;
  /** What goes between the block before and `next`: their own gap where they stood so before. */
  const between = (next: WriterParagraphBlock) => {
    if (!prev) return;
    const unit = unitOf.get(prev.block.id);
    if (unit && unit.blocks.at(-1)!.id === prev.block.id && unit.next === next.id) {
      put(...unit.gap);
      return;
    }
    if (prev.block.list && next.list) return;
    out.push({ base: `${next.id}.b`, text: '' });
  };

  for (let at = 0; at < list.length;) {
    const block = list[at]!;
    const unit = unitOf.get(block.id);
    // A unit as it was: its lines as they are.
    if (
      unit &&
      unit.blocks[0]!.id === block.id &&
      unit.blocks.every(
        (each, index) => list[at + index]?.id === each.id && same(list[at + index]!),
      )
    ) {
      between(block);
      put(...unit.lines);
      prev = { block: unit.blocks.at(-1)! };
      at += unit.blocks.length;
      continue;
    }
    if (block.kind === 'preformatted') {
      // Code lines next to each other are one block, until another block of the file's begins.
      let end = at + 1;
      while (end < list.length && list[end]!.kind === 'preformatted') {
        const other = unitOf.get(list[end]!.id);
        if (other !== unit && other?.blocks[0]?.id === list[end]!.id) break;
        end += 1;
      }
      const lines = list.slice(at, end);
      const fence = unit?.code && unit.code.open ? unit.code : null;
      const indented = unit?.code && !unit.code.open;
      between(block);
      if (fence?.open) put(fence.open);
      else if (!indented) out.push({ base: `${block.id}.f`, text: '```' });
      const indent = fence ? fence.indent : indented ? '    ' : '';
      for (const each of lines) {
        const text = writerText(each).replace(/\r?\n/g, ' ');
        const own = unitOf.get(each.id)?.lines.find((line) => line.id === each.id);
        if (own && same(each)) put(own);
        else if (!(each.id.endsWith('.c') && text === '' && lines.length === 1 && fence))
          out.push({ base: each.id, text: indent + text });
      }
      if (fence?.close) put(fence.close);
      else if (!indented) out.push({ base: `${block.id}.e`, text: '```' });
      prev = { block: lines.at(-1)! };
      at = end;
      continue;
    }
    at += 1;
    if (block.locked) {
      // Not typed in, only taken away or moved: its lines go with it.
      if (unit) {
        between(block);
        put(...unit.lines);
        prev = { block };
      }
      continue;
    }
    const inline = wordsOf(block, code);
    const words = block.kind === 'heading' ? inline.trim() : guardStart(inline);
    const first = unit?.blocks[0];
    const kept = first?.id === block.id ? first : undefined;
    if (block.kind === 'heading') {
      const level = block.level ?? 1;
      between(block);
      if (kept?.kind === 'heading' && kept.level === level && unit!.setext && words) {
        out.push({ base: block.id, text: words });
        put(unit!.setext);
      } else {
        const prefix =
          kept?.kind === 'heading' && kept.level === level && !unit!.setext
            ? unit!.prefix
            : `${'#'.repeat(level)} `;
        out.push({ base: block.id, text: `${prefix}${words}` });
      }
      prev = { block };
      continue;
    }
    if (block.list) {
      const { kind, level } = block.list;
      const prefix =
        kept?.list?.kind === kind && kept.list.level === level
          ? unit!.prefix
          : `${'  '.repeat(level)}${kind === 'bullet' ? '-' : '1.'} `;
      between(block);
      out.push({ base: block.id, text: `${prefix}${words}` });
      prev = { block };
      continue;
    }
    // An empty paragraph is nothing in Markdown: the blank line between the others.
    if (blank(block)) continue;
    const prefix = block.kind === 'quote' ? (kept?.kind === 'quote' ? unit!.prefix : '> ') : '';
    between(block);
    out.push({ base: block.id, text: `${prefix}${words}` });
    prev = { block };
  }
  // The end of the file as it was (blank lines after the last block), where that block still ends it.
  if (prev) {
    const unit = unitOf.get(prev.block.id);
    if (unit && !unit.next && unit.blocks.at(-1)!.id === prev.block.id) put(...unit.gap);
  }
  if (out.length === 0) out.push({ base: list[0]?.id ?? old.blocks[0]?.id ?? 'L1', text: '' });

  // Ids last: a line kept keeps its own, a new one takes its block's – unless another has it.
  const taken = new Set(out.filter((line): line is Line => 'id' in line).map((line) => line.id));
  return out.map((line) => {
    if ('id' in line) return line;
    let id = line.base.length > 48 ? newId() : line.base;
    for (let n = 2; taken.has(id); n += 1) id = `${line.base.slice(0, 48)}.${n}`;
    taken.add(id);
    return { id, text: line.text };
  });
}

/**
 * An edit as rendered Markdown holds it: what Markdown cannot write (a colour, a size, a table, a
 * picture) becomes nothing; typed at a paragraph's start, `# `, `- `, `1. `, `> ` and ``` make it a
 * heading, a list item, a quote, code – as Notion does.
 */
export function notesEdit(edit: Edit, formats: Formats): Edit {
  const code = formats.preformatted.font;
  const focus = edit.sel.focus;
  let changed = false;
  let sel = edit.sel;
  const blocks: WriterParagraphBlock[] = [];
  for (const block of edit.blocks) {
    if (block.type !== 'paragraph') {
      changed = true;
      continue;
    }
    if (block.locked) {
      blocks.push(block);
      continue;
    }
    let next = block;
    const runs = block.runs.flatMap((run): WriterRun[] => {
      if (run.picture) return [];
      const kept: WriterRun = {
        text: run.text.replace(/\r?\n/g, ' '),
        ...(run.bold && { bold: true }),
        ...(run.italic && { italic: true }),
        ...(run.strike && { strike: true }),
        ...(run.link && { link: run.link }),
        ...(run.font === code && { font: code }),
      };
      return [kept];
    });
    const kind =
      block.kind === 'title'
        ? 'heading'
        : ['heading', 'quote', 'preformatted', 'text'].includes(block.kind)
          ? block.kind
          : 'text';
    const level = block.kind === 'title' ? 1 : block.level;
    const tidy =
      kind !== block.kind ||
      block.align ||
      block.lineHeight ||
      block.breakBefore ||
      block.pictures?.length ||
      (kind === 'preformatted' && block.list) ||
      runs.length !== block.runs.length ||
      runs.some((run, index) => Object.keys(run).length !== Object.keys(block.runs[index]!).length);
    if (tidy) {
      next = {
        type: 'paragraph',
        id: block.id,
        kind,
        ...(kind === 'heading' && { level: level ?? 1 }),
        ...(block.list && kind !== 'preformatted' && { list: block.list }),
        runs,
        look: formats[writerFormatOf({ kind, level })],
      };
    }
    // The marks of a block typed at its start: only just typed, the caret behind it.
    if (next.kind === 'text' && !next.list && focus.id === next.id) {
      const text = writerText(next);
      const typed = text.slice(0, focus.offset);
      const shortcut =
        /^(#{1,6}) $/.exec(typed) ??
        /^([-*+]) $/.exec(typed) ??
        /^(1[.)]) $/.exec(typed) ??
        /^(>) $/.exec(typed) ??
        (text === '```' && focus.offset === 3 ? ['```', '```'] : null);
      if (shortcut) {
        const sign = shortcut[1]!;
        const cut = typed.length;
        const rest = { ...next, runs: sliceRuns(next.runs, cut) };
        const shaped: WriterParagraphBlock = sign.startsWith('#')
          ? { ...rest, kind: 'heading', level: sign.length }
          : sign === '>'
            ? { ...rest, kind: 'quote' }
            : sign === '```'
              ? { ...rest, kind: 'preformatted', runs: [] }
              : { ...rest, list: { kind: /\d/.test(sign) ? 'number' : 'bullet', level: 0 } };
        next = { ...shaped, look: formats[writerFormatOf(shaped)] };
        sel = caret(next.id, 0);
      }
    }
    // A heading is bold through: its words say so themselves, as when it is read.
    if (next.kind === 'heading' && next.runs.some((run) => !run.bold)) {
      next = { ...next, runs: next.runs.map((run) => ({ ...run, bold: true })) };
    }
    if (next !== block) changed = true;
    blocks.push(next);
  }
  if (!changed) return edit;
  return blocks.length > 0 ? { blocks, sel } : edit;
}

// ── Between the editor and the file ─────────────────────────────────────────

const linesOf = (blocks: Blocks): Line[] =>
  blocks.flatMap((block) =>
    block.type === 'paragraph' ? [{ id: block.id, text: writerText(block) }] : [],
  );

/** The lines' words that changed, line by line: comments standing at them move along. */
export function lineChanges(before: readonly Line[], after: readonly Line[]) {
  const was = new Map(before.map((line) => [line.id, line.text]));
  return after.flatMap((line) => {
    const old = was.get(line.id);
    return old === undefined || old === line.text
      ? []
      : [{ id: line.id, before: old, after: line.text }];
  });
}

/**
 * The editor draws a Markdown file rendered; the server keeps its lines. Between them: what the
 * editor sends is written into lines (`writeMarkdown`) and sent as changes of lines; what comes
 * from the server (someone else's lines, the file read anew) is read as Markdown and given to the
 * editor as changes of what it draws.
 */
export class MarkdownCodec {
  /** The file's lines as the server has them, once what was sent is written. */
  private raw: WriterParagraphBlock[] = [];
  /** Those lines read. */
  rendered!: Rendered;
  /** What the editor drew when it last sent: the lines are that, written. */
  private view: Blocks = [];
  /** Each edit sent, as lines: sent again as it was (the line was down). */
  private readonly sent = new Map<string, WriterOperation[][]>();
  /** Edits split for the server's limit: theirs come back as nobody's. */
  private readonly extra = new Set<string>();

  constructor(
    content: WriterContent,
    private readonly formats: Formats,
  ) {
    this.read(content.blocks);
  }

  private read(blocks: Blocks) {
    this.raw = blocks.filter((block): block is WriterParagraphBlock => block.type === 'paragraph');
    this.rendered = readMarkdown(linesOf(this.raw), this.formats);
    this.view = this.rendered.blocks;
  }

  /** The content as the editor draws it. */
  shown(content: WriterContent): WriterContent {
    return { ...content, blocks: this.rendered.blocks };
  }

  /** The file's lines as `view` writes them – for the comments, before anything is sent. */
  linesFor(view: Blocks): { lines: Line[]; rendered: Rendered } {
    const lines = writeMarkdown(this.rendered, view, this.formats);
    return { lines, rendered: readMarkdown(lines, this.formats) };
  }

  private lineBlocks(lines: readonly Line[]): WriterParagraphBlock[] {
    const was = new Map(this.raw.map((block) => [block.id, block]));
    return lines.map((line) => {
      const old = was.get(line.id);
      if (old && writerText(old) === line.text) return old;
      return {
        type: 'paragraph',
        id: line.id,
        kind: 'text',
        runs: line.text ? [{ text: line.text }] : [],
        look: this.formats.text,
      };
    });
  }

  /** The editor's changes sent as the lines' changes. */
  async send(
    input: WriterEditInput,
    send: (input: WriterEditInput) => Promise<WriterEditResult>,
  ): Promise<WriterEditResult> {
    let chunks = this.sent.get(input.clientEditId);
    if (!chunks) {
      const view = applySteps(this.view, input.operations, this.formats).blocks;
      const lines = writeMarkdown(this.rendered, view, this.formats);
      const raw = this.lineBlocks(lines);
      const ops = stepsBetween(this.raw, raw);
      chunks = [];
      for (let at = 0; at < ops.length; at += MAX_WRITER_OPERATIONS) {
        chunks.push(ops.slice(at, at + MAX_WRITER_OPERATIONS));
      }
      this.sent.set(input.clientEditId, chunks);
      this.raw = raw;
      this.rendered = readMarkdown(lines, this.formats);
      this.view = view;
    }
    let result: WriterEditResult = { seq: 0, versionId: null, dropped: [] };
    for (const [index, operations] of chunks.entries()) {
      const last = index === chunks.length - 1;
      const clientEditId = last ? input.clientEditId : crypto.randomUUID();
      if (!last) this.extra.add(clientEditId);
      const answer = await send({ ...input, operations, clientEditId });
      result = { ...answer, dropped: [...result.dropped, ...answer.dropped] };
    }
    // Done in one go: what was split is not sent again.
    if (chunks.length > 1) this.sent.set(input.clientEditId, chunks.slice(-1));
    return result;
  }

  /** Someone else's lines, as changes of what the editor draws; `null`: nothing for it. */
  remote(step: WriterStep): WriterStep | null {
    if (step.clientEditId && this.extra.has(step.clientEditId)) return null;
    if (step.clientEditId && this.sent.has(step.clientEditId)) return step;
    const raw = applySteps(this.raw, step.operations, this.formats).blocks;
    this.raw = raw.filter((block): block is WriterParagraphBlock => block.type === 'paragraph');
    this.rendered = readMarkdown(linesOf(this.raw), this.formats);
    const next = this.keepEmpty(this.rendered.blocks);
    const operations = stepsBetween(this.view, next);
    this.view = next;
    return { ...step, operations };
  }

  /** The file read anew: as the editor draws it. */
  refetched(content: WriterContent): WriterContent {
    const drawn = this.view;
    this.read(content.blocks);
    const blocks = this.keepEmpty(this.rendered.blocks, drawn);
    this.view = blocks;
    return { ...content, blocks };
  }

  /** An empty paragraph is nothing in the file: where the editor has one, it stays. */
  private keepEmpty(
    read: readonly WriterParagraphBlock[],
    drawn: Blocks = this.view,
  ): WriterBlock[] {
    const out: WriterBlock[] = [...read];
    const ids = new Set(read.map((block) => block.id));
    let after: string | null = null;
    for (const block of drawn) {
      if (ids.has(block.id)) {
        after = block.id;
        continue;
      }
      if (block.type !== 'paragraph' || block.list || block.kind !== 'text' || !blank(block))
        continue;
      const at = after === null ? 0 : out.findIndex((each) => each.id === after) + 1;
      out.splice(at, 0, block);
      ids.add(block.id);
      after = block.id;
    }
    return out;
  }
}

const indexes = new WeakMap<Rendered, Map<string, { id: string; offset: number; col: number }[]>>();

/** Each line's characters, where the rendered text has them. */
function lineIndex(rendered: Rendered) {
  let index = indexes.get(rendered);
  if (index) return index;
  index = new Map();
  for (const [id, map] of rendered.maps) {
    map.forEach((pos, offset) => {
      const list = index!.get(pos.line) ?? [];
      list.push({ id, offset, col: pos.col });
      index!.set(pos.line, list);
    });
  }
  indexes.set(rendered, index);
  return index;
}

/**
 * A point of the file (a line, a column) where the rendered text has it; `end`: the end of a
 * stretch – behind the last drawn character before it (a closing `**` is not drawn).
 */
function viewPoint(rendered: Rendered, line: string, col: number, end = false): Point | null {
  let best: { id: string; offset: number; col: number } | null = null;
  for (const each of lineIndex(rendered).get(line) ?? []) {
    const fits = end ? each.col < col : each.col <= col;
    if (fits && (!best || each.col >= best.col)) best = each;
  }
  if (best) return { id: best.id, offset: best.offset + (end ? 1 : 0) };
  // A line not drawn (a fence, a blank): the block it belongs to.
  const unit = rendered.units.find((each) => each.lines.some((own) => own.id === line));
  return unit ? { id: unit.blocks[0]!.id, offset: 0 } : null;
}

/** A comment's place in the file, where the rendered text shows it. */
export function anchorToView(rendered: Rendered, anchor: WriterAnchor): WriterAnchor | null {
  const start = viewPoint(rendered, anchor.paragraphId, anchor.start);
  if (!start) return null;
  const end = anchor.to
    ? viewPoint(rendered, anchor.to.paragraphId, anchor.to.offset, true)
    : viewPoint(rendered, anchor.paragraphId, anchor.end, true);
  const { to: _to, ...rest } = anchor;
  if (!end || end.id === start.id) {
    return {
      ...rest,
      paragraphId: start.id,
      start: start.offset,
      end: Math.max(end?.offset ?? 0, start.offset),
    };
  }
  const length = (rendered.maps.get(start.id)?.length ?? 1) - 1;
  return {
    ...rest,
    paragraphId: start.id,
    start: start.offset,
    end: length,
    to: { paragraphId: end.id, offset: end.offset },
  };
}

/** A comment made on the rendered text: its place in the file's lines. */
export function anchorToRaw(
  rendered: Rendered,
  lines: readonly Line[],
  anchor: WriterAnchor,
): WriterAnchor {
  const at = (id: string, offset: number, end = false): Pos | null => {
    const map = rendered.maps.get(id);
    if (!map) return null;
    const index = Math.min(offset, map.length - 1);
    // An end stands behind its last character, not before the next one (`**` may be between).
    const last = end && index > 0 ? map[index - 1] : undefined;
    return last ? { line: last.line, col: last.col + 1 } : (map[index] ?? null);
  };
  const start = at(anchor.paragraphId, anchor.start);
  const end = anchor.to
    ? at(anchor.to.paragraphId, anchor.to.offset, true)
    : at(anchor.paragraphId, anchor.end, anchor.end > anchor.start);
  if (!start) return anchor;
  const length = (id: string) => lines.find((line) => line.id === id)?.text.length ?? 0;
  const { to: _to, ...rest } = anchor;
  if (!end || end.line === start.line) {
    return {
      ...rest,
      paragraphId: start.line,
      start: start.col,
      end: Math.max(end?.col ?? start.col, start.col),
    };
  }
  return {
    ...rest,
    paragraphId: start.line,
    start: start.col,
    end: length(start.line),
    to: { paragraphId: end.line, offset: end.col },
  };
}
