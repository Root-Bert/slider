import { CodeNode } from '@lexical/code-core';
import { LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import {
  CHECK_LIST,
  TRANSFORMERS,
  type ElementTransformer,
  type TextMatchTransformer,
  type Transformer,
} from '@lexical/markdown';
import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
  HorizontalRuleNode,
} from '@lexical/react/LexicalHorizontalRuleNode';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import type { Klass, LexicalNode } from 'lexical';
import {
  $createDiagramEmbedNode,
  $createLiveBlockNode,
  $createPageLinkNode,
  $isCalloutNode,
  $isDiagramEmbedNode,
  $isLiveBlockNode,
  $isPageLinkNode,
  $isRawBlockNode,
  CalloutNode,
  DiagramEmbedNode,
  isLiveKind,
  LiveBlockNode,
  PageLinkNode,
  RawBlockNode,
  type PageLinkKind,
} from './nodes';

/** Every node a page holds. */
export const PAGE_NODES: Klass<LexicalNode>[] = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LinkNode,
  CodeNode,
  HorizontalRuleNode,
  PageLinkNode,
  LiveBlockNode,
  DiagramEmbedNode,
  RawBlockNode,
  CalloutNode,
];

/** `[[file:id|Name]]` – as the agents write a file into their answers (`cloud/lib/named.ts`). */
const PAGE_LINK =
  /\[\[(file|folder|area|presentation):([0-9a-f-]{36})\|([^\]\n}]+)\]\]/;

export const PAGE_LINK_TRANSFORMER: TextMatchTransformer = {
  type: 'text-match',
  dependencies: [PageLinkNode],
  export: (node) => ($isPageLinkNode(node) ? node.markdown() : null),
  importRegExp: PAGE_LINK,
  regExp: new RegExp(`${PAGE_LINK.source}$`),
  trigger: ']',
  replace: (textNode, match) => {
    textNode.replace(
      $createPageLinkNode(match[1] as PageLinkKind, match[2]!, match[3]!.trim()),
    );
  },
};

const RULE_TRANSFORMER: ElementTransformer = {
  type: 'element',
  dependencies: [HorizontalRuleNode],
  export: (node) => ($isHorizontalRuleNode(node) ? '---' : null),
  regExp: /^(---|\*\*\*|___)\s?$/,
  replace: (parentNode, _children, _match, isImport) => {
    const rule = $createHorizontalRuleNode();
    if (isImport) {
      parentNode.replace(rule);
      return;
    }
    if (parentNode.getNextSibling() != null) parentNode.replace(rule);
    else parentNode.insertBefore(rule);
    rule.selectNext();
  },
};

const LIVE_TRANSFORMER: ElementTransformer = {
  type: 'element',
  dependencies: [LiveBlockNode],
  export: (node) => ($isLiveBlockNode(node) ? node.markdown() : null),
  regExp: /^\{\{\s*([a-zäöü]+)\s*\}\}\s?$/,
  replace: (parentNode, _children, match) => {
    const kind = match[1] ?? '';
    if (!isLiveKind(kind)) return false;
    parentNode.replace($createLiveBlockNode(kind));
  },
};

/** A diagram's link alone on its line: the diagram, drawn. Anywhere else it stays a link. */
const DIAGRAM_EMBED_TRANSFORMER: ElementTransformer = {
  type: 'element',
  dependencies: [DiagramEmbedNode],
  export: (node) => ($isDiagramEmbedNode(node) ? node.markdown() : null),
  regExp: /^\[\[file:([0-9a-f-]{36})\|([^\]\n}]+\.diagram)\]\]\s?$/,
  replace: (parentNode, _children, match) => {
    parentNode.replace($createDiagramEmbedNode(match[1]!, match[2]!));
  },
};

/** Never read from Markdown (`codec.ts` makes them), only written back as they stand. */
const RAW_TRANSFORMER: ElementTransformer = {
  type: 'element',
  dependencies: [RawBlockNode],
  export: (node) => ($isRawBlockNode(node) ? node.markdown() : null),
  regExp: /(?!)/,
  replace: () => false,
};

const CALLOUT_TRANSFORMER: ElementTransformer = {
  type: 'element',
  dependencies: [CalloutNode],
  export: (node, children) => {
    if (!$isCalloutNode(node)) return null;
    const body = children(node)
      .split('\n')
      .map((line) => (line ? `> ${line}` : '>'));
    return [`> [!${node.getTone()}]`, ...body].join('\n');
  },
  regExp: /(?!)/,
  replace: () => false,
};

/** What a page reads and writes: its own blocks first, then Lexical's. */
export const PAGE_TRANSFORMERS: Transformer[] = [
  RAW_TRANSFORMER,
  CALLOUT_TRANSFORMER,
  DIAGRAM_EMBED_TRANSFORMER,
  LIVE_TRANSFORMER,
  RULE_TRANSFORMER,
  CHECK_LIST,
  ...TRANSFORMERS,
  PAGE_LINK_TRANSFORMER,
];
