/*
 * Markdown as a sticker's rich text (`BoardItem.rich`, Lexical's serialised editor state): what an
 * AI writes – an answer about the material, a summary sent over MCP – shown and edited like a
 * note typed on the board. Only what a sticker knows: paragraphs, two sizes of heading, lists
 * (nested), bold, italic, struck through, links (http(s) only). Anything else is kept as its
 * text: code as it is, a quote without its `>`, a table's cells side by side.
 */

/** Lexical's format bits (`TextNode.format`). */
const BOLD = 1;
const ITALIC = 2;
const STRIKE = 4;

type Node = Record<string, unknown>;

const block = (type: string, children: Node[], extra: Node = {}): Node => ({
  type,
  version: 1,
  direction: null,
  format: '',
  indent: 0,
  ...extra,
  children,
});

const textNode = (text: string, format: number): Node => ({
  type: 'text',
  version: 1,
  text,
  format,
  detail: 0,
  mode: 'normal',
  style: '',
});

const lineBreak = (): Node => ({ type: 'linebreak', version: 1 });

const paragraph = (children: Node[]): Node =>
  block('paragraph', children, { textFormat: 0, textStyle: '' });

const linkNode = (url: string, children: Node[]): Node =>
  block('link', children, { url, rel: 'noreferrer', target: null, title: null });

/** Characters a URL written in running text does not end with. */
const URL_TAIL = /[.,;:!?'")\]]+$/;

type Make = (match: RegExpExecArray, format: number) => Node[];

/** Inline Markdown, tried in this order at each place. */
const INLINE: { pattern: RegExp; make: Make }[] = [
  // `code`: kept as it is.
  { pattern: /`([^`\n]+)`/y, make: (match, format) => [textNode(match[1]!, format)] },
  {
    // [text](url "title") and ![alt](url): a link (a picture only as its link).
    pattern: /!?\[([^\]\n]*)\]\(\s*(https?:\/\/[^\s)]+)(?:\s+"[^"\n]*")?\s*\)/y,
    make: (match, format) => [
      linkNode(
        match[2]!,
        inline(match[1] || match[2]!, format).filter((node) => node.type === 'text'),
      ),
    ],
  },
  {
    pattern: /\*\*\*(?=\S)([^\n]+?)(?<=\S)\*\*\*/y,
    make: (match, format) => inline(match[1]!, format | BOLD | ITALIC),
  },
  {
    pattern: /(\*\*|__)(?=\S)([^\n]+?)(?<=\S)\1/y,
    make: (match, format) => inline(match[2]!, format | BOLD),
  },
  {
    pattern: /~~(?=\S)([^\n]+?)(?<=\S)~~/y,
    make: (match, format) => inline(match[1]!, format | STRIKE),
  },
  {
    pattern: /\*(?=[^\s*])([^\n*]+?)(?<=[^\s*])\*/y,
    make: (match, format) => inline(match[1]!, format | ITALIC),
  },
  {
    // _italic_ only at words' edges: snake_case stays as it is.
    pattern: /(?<![\p{L}\p{N}])_(?=[^\s_])([^\n_]+?)(?<=[^\s_])_(?![\p{L}\p{N}])/uy,
    make: (match, format) => inline(match[1]!, format | ITALIC),
  },
  {
    // A bare address: a link to itself, without the punctuation after it.
    pattern: /https?:\/\/[^\s<>]+/y,
    make: (match, format) => {
      const url = match[0].replace(URL_TAIL, '');
      return [linkNode(url, [textNode(url, format)])];
    },
  },
];

/** Inline Markdown as text and link nodes; neighbours of one format merged. */
function inline(text: string, format = 0): Node[] {
  const out: Node[] = [];
  const push = (node: Node) => {
    const last = out.at(-1);
    if (node.type === 'text' && last?.type === 'text' && last.format === node.format) {
      last.text = `${last.text as string}${node.text as string}`;
    } else out.push(node);
  };
  let plain = '';
  let at = 0;
  while (at < text.length) {
    // A backslash keeps the next character as it is.
    if (text[at] === '\\' && /[\\`*_~[\]()#+\-.!>|]/.test(text[at + 1] ?? '')) {
      plain += text[at + 1];
      at += 2;
      continue;
    }
    let found: { match: RegExpExecArray; make: Make } | null = null;
    for (const { pattern, make } of INLINE) {
      pattern.lastIndex = at;
      const match = pattern.exec(text);
      if (match) {
        found = { match, make };
        break;
      }
    }
    if (!found) {
      plain += text[at];
      at += 1;
      continue;
    }
    if (plain) push(textNode(plain, format));
    plain = '';
    for (const node of found.make(found.match, format)) push(node);
    // A bare address's trailing punctuation stays text.
    const whole = found.match[0];
    at += /^https?:/.test(whole) ? whole.replace(URL_TAIL, '').length : whole.length;
  }
  if (plain) push(textNode(plain, format));
  return out;
}

