import type { NotesParagraph, NotesRun, TextList } from '@slider/shared';

/*
 * Speaker notes as the browser edits them (a `contenteditable` – bold as `<b>`, lists as
 * `<ul>`/`<ol>`) and back: only what notes are formatted with, anything else pasted or typed in
 * leaves its text.
 */

type Look = Omit<NotesRun, 'text'>;

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One run as markup, its looks nested tags. */
function runHtml(run: NotesRun): string {
  let html = escape(run.text).replace(/\n/g, '<br>');
  if (run.strike) html = `<s>${html}</s>`;
  if (run.underline) html = `<u>${html}</u>`;
  if (run.italic) html = `<i>${html}</i>`;
  if (run.bold) html = `<b>${html}</b>`;
  return html;
}

const content = (paragraph: NotesParagraph) =>
  paragraph.runs.some((run) => run.text) ? paragraph.runs.map(runHtml).join('') : '<br>';

/** The notes as markup for the editor: a `<div>` per paragraph, lists nested by level. */
export function notesToHtml(paragraphs: readonly NotesParagraph[]): string {
  let html = '';
  /** The lists open now, outermost first. */
  const open: TextList['kind'][] = [];
  const close = (depth: number) => {
    while (open.length > depth) html += `</li></${open.pop() === 'bullet' ? 'ul' : 'ol'}>`;
  };
  for (const paragraph of paragraphs) {
    const list = paragraph.list;
    if (!list) {
      close(0);
      html += `<div>${content(paragraph)}</div>`;
      continue;
    }
    // Shallower, or another kind at its level: the deeper lists end there.
    close(list.level);
    if (open.length === list.level && open[list.level - 1] !== list.kind) close(list.level - 1);
    if (open.length === list.level) html += '</li>';
    while (open.length < list.level) {
      const kind = open.length === list.level - 1 ? list.kind : 'bullet';
      html += kind === 'bullet' ? '<ul>' : '<ol>';
      open.push(kind);
      if (open.length < list.level) html += '<li>';
    }
    html += `<li>${content(paragraph)}`;
  }
  close(0);
  return html;
}

const BLOCKS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']);

/** What an element adds to the looks of the text in it. */
function lookOf(element: HTMLElement): Look {
  const look: Look = {};
  const tag = element.tagName;
  if (tag === 'B' || tag === 'STRONG') look.bold = true;
  if (tag === 'I' || tag === 'EM') look.italic = true;
  if (tag === 'U') look.underline = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') look.strike = true;
  // Safari writes some of them as styles.
  const style = element.style;
  const weight = style.fontWeight;
  if (weight) look.bold = weight === 'bold' || Number(weight) >= 600;
  if (style.fontStyle) look.italic = style.fontStyle === 'italic';
  const decoration = `${style.textDecoration} ${style.textDecorationLine}`;
  if (decoration.includes('underline')) look.underline = true;
  if (decoration.includes('line-through')) look.strike = true;
  return look;
}

/** The editor's markup read back as notes; empty paragraphs at the end left out. */
export function notesFromDom(root: HTMLElement): NotesParagraph[] {
  const out: NotesParagraph[] = [];
  let current: NotesParagraph | null = null;
  const start = (list: TextList | null) => {
    current = list ? { runs: [], list } : { runs: [] };
    out.push(current);
    return current;
  };
  const add = (text: string, look: Look, list: TextList | null) => {
    if (!text) return;
    const paragraph: NotesParagraph = current ?? start(list);
    const looks: Look = {
      ...(look.bold && { bold: true }),
      ...(look.italic && { italic: true }),
      ...(look.underline && { underline: true }),
      ...(look.strike && { strike: true }),
    };
    const last = paragraph.runs.at(-1);
    const same =
      last &&
      !!last.bold === !!looks.bold &&
      !!last.italic === !!looks.italic &&
      !!last.underline === !!looks.underline &&
      !!last.strike === !!looks.strike;
    if (last && same) last.text += text;
    else paragraph.runs.push({ text, ...looks });
  };
  const walk = (node: Node, look: Look, list: TextList | null) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        // The editor shows the text as typed (`white-space: pre-wrap`); a line break in it is
        // none the browser made.
        add((child.textContent ?? '').replace(/\n/g, ''), look, list);
        continue;
      }
      if (!(child instanceof HTMLElement)) continue;
      const tag = child.tagName;
      if (tag === 'BR') {
        // Ends its line – an empty line is an empty paragraph.
        if (!current) start(list);
        current = null;
      } else if (tag === 'UL' || tag === 'OL') {
        current = null;
        const level = Math.min(9, (list?.level ?? 0) + 1);
        walk(child, look, { kind: tag === 'UL' ? 'bullet' : 'number', level });
        current = null;
      } else if (BLOCKS.has(tag)) {
        current = null;
        const made = start(list);
        walk(child, { ...look, ...lookOf(child) }, list);
        current = null;
        // Only a wrapper round a list or other blocks (Chrome's `<div><ul>…`): no line of its own.
        const wraps = [...child.children].some(
          (inner) => inner.tagName === 'UL' || inner.tagName === 'OL' || BLOCKS.has(inner.tagName),
        );
        if (wraps && made.runs.length === 0) out.splice(out.indexOf(made), 1);
      } else walk(child, { ...look, ...lookOf(child) }, list);
    }
  };
  walk(root, {}, null);
  // A list item holding only a nested list is no paragraph of its own.
  const kept = out.filter(
    (paragraph, index) =>
      !(
        paragraph.list &&
        paragraph.runs.length === 0 &&
        (out[index + 1]?.list?.level ?? 0) > paragraph.list.level
      ),
  );
  while (
    kept.length > 0 &&
    !kept.at(-1)!.list &&
    kept.at(-1)!.runs.every((run) => !run.text.trim())
  )
    kept.pop();
  return kept;
}

/** Plain notes (a paragraph per line) as paragraphs. */
export const notesFromText = (text: string): NotesParagraph[] =>
  text ? text.split('\n').map((line) => ({ runs: line ? [{ text: line }] : [] })) : [];
