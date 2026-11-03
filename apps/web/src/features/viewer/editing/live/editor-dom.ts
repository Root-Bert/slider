import type { LiveParagraph, LiveRun, LiveTextStyle } from '@slider/shared';
import { normalizeRuns, type TextPoint, type TextRange } from './model';

/*
 * The live editor's text in the DOM: read back into paragraphs after the browser changed it, and
 * places in it (the selection, a click) to and from points in those paragraphs.
 */

export const ZWSP = new RegExp(String.fromCharCode(0x200b), 'g');

export const readStyle = (node: HTMLElement): LiveTextStyle | null => {
  const raw = node.dataset.style;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LiveTextStyle;
  } catch {
    return null;
  }
};

const isBlock = (node: Node): node is HTMLElement =>
  node instanceof HTMLElement && ['P', 'DIV'].includes(node.tagName);

interface Parsed {
  paragraphs: LiveParagraph[];
  /** The browser changed the structure: draw the paragraphs anew. */
  dirty: boolean;
}

/** The editor's DOM read back into paragraphs, each on the look of the paragraph it came from. */
export function parse(root: HTMLElement, templates: readonly LiveParagraph[]): Parsed {
  const paragraphs: LiveParagraph[] = [];
  let dirty = false;
  const blocks: Node[][] = [];
  let loose: Node[] = [];
  for (const child of root.childNodes) {
    if (isBlock(child)) {
      if (loose.length > 0) blocks.push(loose);
      loose = [];
      blocks.push([child]);
    } else {
      loose.push(child);
      dirty = true;
    }
  }
  if (loose.length > 0) blocks.push(loose);
  let lastTemplate = 0;
  for (const nodes of blocks) {
    const block = nodes.length === 1 && isBlock(nodes[0]!) ? (nodes[0] as HTMLElement) : null;
    const index = block?.dataset.p !== undefined ? Number(block.dataset.p) : lastTemplate;
    if (block?.dataset.p === undefined) dirty = true;
    lastTemplate = index;
    const template = templates[Math.min(index, templates.length - 1)] as LiveParagraph;
    const runs: LiveRun[] = [];
    let style: LiveTextStyle = template.mark;
    let lastStyle: LiveTextStyle | null = null;
    let bullets = 0;
    let breaks = 0;
    const walk = (node: Node, current: LiveTextStyle, inRun: boolean) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent ?? '').replace(ZWSP, '');
        if (!text) return;
        if (!inRun) dirty = true;
        runs.push({ ...current, text });
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      if (node.dataset.liveBullet !== undefined) {
        bullets += 1;
        return;
      }
      if (node.tagName === 'BR') {
        if (node.dataset.sentinel === undefined) {
          runs.push({ ...current, text: '\n' });
          breaks += 1;
        }
        return;
      }
      if (isBlock(node)) dirty = true;
      const own = readStyle(node);
      if (own) lastStyle = own;
      for (const child of node.childNodes) walk(child, own ?? current, inRun || own !== null);
    };
    for (const node of nodes) walk(node, style, false);
    if (lastStyle) style = lastStyle;
    // The browser keeps an empty line open with a <br> of its own.
    const last = runs.at(-1);
    if (last?.text === '\n' && breaks > 0) {
      runs.pop();
      if (runs.length > 0) dirty = true;
    }
    if (bullets !== (template.bullet ? 1 : 0)) dirty = true;
    const normalized = normalizeRuns(runs);
    paragraphs.push({
      ...template,
      align: (block?.dataset.align as LiveParagraph['align'] | undefined) ?? template.align,
      runs: normalized,
      mark: normalized.at(-1) ?? style,
    });
  }
  if (paragraphs.length === 0) {
    const template = templates[0] as LiveParagraph;
    paragraphs.push({ ...template, runs: [] });
    dirty = true;
  }
  return { paragraphs, dirty };
}