/** A paragraph's lines: inline Markdown with line breaks between them. */
const lines = (texts: string[]): Node[] =>
  texts.flatMap((text, index) => [...(index > 0 ? [lineBreak()] : []), ...inline(text)]);

const LIST_ITEM = /^(\s*)([-*+•]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const FENCE = /^\s{0,3}(```|~~~)/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;

interface ListLevel {
  indent: number;
  ordered: boolean;
  node: Node;
}

const listNode = (ordered: boolean, start: number): Node =>
  block('list', [], {
    listType: ordered ? 'number' : 'bullet',
    start,
    tag: ordered ? 'ol' : 'ul',
  });

const childrenOf = (node: Node) => node.children as Node[];

/**
 * Markdown as a sticker's rich text. `spaced`: an empty paragraph between blocks, as typed on
 * the board (a sticker's paragraphs have no space of their own); without, the page showing it
 * spaces them.
 */
export function markdownToRich(markdown: string, { spaced = false } = {}): Record<string, unknown> {
  const blocks: Node[] = [];
  let para: string[] = [];
  /** The lists open, outermost first. */
  let levels: ListLevel[] = [];
  let fence: string | null = null;

  const flushPara = () => {
    if (para.length > 0) blocks.push(paragraph(lines(para)));
    para = [];
  };
  const flushLists = () => {
    if (levels[0]) blocks.push(levels[0].node);
    levels = [];
  };
  const addItem = (indent: number, ordered: boolean, start: number, text: string) => {
    while (levels.length > 0 && indent < levels.at(-1)!.indent) levels.pop();
    let level = levels.at(-1);
    if (level && indent === level.indent && level.ordered !== ordered) {
      // Another kind of list on the same level: a list of its own after it.
      if (levels.length === 1) flushLists();
      else levels.pop();
      level = levels.at(-1);
    }
    if (!level || indent > level.indent) {
      const node = listNode(ordered, start);
      if (level) {
        // A list inside the last item: Lexical holds it in an item of its own.
        const items = childrenOf(level.node);
        items.push(block('listitem', [node], { value: items.length + 1 }));
      }
      level = { indent, ordered, node };
      levels.push(level);
    }
    const items = childrenOf(level.node);
    items.push(block('listitem', inline(text), { value: items.length + 1 }));
  };

  for (const row of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (fence !== null) {
      if (row.trim().startsWith(fence)) fence = null;
      else blocks.push(paragraph(row ? [textNode(row, 0)] : []));
      continue;
    }
    const opened = FENCE.exec(row);
    if (opened) {
      flushPara();
      flushLists();
      fence = opened[1]!;
      continue;
    }
    if (row.trim() === '') {
      flushPara();
      continue;
    }
    const item = RULE.test(row) ? null : LIST_ITEM.exec(row);
    if (item) {
      flushPara();
      const ordered = /\d/.test(item[2]!);
      const indent = item[1]!.replace(/\t/g, '    ').length;
      addItem(indent, ordered, ordered ? parseInt(item[2]!, 10) : 1, item[3]!);
      continue;
    }
    // A line indented under a list item goes on with that item.
    if (levels.length > 0 && para.length === 0 && /^\s+\S/.test(row)) {
      const last = childrenOf(levels.at(-1)!.node).at(-1);
      if (last) {
        childrenOf(last).push(lineBreak(), ...inline(row.trim()));
        continue;
      }
    }
    flushLists();
    const heading = HEADING.exec(row);
    if (heading) {
      flushPara();
      blocks.push(
        block('heading', inline(heading[2]!), { tag: heading[1]!.length === 1 ? 'h1' : 'h2' }),
      );
      continue;
    }
    if (RULE.test(row)) {
      flushPara();
      continue;
    }
    if (TABLE_RULE.test(row) && row.includes('-')) continue;
    if (TABLE_ROW.test(row)) {
      flushPara();
      const cells = row
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim());
      blocks.push(paragraph(inline(cells.join(' · '))));
      continue;
    }
    para.push(row.replace(/^\s{0,3}>\s?/, '').trim());
  }
  flushPara();
  flushLists();

  const children = spaced
    ? blocks.flatMap((node, index) => (index > 0 ? [paragraph([]), node] : [node]))
    : blocks;
  return { root: block('root', children.length > 0 ? children : [paragraph([])]) };
}

/** The rich text's words without formatting, a line per paragraph or item. */
export function richPlainText(rich: Record<string, unknown>): string {
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.type === 'text') out.push(node.text as string);
    else if (node.type === 'linebreak') out.push('\n');
    for (const child of (node.children as Node[] | undefined) ?? []) walk(child);
    if (['paragraph', 'heading', 'listitem'].includes(node.type as string)) out.push('\n');
  };
  walk((rich as { root: Node }).root);
  return out
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
