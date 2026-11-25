/*
 * The formatting a Sender message is written in – kept as its text (agents, search, drafts and
 * quotes read that), shown by `MessageText`, typed as it shows in `RichField`. Markdown as a chat
 * knows it: **fett**, _kursiv_ (or *kursiv*), <u>unterstrichen</u>, ~~durchgestrichen~~, `Code`,
 * [Text](https://…), and lines that start „- “ / „1. “ (lists), „# “ / „## “ (headings), „> “
 * (a quote) or stand between ``` lines (a code block). No marks across a line, none inside a word.
 */

/** One line as read: the block it belongs to and its words (without the line's mark). */
export type MarkupLine =
  | { kind: 'text'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'number'; number: number; text: string }
  | { kind: 'heading'; level: 1 | 2; text: string }
  | { kind: 'quote'; text: string }
  /** A line of a ``` block, as written – `edge` its first and last (the ``` lines). */
  | { kind: 'code'; text: string; edge?: 'open' | 'close' };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(\S.*?)\s*$/;
const QUOTE = /^\s{0,3}>(?:\s(.*))?$/;

/** The text line by line, each with the block it belongs to. */
export function markupLines(text: string): MarkupLine[] {
  // Lines ended Windows' way (an app's message) read as the same lines.
  const lines = text.split(/\r?\n/);
  const out: MarkupLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trimStart().startsWith('```')) {
      const end = lines.findIndex((each, at) => at > i && each.trim().startsWith('```'));
      if (end !== -1) {
        out.push({ kind: 'code', text: line, edge: 'open' });
        for (const inner of lines.slice(i + 1, end)) out.push({ kind: 'code', text: inner });
        out.push({ kind: 'code', text: lines[end] ?? '', edge: 'close' });
        i = end;
        continue;
      }
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      out.push({ kind: 'bullet', text: bullet[1] ?? '' });
      continue;
    }
    const numbered = NUMBERED.exec(line);
    if (numbered) {
      out.push({ kind: 'number', number: Number(numbered[1]), text: numbered[2] ?? '' });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      out.push({ kind: 'heading', level: heading[1]!.length === 1 ? 1 : 2, text: heading[2]! });
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      out.push({ kind: 'quote', text: quote[1] ?? '' });
      continue;
    }
    out.push({ kind: 'text', text: line });
  }
  return out;
}

/** A run of words as read: plain, code, or marked words around more runs. */
export type MarkupRun =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'bold' | 'italic' | 'strike' | 'underline'; runs: MarkupRun[] }
  | { kind: 'link'; url: string; runs: MarkupRun[] };

/**
 * The inline marks, tried left to right: `Code` | [Text](url) | **fett** | ~~durch~~ |
 * <u>unter</u> | _kursiv_ | *kursiv* – `_` not inside a word („snake_case“ stays), `*` there too
 * („wo*rt*e“, as the field writes a word formatted in part). A link's address may hold a pair
 * of brackets (Wikipedia's „Foo_(bar)“). A web address standing in the words is taken whole
 * first: no `_`/`*` in it is read as a mark.
 */
const INLINE =
  /`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/(?:\([^\s()]*\)|[^\s)])+)\)|\*\*([^*\n]+?)\*\*|~~([^~\n]+?)~~|<u>([^\n]+?)<\/u>|(?<![\p{L}\p{N}_])_([^_\n]+?)_(?![\p{L}\p{N}_])|(?<!\*)\*([^*\s](?:[^*\n]*?[^*\s])?)\*(?!\*)|(?<![\p{L}\p{N}])((?:https?:\/\/|www\.)[^\s<]+)/gu;

/** A line's words as runs: its marks read, nested marks too. */
export function markupRuns(text: string): MarkupRun[] {
  const runs: MarkupRun[] = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index;
    const [, code, label, url, bold, strike, under, em, star, address] = match;
    // A web address: words as they are, read with those around it.
    if (address !== undefined) continue;
    if (index > at) runs.push({ kind: 'text', text: text.slice(at, index) });
    if (code !== undefined) runs.push({ kind: 'code', text: code });
    else if (url !== undefined) runs.push({ kind: 'link', url, runs: markupRuns(label ?? '') });
    else if (bold !== undefined) runs.push({ kind: 'bold', runs: markupRuns(bold) });
    else if (strike !== undefined) runs.push({ kind: 'strike', runs: markupRuns(strike) });
    else if (under !== undefined) runs.push({ kind: 'underline', runs: markupRuns(under) });
    else runs.push({ kind: 'italic', runs: markupRuns(em ?? star ?? '') });
    at = index + match[0].length;
  }
  if (at < text.length) runs.push({ kind: 'text', text: text.slice(at) });
  return runs;
}

/** The marks a run of text wears, in the order they are written around it (outermost last). */
export interface MarkupFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
}

/**
 * One piece of text wearing its marks, written as the text keeps it. `around`: the characters
 * beside it – italic inside a word, or before an @-name (`_` would hide it), is written `*…*`.
 */
export function markText(
  text: string,
  format: MarkupFormat,
  around: { before?: string; after?: string } = {},
): string {
  if (!text) return '';
  // Code holds its words as they are – no marks around or inside it.
  if (format.code && !text.includes('`') && !text.includes('\n')) return `\`${text}\``;
  // Spaces at the edges stay outside the marks, where they read again.
  const [, lead = '', core = '', trail = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? [];
  if (!core || core.includes('\n')) return text;
  let out = core;
  if (format.underline) out = `<u>${out}</u>`;
  if (format.strike) out = `~~${out}~~`;
  if (format.italic) {
    const letter = /[\p{L}\p{N}]/u;
    const star =
      !format.bold &&
      ((!lead && letter.test(around.before ?? '')) ||
        (!trail && letter.test(around.after ?? '')) ||
        core.startsWith('@') ||
        // A word with `_` in it: `_snake_case_` would read as the word without italic.
        core.includes('_'));
    out = star ? `*${out}*` : `_${out}_`;
  }
  if (format.bold) out = `**${out}**`;
  return lead + out + trail;
}

/**
 * The text as it is sent: no spaces around it, no list point or quote left empty at its end –
 * nor one standing alone (an empty point is not a „-“ sent).
 */
export function markupTrim(text: string): string {
  return text.replace(/(?:(?:^|\n)[ \t]*(?:(?:[-*•]|\d{1,9}[.)])[ \t]+|>[ \t]*)?)+$/, '').trim();
}

/** A message's words without its marks: a preview, a notification, a quote above the field. */
export function markupPlain(text: string): string {
  const words = (runs: MarkupRun[]): string =>
    runs.map((run) => ('runs' in run ? words(run.runs) : run.text)).join('');
  return markupLines(text)
    .filter((line) => line.kind !== 'code' || !line.edge)
    .map((line) => (line.kind === 'code' ? line.text : words(markupRuns(line.text))))
    .join('\n');
}

/** How the formatting looks – the same in a message and in the field it is typed in. */
export const MARKUP_LOOK = {
  code: 'rounded-mark bg-surface-2 px-1 font-mono text-[0.9em]',
  codeBlock:
    'my-1 overflow-x-auto rounded-control bg-surface-2 px-2.5 py-2 font-mono text-[0.9em] whitespace-pre',
  h1: 'text-[1.3em] leading-tight font-semibold',
  h2: 'text-[1.1em] font-semibold',
  quote: 'border-l-2 border-hairline-strong pl-2 text-fg-muted',
  ul: 'my-0.5 list-disc pl-5',
  ol: 'my-0.5 list-decimal pl-5',
  link: 'text-info underline decoration-info/40 underline-offset-2 hover:decoration-info',
};