/** Characters before a DOM position inside a paragraph (line breaks count one). */
function charsBefore(paragraph: Node, target: Node, offset: number): number {
  let count = 0;
  let found = false;
  const visit = (node: Node) => {
    if (found) return;
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) {
        count += (node.textContent ?? '').slice(0, offset).replace(ZWSP, '').length;
      } else {
        for (const child of [...node.childNodes].slice(0, offset)) visit(child);
      }
      found = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      count += (node.textContent ?? '').replace(ZWSP, '').length;
      return;
    }
    if (!(node instanceof HTMLElement) || node.dataset.liveBullet !== undefined) return;
    if (node.tagName === 'BR') {
      if (node.dataset.sentinel === undefined) count += 1;
      return;
    }
    for (const child of node.childNodes) visit(child);
  };
  for (const child of paragraph.childNodes) visit(child);
  return count;
}

export function pointOf(root: HTMLElement, node: Node, offset: number): TextPoint | null {
  if (!root.contains(node)) return null;
  if (node === root) {
    const paragraph = Math.min(offset, Math.max(0, root.childNodes.length - 1));
    return { paragraph, offset: 0 };
  }
  let block: Node | null = node;
  while (block && block.parentNode !== root) block = block.parentNode;
  if (!block) return null;
  const paragraph = [...root.childNodes].indexOf(block as ChildNode);
  return { paragraph, offset: charsBefore(block, node, offset) };
}

export function rangeOf(root: HTMLElement): TextRange | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const start = pointOf(root, range.startContainer, range.startOffset);
  const end = pointOf(root, range.endContainer, range.endOffset);
  return start && end ? { start, end } : null;
}

/**
 * The selection as it was made – from where it began (`start`, its anchor) to where it is moved
 * (`end`, its head), backwards too – for the caret the others see and the shared text keeps.
 */
export function directedRangeOf(root: HTMLElement): TextRange | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.anchorNode || !selection.focusNode) return null;
  const start = pointOf(root, selection.anchorNode, selection.anchorOffset);
  const end = pointOf(root, selection.focusNode, selection.focusOffset);
  return start && end ? { start, end } : null;
}

/** A range from its first point to its last (formatting works on those). */
export function ordered(range: TextRange): TextRange {
  const { start, end } = range;
  const backwards =
    end.paragraph < start.paragraph ||
    (end.paragraph === start.paragraph && end.offset < start.offset);
  return backwards ? { start: end, end: start } : range;
}

/** The DOM position of a text point in the drawn paragraphs. */
export function domPoint(root: HTMLElement, point: TextPoint): [Node, number] {
  const block = root.children[Math.min(point.paragraph, root.children.length - 1)];
  if (!block) return [root, 0];
  let left = point.offset;
  let result: [Node, number] | null = null;
  const visit = (node: Node) => {
    if (result) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const length = (node.textContent ?? '').length;
      if (left <= length) result = [node, left];
      else left -= length;
      return;
    }
    if (!(node instanceof HTMLElement) || node.dataset.liveBullet !== undefined) return;
    if (node.tagName === 'BR') {
      if (node.dataset.sentinel !== undefined) return;
      if (left === 0) {
        result = [node.parentNode as Node, [...(node.parentNode as Node).childNodes].indexOf(node)];
        return;
      }
      left -= 1;
      return;
    }
    for (const child of node.childNodes) visit(child);
  };
  for (const child of block.childNodes) visit(child);
  if (result) return result;
  // Past the end or an empty line: into its last run.
  const runs = block.querySelectorAll('[data-style]');
  const last = runs[runs.length - 1];
  return last
    ? [
        last,
        last.childNodes.length > 0 && last.lastChild?.nodeName === 'BR'
          ? 0
          : last.childNodes.length,
      ]
    : [block, block.childNodes.length];
}

