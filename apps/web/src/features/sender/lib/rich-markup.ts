import { $createLinkNode, $isLinkNode, LinkNode } from '@lexical/link';
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  ListItemNode,
  ListNode,
} from '@lexical/list';
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
  HeadingNode,
  QuoteNode,
} from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
} from 'lexical';
import { markText, markupLines, markupRuns, type MarkupRun } from './markup';

/*
 * A Sender message's text (`markup.ts`) as the editor holds it and back: a paragraph per line,
 * headings, quotes and lists as such, marks as the text's formats, [Text](url) as a link. A code
 * block's lines stay as they are written. Written back, the same text comes out as went in.
 */

/** The nodes `RichField` knows. */
export const RICH_MARKUP_NODES = [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode];

/** Lexical's format bits. */
const BOLD = 1;
const ITALIC = 2;
const STRIKE = 4;
const UNDERLINE = 8;
const CODE = 16;

const BITS = { bold: BOLD, italic: ITALIC, strike: STRIKE, underline: UNDERLINE } as const;

/** The formats written as marks. */
const MARKS = ['bold', 'italic', 'underline', 'strikethrough', 'code'] as const;

function $runs(runs: MarkupRun[], format = 0): LexicalNode[] {
  return runs.flatMap((run): LexicalNode[] => {
    switch (run.kind) {
      case 'text':
        return [$createTextNode(run.text).setFormat(format)];
      case 'code':
        return [$createTextNode(run.text).setFormat(format | CODE)];
      case 'link':
        return [$createLinkNode(run.url).append(...$runs(run.runs, format))];
      default:
        return $runs(run.runs, format | BITS[run.kind]);
    }
  });
}

const $words = (text: string) => $runs(markupRuns(text));

/** The text as the editor's blocks: a paragraph per line, lists, headings, quotes. */
function $blocks(text: string): LexicalNode[] {
  const blocks: LexicalNode[] = [];
  let list: ListNode | null = null;
  for (const line of markupLines(text)) {
    if (line.kind === 'bullet' || line.kind === 'number') {
      const type = line.kind === 'number' ? 'number' : 'bullet';
      if (list?.getListType() !== type) {
        list = $createListNode(type, line.kind === 'number' ? line.number : 1);
        blocks.push(list);
      }
      list.append($createListItemNode().append(...$words(line.text)));
      continue;
    }
    list = null;
    if (line.kind === 'heading')
      blocks.push($createHeadingNode(line.level === 1 ? 'h1' : 'h2').append(...$words(line.text)));
    else if (line.kind === 'quote') blocks.push($createQuoteNode().append(...$words(line.text)));
    else if (line.kind === 'code')
      blocks.push(
        $createParagraphNode().append(...(line.text ? [$createTextNode(line.text)] : [])),
      );
    else blocks.push($createParagraphNode().append(...$words(line.text)));
  }
  return blocks;
}

/** The text put into the editor, in place of what it held. */
export function $setMarkup(text: string): void {
  const root = $getRoot();
  root.clear();
  const blocks = $blocks(text);
  root.append(...(blocks.length > 0 ? blocks : [$createParagraphNode()]));
}

/** The text as nodes to put in at the caret (pasted): one plain line as words only. */
export function $markupNodes(text: string): LexicalNode[] {
  const lines = markupLines(text);
  if (lines.length === 1 && lines[0]?.kind === 'text') return $words(lines[0].text);
  return $blocks(text);
}

/** An element's words with their marks; line breaks as `\n`. */
function inlineOf(element: ElementNode): string {
  const children = element.getChildren();
  // The letter beside a piece, which decides how its italic is written – none where marks of
  // its own stand there (`**a**_b_`, not `**a***b*`).
  const edge = (node: LexicalNode | undefined, end: boolean) => {
    if ($isTextNode(node) && MARKS.some((mark) => node.hasFormat(mark))) return '';
    const text = node?.getTextContent() ?? '';
    return end ? text.slice(-1) : text.slice(0, 1);
  };
  return children
    .map((child, index) => {
      if ($isLineBreakNode(child)) return '\n';
      if ($isLinkNode(child)) {
        const label = inlineOf(child);
        // „Https://“ (a phone's capital) written as the grammar reads it.
        const url = child.getURL().replace(/^https?:/i, (scheme) => scheme.toLowerCase());
        if (!/^https?:\/\/\S+$/i.test(url) || /[\]\n]/.test(label)) return label;
        return label === url ? url : `[${label}](${url})`;
      }
      if ($isTextNode(child))
        return markText(
          child.getTextContent(),
          {
            bold: child.hasFormat('bold'),
            italic: child.hasFormat('italic'),
            underline: child.hasFormat('underline'),
            strike: child.hasFormat('strikethrough'),
            code: child.hasFormat('code'),
          },
          { before: edge(children[index - 1], true), after: edge(children[index + 1], false) },
        );
      if ($isElementNode(child)) return inlineOf(child);
      return child.getTextContent();
    })
    .join('');
}

/** What the editor holds, as the message's text. */
export function $getMarkup(): string {
  const out: string[] = [];
  for (const node of $getRoot().getChildren()) {
    if ($isListNode(node)) {
      let number = node.getStart();
      const ordered = node.getListType() === 'number';
      for (const item of node.getChildren()) {
        if (!$isListItemNode(item)) continue;
        const words = inlineOf(item).replace(/\n/g, ' ');
        out.push(ordered ? `${number++}. ${words}` : `- ${words}`);
      }
    } else if ($isHeadingNode(node)) {
      const words = inlineOf(node).replace(/\n/g, ' ');
      // An empty heading is an empty line.
      out.push(words.trim() ? `${node.getTag() === 'h1' ? '#' : '##'} ${words}` : '');
    } else if ($isQuoteNode(node)) {
      out.push(
        ...inlineOf(node)
          .split('\n')
          .map((line) => (line ? `> ${line}` : '>')),
      );
    } else if ($isElementNode(node)) out.push(inlineOf(node));
    else out.push(node.getTextContent());
  }
  return out.join('\n');
}
