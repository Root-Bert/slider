import type { WriterAnchor } from '@slider/shared';
import {
  $getNearestNodeFromDOMNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import type { PageCodec } from './codec';
import type { Line } from './units';

/*
 * Where one is on a page, in the file's terms – the line ids the server knows: the caret or the
 * words picked (what „hier“ means to the AI), the blocks in the window and under the pointer
 * (what one looked at while speaking). A block typed since the last send has no lines yet: it is
 * left out (sent first, it has them).
 */

/** The line of a block that holds a node's text, and where in that line the text begins. */
function placeIn(lines: readonly Line[], node: LexicalNode): { line: Line; base: number } | null {
  if (lines.length === 0) return null;
  const text = node.getTextContent();
  if (text) {
    for (const line of lines) {
      const at = line.text.indexOf(text);
      if (at >= 0) return { line, base: at };
    }
  }
  return { line: lines[0]!, base: 0 };
}

const top = (node: LexicalNode) => node.getTopLevelElement() ?? null;

/** The caret or the words picked, as a comment's place (inside a read of the editor). */
export function $anchorOf(codec: PageCodec): WriterAnchor | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const node = selection.anchor.getNode();
  const block = top(node);
  if (!block) return null;
  const place = placeIn(codec.linesOf(block.getKey()), node);
  if (!place) return null;
  const { line, base } = place;
  const length = line.text.length;
  const offset = $isTextNode(node) ? selection.anchor.offset : 0;
  const quote = selection.isCollapsed() ? '' : selection.getTextContent().slice(0, 600);
  const start = Math.min(length, base + offset);
  // Words picked backwards or past the line: those of this line from the caret on.
  const end = Math.min(length, start + quote.length);
  return { paragraphId: line.id, start, end, quote: line.text.slice(start, end) };
}

/** The first line of the block under a point on screen, if it is the page's. */
export function lineAt(editor: LexicalEditor, codec: PageCodec, x: number, y: number) {
  const root = editor.getRootElement();
  const under = document.elementFromPoint(x, y);
  if (!root || !under || !root.contains(under)) return null;
  return editor.read(() => {
    const node = $getNearestNodeFromDOMNode(under);
    const block = node && top(node);
    return block ? (codec.linesOf(block.getKey())[0]?.id ?? null) : null;
  });
}

/** The lines of the blocks in the window, top to bottom. */
export function linesInView(editor: LexicalEditor, codec: PageCodec): string[] {
  const root = editor.getRootElement();
  if (!root) return [];
  const ids: string[] = [];
  editor.read(() => {
    for (const element of root.children) {
      const rect = element.getBoundingClientRect();
      if (rect.height === 0 || rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const node = $getNearestNodeFromDOMNode(element);
      const block = node && top(node);
      if (!block) continue;
      for (const line of codec.linesOf(block.getKey())) {
        if (line.text.trim()) ids.push(line.id);
      }
    }
  });
  return ids;
}

/** A line brought into the window (the AI was asked to go there). */
export function showLine(editor: LexicalEditor, codec: PageCodec, lineId: string) {
  const key = codec.keyOf(lineId);
  const element = key ? editor.getElementByKey(key) : null;
  element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
