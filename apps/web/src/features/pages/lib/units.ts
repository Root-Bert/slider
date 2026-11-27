import { isFlowchart } from './diagram/parse';
import { isInkFence } from './ink';

/*
 * A page's Markdown file cut into its blocks, as written: a heading, a paragraph, a list, a quote,
 * a code block, a diagram (```mermaid, a flowchart), a drawing (```ink), a table, a line across, a live block
 * (`{{dateien}}`), the front matter – and what
 * the page does not know (HTML, a heading underlined, a reference) as a block of its own that is
 * shown and kept as it stands. Each block keeps its lines (with their ids) and the blank lines
 * after it, so a block nobody touched goes back into the file byte for byte (`codec.ts`).
 */

/** A line of the file as the server sends it: its id and its characters. */
export interface Line {
  id: string;
  text: string;
}

export type UnitKind =
  | 'front'
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'quote'
  | 'code'
  | 'diagram'
  | 'ink'
  | 'rule'
  | 'table'
  | 'live'
  | 'raw';

export interface Unit {
  kind: UnitKind;
  lines: Line[];
  /** The blank lines after it. */
  gap: Line[];
}

const blank = (text: string) => text.trim() === '';
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}#{1,6}(\s|$)/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(\s|$)/;
const QUOTE = /^\s{0,3}>/;
const HTML = /^\s{0,3}<(?:[a-zA-Z][\w-]*|!--|\/[a-zA-Z])/;
const REFERENCE = /^\s{0,3}\[[^\]]+\]:\s/;
const SETEXT = /^\s{0,3}(=+|-+)\s*$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
/** A live block alone on its line: `{{dateien}}`, `{{aufgaben}}` … */
export const LIVE_LINE = /^\{\{\s*([a-zäöü]+)\s*\}\}\s*$/;

/** Whether this line starts a block that ends the paragraph before it. */
function interrupts(lines: readonly Line[], at: number): boolean {
  const text = lines[at]!.text;
  return (
    FENCE.test(text) ||
    HEADING.test(text) ||
    RULE.test(text) ||
    QUOTE.test(text) ||
    HTML.test(text) ||
    LIVE_LINE.test(text) ||
    /^\s{0,3}([-*+]|1[.)])\s+\S/.test(text) ||
    isTableStart(lines, at)
  );
}

function isTableStart(lines: readonly Line[], at: number): boolean {
  const head = lines[at]?.text ?? '';
  const divider = lines[at + 1]?.text ?? '';
  return head.includes('|') && divider.includes('-') && TABLE_DIVIDER.test(divider);
}

/** A fenced block drawn as a diagram: ```mermaid, closed, with a flowchart in it. */
export function isDiagramFence(lines: readonly Line[]): boolean {
  const open = FENCE.exec(lines[0]?.text ?? '');
  if (!open || lines.length < 2) return false;
  if (lines[0]!.text.slice(open[0].length).trim().toLowerCase() !== 'mermaid') return false;
  const close = lines.at(-1)!.text.trim();
  if (!close.startsWith(open[1]!) || !/^[`~]+$/.test(close)) return false;
  return isFlowchart(lines.slice(1, -1).map((line) => line.text).join('\n'));
}

/** The file's lines as blocks; `lead`: blank lines before the first. */
export function splitUnits(lines: readonly Line[]): { lead: Line[]; units: Unit[] } {
  const lead: Line[] = [];
  const units: Unit[] = [];
  let at = 0;
  const push = (kind: UnitKind, end: number) => {
    units.push({ kind, lines: lines.slice(at, end), gap: [] });
    at = end;
  };

  // Front matter: `---` on the first line, closed by another within a few lines.
  if (lines[0]?.text === '---') {
    const close = lines.findIndex((line, index) => index > 0 && index < 60 && line.text === '---');
    if (close > 0) push('front', close + 1);
  }

  while (at < lines.length) {
    const text = lines[at]!.text;
    if (blank(text)) {
      (units.at(-1)?.gap ?? lead).push(lines[at]!);
      at += 1;
      continue;
    }
    const fence = FENCE.exec(text);
    if (fence) {
      const mark = fence[1]!;
      let end = at + 1;
      while (end < lines.length) {
        const close = lines[end]!.text.trim();
        if (close.startsWith(mark[0]!.repeat(mark.length)) && /^[`~]+$/.test(close)) {
          end += 1;
          break;
        }
        end += 1;
      }
      const block = lines.slice(at, end);
      push(
        isDiagramFence(block) ? 'diagram' : isInkFence(block.map((line) => line.text)) ? 'ink' : 'code',
        end,
      );
      continue;
    }
    if (HEADING.test(text)) {
      push('heading', at + 1);
      continue;
    }
    if (RULE.test(text)) {
      push('rule', at + 1);
      continue;
    }
    if (LIVE_LINE.test(text)) {
      push('live', at + 1);
      continue;
    }
    if (isTableStart(lines, at)) {
      let end = at + 2;
      while (end < lines.length && !blank(lines[end]!.text) && lines[end]!.text.includes('|')) {
        end += 1;
      }
      push('table', end);
      continue;
    }
    if (QUOTE.test(text)) {
      let end = at + 1;
      while (end < lines.length && QUOTE.test(lines[end]!.text)) end += 1;
      push('quote', end);
      continue;
    }
    if (HTML.test(text) || REFERENCE.test(text)) {
      let end = at + 1;
      while (end < lines.length && !blank(lines[end]!.text)) end += 1;
      push('raw', end);
      continue;
    }
    if (LIST.test(text)) {
      let end = at + 1;
      while (end < lines.length) {
        const line = lines[end]!.text;
        if (!blank(line)) {
          // An item, or a line of the one before (indented, or lazily going on).
          if (LIST.test(line) || /^\s+\S/.test(line)) {
            end += 1;
            continue;
          }
          if (interrupts(lines, end)) break;
          end += 1;
          continue;
        }
        // A blank line inside the list: only where another item or an indented line follows.
        let next = end;
        while (next < lines.length && blank(lines[next]!.text)) next += 1;
        if (next < lines.length && (LIST.test(lines[next]!.text) || /^\s{2,}\S/.test(lines[next]!.text))) {
          end = next;
          continue;
        }
        break;
      }
      push('list', end);
      continue;
    }
    // A paragraph: up to a blank line or a block that ends it.
    let end = at + 1;
    let underlined = false;
    while (end < lines.length && !blank(lines[end]!.text)) {
      if (SETEXT.test(lines[end]!.text)) {
        underlined = true;
        end += 1;
        break;
      }
      if (interrupts(lines, end)) break;
      end += 1;
    }
    // A heading underlined (`===`) Lexical does not read: kept as it stands.
    push(underlined ? 'raw' : 'paragraph', end);
  }
  return { lead, units };
}

/** The file's text as lines (without ids). */
export const textLines = (text: string): string[] => text.split(/\r?\n/);

/** What a block says, as one text. */
export const unitText = (unit: Pick<Unit, 'lines'>) => unit.lines.map((line) => line.text).join('\n');
