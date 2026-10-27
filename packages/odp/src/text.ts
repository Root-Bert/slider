import {
  attr,
  childrenOf,
  cloneNode,
  element,
  insertAfter,
  removeChild,
  tagOf,
  textNode,
  textOf,
  type XmlNode,
} from './xml';

/*
 * Text of ODF shapes: paragraphs (`text:p`, `text:h`), also inside lists, read as plain strings
 * and written back keeping each paragraph's style and the style of its first run.
 */

const PARAGRAPH = new Set(['text:p', 'text:h']);
const LIST = 'text:list';
const LIST_ITEMS = new Set(['text:list-item', 'text:list-header']);
/** Inline elements whose text is not part of the paragraph's text. */
const NO_TEXT = new Set([
  'text:note',
  'office:annotation',
  'office:annotation-end',
  'text:ruby-text',
]);

/** Plain text of a paragraph: `text:s` as spaces, tabs as `\t`, line breaks as `\n`. */
export function paragraphText(paragraph: XmlNode): string {
  let out = '';
  for (const child of childrenOf(paragraph)) {
    const text = textOf(child);
    if (text !== null) {
      out += text;
      continue;
    }
    const tag = tagOf(child);
    if (!tag || NO_TEXT.has(tag) || !tag.startsWith('text:')) continue;
    if (tag === 'text:s') out += ' '.repeat(Math.max(1, Number(attr(child, 'text:c') ?? 1) || 1));
    else if (tag === 'text:tab') out += '\t';
    else if (tag === 'text:line-break') out += '\n';
    else out += paragraphText(child);
  }
  return out;
}

/** A paragraph and where it sits, so it can be cloned or removed with its list item. */
export interface ParagraphSlot {
  paragraph: XmlNode;
  parent: XmlNode;
  /** Set when the paragraph is inside a list: its item and the list holding that item. */
  item?: { node: XmlNode; list: XmlNode };
}

export function paragraphSlots(container: XmlNode): ParagraphSlot[] {
  const slots: ParagraphSlot[] = [];
  const walk = (node: XmlNode, item?: ParagraphSlot['item']) => {
    for (const child of childrenOf(node)) {
      const tag = tagOf(child);
      if (!tag) continue;
      if (PARAGRAPH.has(tag)) slots.push({ paragraph: child, parent: node, item });
      else if (tag === LIST) {
        for (const entry of childrenOf(child)) {
          const entryTag = tagOf(entry);
          if (entryTag && LIST_ITEMS.has(entryTag)) walk(entry, { node: entry, list: child });
        }
      }
    }
  };
  walk(container);
  return slots;
}

export const readParagraphs = (container: XmlNode): string[] =>
  paragraphSlots(container).map((slot) => paragraphText(slot.paragraph));

/** The first `text:span` that carries text – its style is kept for the new text. */
function firstRun(paragraph: XmlNode): XmlNode | undefined {
  for (const child of childrenOf(paragraph)) {
    if (tagOf(child) === 'text:span' && paragraphText(child).trim() !== '') return child;
  }
  return childrenOf(paragraph).find((child) => tagOf(child) === 'text:span');
}

/** Inline nodes for plain text, with ODF's own markup for runs of spaces, tabs and line breaks. */
export function inlineNodes(text: string): XmlNode[] {
  const nodes: XmlNode[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((line, index) => {
    if (index > 0) nodes.push(element('text:line-break'));
    let plain = '';
    let i = 0;
    const flush = () => {
      if (plain) nodes.push(textNode(plain));
      plain = '';
    };
    while (i < line.length) {
      const char = line[i] as string;
      if (char === '\t') {
        flush();
        nodes.push(element('text:tab'));
        i += 1;
      } else if (char === ' ') {
        let run = 0;
        while (line[i + run] === ' ') run += 1;
        // ODF collapses spaces: one plain space after text, the rest (or all, at the start) as text:s.
        const literal = plain !== '' || (i > 0 && line[i - 1] !== '\t') ? 1 : 0;
        if (literal) plain += ' ';
        flush();
        const extra = run - literal;
        if (extra > 0) nodes.push(element('text:s', extra > 1 ? { 'text:c': String(extra) } : {}));
        i += run;
      } else {
        plain += char;
        i += 1;
      }
    }
    flush();
  });
  return nodes;
}

function setParagraphText(paragraph: XmlNode, text: string): void {
  const tag = tagOf(paragraph);
  if (!tag) return;
  const run = firstRun(paragraph);
  const inline = inlineNodes(text);
  let children = inline;
  if (run && inline.length > 0) {
    const span: XmlNode = { 'text:span': inline };
    if (run[':@']) span[':@'] = { ...(run[':@'] as Record<string, string>) };
    children = [span];
  }
  paragraph[tag] = children;
}

function removeSlot(slot: ParagraphSlot): void {
  removeChild(slot.parent, slot.paragraph);
  if (slot.item && !childrenOf(slot.item.node).some((child) => tagOf(child) !== null)) {
    removeChild(slot.item.list, slot.item.node);
  }
}

/**
 * Rewrites the paragraphs of a container (a text box or a shape): `count` paragraphs, each
 * filled by `fill`. Paragraphs beyond the old ones are clones of the last one (list item
 * included); surplus ones go. `insertFirst` places the first paragraph when the container has none.
 */
export function rewriteParagraphs(
  container: XmlNode,
  count: number,
  fill: (paragraph: XmlNode, index: number, isNew: boolean) => void,
  insertFirst: (paragraph: XmlNode) => void,
): void {
  const wanted = Math.max(1, count);
  let slots = paragraphSlots(container);
  if (slots.length === 0) {
    insertFirst(element('text:p'));
    slots = paragraphSlots(container);
  }
  for (let index = 0; index < wanted; index += 1) {
    const slot = slots[index];
    if (slot) {
      fill(slot.paragraph, index, false);
      continue;
    }
    const last = slots[slots.length - 1] as ParagraphSlot;
    const paragraph = cloneNode(last.paragraph);
    fill(paragraph, index, true);
    if (last.item) {
      const item: XmlNode = { [tagOf(last.item.node) as string]: [paragraph] };
      if (last.item.node[':@'])
        item[':@'] = { ...(last.item.node[':@'] as Record<string, string>) };
      insertAfter(last.item.list, last.item.node, item);
      slots.push({ paragraph, parent: item, item: { node: item, list: last.item.list } });
    } else {
      insertAfter(last.parent, last.paragraph, paragraph);
      slots.push({ paragraph, parent: last.parent });
    }
  }
  for (const slot of slots.slice(wanted)) removeSlot(slot);
}

/**
 * Replaces the text of a container paragraph by paragraph, keeping each paragraph's style and
 * the style of its first run (see {@link rewriteParagraphs}).
 */
export function writeParagraphs(
  container: XmlNode,
  paragraphs: readonly string[],
  insertFirst: (paragraph: XmlNode) => void,
): void {
  rewriteParagraphs(
    container,
    paragraphs.length,
    (paragraph, index, isNew) => {
      const text = paragraphs[index] ?? '';
      if (isNew || paragraphText(paragraph) !== text) setParagraphText(paragraph, text);
    },
    insertFirst,
  );
}