export function select(root: HTMLElement, range: TextRange): void {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  const [startNode, startOffset] = domPoint(root, range.start);
  const [endNode, endOffset] = domPoint(root, range.end);
  try {
    selection.setBaseAndExtent(startNode, startOffset, endNode, endOffset);
  } catch {
    // A position the DOM no longer has: the caret stays where the browser put it.
  }
}

/** Puts the caret at a point of the screen, if that is in the text. */
export function caretAt(root: HTMLElement, point: { x: number; y: number }): boolean {
  // On the text: where it was clicked – the browser finds the character also in a box turned or
  // tilted in depth, which lines measured on screen would not (they lie slanted, overlapping).
  if (onText(root, point) && caretAtPoint(root, point)) return true;
  // Beside or below the text (the box is larger): on the nearest line's middle, like PowerPoint –
  // at a line's edge the browser would put the caret at the very end.
  const lines = linesOf(root);
  const distance = (line: DOMRect) =>
    point.y < line.top ? line.top - point.y : point.y > line.bottom ? point.y - line.bottom : 0;
  // Lines set close overlap: then the one whose middle is nearer.
  const off = (line: DOMRect) => Math.abs(line.top + line.height / 2 - point.y);
  const nearest = lines.reduce<Line | null>((best, line) => {
    if (!best) return line;
    const d = distance(line.rect) - distance(best.rect);
    return d < 0 || (d === 0 && off(line.rect) < off(best.rect)) ? line : best;
  }, null);
  if (!nearest) return caretAtPoint(root, point);
  if (nearest.empty) {
    // An empty line has no text to hit: the caret goes into its run.
    root.ownerDocument.getSelection()?.collapse(nearest.empty, 0);
    return true;
  }
  const box = root.getBoundingClientRect();
  return caretAtPoint(root, {
    x: Math.min(Math.max(point.x, box.left + 1), box.right - 1),
    y: nearest.rect.top + nearest.rect.height / 2,
  });
}

type Line = { rect: DOMRect; empty: HTMLElement | null };

/**
 * The text's lines on screen: one box per line of each text node (a range over the whole text
 * would also give each paragraph's box, as high as all its lines), and each empty line's run.
 */
function linesOf(root: HTMLElement): Line[] {
  const lines: Line[] = [];
  const range = root.ownerDocument.createRange();
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('[data-live-bullet]')) continue;
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width > 0) lines.push({ rect, empty: null });
    }
  }
  for (const run of root.querySelectorAll<HTMLElement>('[data-style]')) {
    if (run.textContent) continue;
    const rect = run.getBoundingClientRect();
    if (rect.height > 0) lines.push({ rect, empty: run });
  }
  return lines;
}

/** The point is on a character of the text (not beside it, in the box or a paragraph's padding). */
export function onText(root: HTMLElement, point: { x: number; y: number }): boolean {
  const hit = root.ownerDocument.elementFromPoint(point.x, point.y);
  if (!hit || !root.contains(hit)) return false;
  for (const child of hit.childNodes) {
    if (child.nodeType !== Node.TEXT_NODE) continue;
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(child);
    for (const rect of range.getClientRects()) {
      if (
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom
      ) {
        return true;
      }
    }
  }
  return false;
}

export function caretAtPoint(root: HTMLElement, point: { x: number; y: number }): boolean {
  const doc = root.ownerDocument;
  let node: Node | null = null;
  let offset = 0;
  if (typeof doc.caretPositionFromPoint === 'function') {
    const position = doc.caretPositionFromPoint(point.x, point.y);
    node = position?.offsetNode ?? null;
    offset = position?.offset ?? 0;
  } else if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(point.x, point.y);
    node = range?.startContainer ?? null;
    offset = range?.startOffset ?? 0;
  }
  const selection = doc.getSelection();
  // In a text only: a hit on the box or a paragraph's padding is beside the text.
  if (!node || node.nodeType !== Node.TEXT_NODE || !selection || !root.contains(node)) return false;
  selection.collapse(node, offset);
  return true;
}
