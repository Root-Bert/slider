import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type ElementNode,
  type LexicalEditor,
} from 'lexical';
import { $createCodeNode } from '@lexical/code-core';
import { $createListItemNode, type ListItemNode } from '@lexical/list';
import { describe, expect, it } from 'vitest';
import { $pageMarkdown, PageCodec } from './codec';
import { addStrokes, parseInk, parseStroke, removeLines, setHeight, strokeLines } from './ink';
import { $isCalloutNode, $isLiveBlockNode, $isPageLinkNode, $isRawBlockNode } from './nodes';
import { PAGE_NODES } from './transformers';
import type { Line } from './units';

const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const FILE = [
  '---',
  'icon: notes',
  '---',
  '',
  '# Willkommen',
  '',
  'Ein Absatz, der',
  'über zwei Zeilen geht.',
  '',
  '* eins',
  '* zwei',
  '  * tiefer',
  '',
  '- [ ] offen',
  '- [x] erledigt',
  '',
  '> zitiert',
  '',
  '> [!NOTE]',
  '> Ein **Hinweis**',
  '',
  '```ts',
  'const a = 1;',
  '```',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[Eins] -->|ja| B{Zwei?}',
  '```',
  '',
  '```mermaid',
  'sequenceDiagram',
  '  A->>B: Hallo',
  '```',
  '',
  '| A | B |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '<div align="center">roh</div>',
  '',
  'Unterstrichen',
  '=============',
  '',
  '{{unterseiten}}',
  '',
  `[[file:${ID}|Protokolle]]`,
  '',
  `[[file:${ID}|Ablauf.diagram]]`,
  '',
  '---',
  '',
  'Ende',
  '',
];

const lines = (texts: readonly string[]): Line[] =>
  texts.map((text, index) => ({ id: `L${index + 1}`, text }));

function opened(texts: readonly string[]): { editor: LexicalEditor; codec: PageCodec } {
  const editor = createEditor({
    nodes: PAGE_NODES,
    onError: (error) => {
      throw error;
    },
  });
  const codec = new PageCodec();
  editor.update(() => codec.$read(lines(texts)), { discrete: true });
  return { editor, codec };
}

const written = (editor: LexicalEditor, codec: PageCodec) =>
  editor.getEditorState().read(() => codec.$lines());

describe('page codec', () => {
  it('gives an untouched file back line for line, ids and all, and reads its blocks', () => {
    const { editor, codec } = opened(FILE);
    expect(written(editor, codec)).toEqual(lines(FILE));
    const kinds = editor.getEditorState().read(() =>
      $getRoot()
        .getChildren()
        .map((node) =>
          $isRawBlockNode(node)
            ? `raw:${node.__raw}`
            : $isCalloutNode(node)
              ? `callout:${node.__tone}`
              : $isLiveBlockNode(node)
                ? `live:${node.__live}`
                : node.getType(),
        ),
    );
    expect(kinds).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'quote',
      'callout:NOTE',
      'code',
      // A flowchart is drawn; any other Mermaid stays a code block.
      'raw:diagram',
      'code',
      'raw:table',
      'raw:raw',
      'raw:raw',
      'live:unterseiten',
      'paragraph',
      // A diagram's link alone on its line: the diagram, drawn.
      'page-diagram-embed',
      'horizontalrule',
      'paragraph',
    ]);
    // The page link is a link inside its paragraph, written as the agents write it.
    const link = editor
      .getEditorState()
      .read(() => $getRoot().getChildAtIndex(13)!.getTextContent());
    expect(link).toBe('Protokolle');
    expect(
      editor
        .getEditorState()
        .read(() =>
          $isPageLinkNode(
            ($getRoot().getChildAtIndex(13) as never as { getFirstChild(): never }).getFirstChild(),
          ),
        ),
    ).toBe(true);
    expect(codec.frontMatter.map((line) => line.text)).toEqual(['---', 'icon: notes', '---']);

    // Blocks with no blank line between them stay so: opening puts none in.
    const TIGHT = [
      '---',
      'a: 1',
      '---',
      '# A',
      'Text',
      'Intro:',
      '- a',
      '- b',
      '```',
      'x',
      '```',
      'Nach',
    ];
    const tight = opened(TIGHT);
    expect(written(tight.editor, tight.codec)).toEqual(lines(TIGHT));
    // A diagram's line right under a text line, or the file's last, is the diagram all the same.
    const CLOSE = ['Text', `[[file:${ID}|A.diagram]]`, 'Mehr', '', `[[file:${ID}|B.diagram]]`];
    const close = opened(CLOSE);
    expect(written(close.editor, close.codec)).toEqual(lines(CLOSE));
    expect(
      close.editor.getEditorState().read(() =>
        $getRoot()
          .getChildren()
          .map((node) => node.getType()),
      ),
    ).toEqual(['paragraph', 'page-diagram-embed', 'paragraph', 'page-diagram-embed']);
  });

  it('writes only what changed: the same line ids, new ones for new blocks, none for gone ones', () => {
    const { editor, codec } = opened(FILE);
    // A word typed into the heading: its line keeps its id, everything else stays as it was.
    editor.update(
      () => {
        $getRoot()
          .getFirstChildOrThrow<ElementNode>()
          .getFirstDescendant()!
          .replace($createTextNode('Hallo Team'));
      },
      { discrete: true },
    );
    const after = written(editor, codec);
    expect(after[4]).toEqual({ id: 'L5', text: '# Hallo Team' });
    expect(after.filter((line, index) => line.text !== FILE[index])).toHaveLength(1);

    // A paragraph put in after the heading: its line and a blank one, both new.
    editor.update(
      () => {
        $getRoot()
          .getFirstChild()!
          .insertAfter($createParagraphNode().append($createTextNode('Neu')));
      },
      { discrete: true },
    );
    const added = written(editor, codec);
    expect(added.slice(4, 8).map((line) => line.text)).toEqual(['# Hallo Team', '', 'Neu', '']);
    expect(added[6]!.id).toMatch(/^p[a-z0-9]{6,}$/);
    expect(added).toHaveLength(FILE.length + 2);

    // The table deleted: its lines and the blank one after it go, the rest stays.
    editor.update(
      () => {
        $getRoot()
          .getChildren()
          .find((node) => $isRawBlockNode(node) && node.__raw === 'table')!
          .remove();
      },
      { discrete: true },
    );
    const less = written(editor, codec);
    expect(less.some((line) => line.text.includes('| A | B |'))).toBe(false);
    expect(less).toHaveLength(FILE.length + 2 - 4);
    expect(less.at(-2)).toEqual({ id: `L${FILE.length - 1}`, text: 'Ende' });

    // Written whole, the page is Markdown others read: the callout, the live block, the link.
    const markdown = editor.getEditorState().read($pageMarkdown);
    expect(markdown).toContain('> [!NOTE]\n> Ein **Hinweis**');
    expect(markdown).toContain('{{unterseiten}}');
    expect(markdown).toContain(`[[file:${ID}|Protokolle]]`);
    expect(markdown).toContain(`\n[[file:${ID}|Ablauf.diagram]]\n`);

    // A line put in above a list's lines: they keep their ids (no set-text for each of them).
    const list = opened(['- [ ] offen', '- [x] erledigt', '']);
    list.editor.update(
      () => {
        const first = $getRoot()
          .getFirstChildOrThrow<ElementNode>()
          .getFirstChildOrThrow<ListItemNode>();
        first.insertBefore($createListItemNode(false).append($createTextNode('neu')));
      },
      { discrete: true },
    );
    const listed = written(list.editor, list.codec);
    expect(listed.map((line) => line.text)).toEqual([
      '- [ ] neu',
      '- [ ] offen',
      '- [x] erledigt',
      '',
    ]);
    expect(listed.slice(1).map((line) => line.id)).toEqual(['L1', 'L2', 'L3']);

    // Once sent (`$commit`), what was written anew is measured against what went out: typing
    // elsewhere writes it as it is, its next change keeps the ids it was sent with.
    const sent = opened(['- a', '']);
    const $items = () => $getRoot().getFirstChildOrThrow<ElementNode>().getChildren<ListItemNode>();
    const typeInto = (index: number, text: string) =>
      sent.editor.update(
        () => {
          $items()[index]!.getFirstDescendant()!.replace($createTextNode(text));
        },
        { discrete: true },
      );
    sent.editor.update(
      () => {
        $items()[0]!.insertAfter($createListItemNode().append($createTextNode('b')));
      },
      { discrete: true },
    );
    const first = sent.editor.getEditorState().read(() => sent.codec.$commit());
    expect(first.map((line) => line.text)).toEqual(['- a', '- b', '']);
    expect(written(sent.editor, sent.codec)).toEqual(first);
    typeInto(0, 'a2');
    const second = written(sent.editor, sent.codec);
    expect(second.map((line) => line.text)).toEqual(['- a2', '- b', '']);
    expect(second.map((line) => line.id)).toEqual(first.map((line) => line.id));

    // A block that made two nodes (a list switching from - to 1.): each is its own once sent.
    const mixed = opened(['- x', '1. y', '']);
    const $lists = () => $getRoot().getChildren<ElementNode>();
    const typeList = (index: number, text: string) =>
      mixed.editor.update(
        () => {
          $lists()[index]!.getFirstDescendant()!.replace($createTextNode(text));
        },
        { discrete: true },
      );
    expect(mixed.editor.getEditorState().read(() => $lists().length)).toBe(2);
    typeList(1, 'y2');
    const once = mixed.editor.getEditorState().read(() => mixed.codec.$commit());
    typeList(0, 'x2');
    const twice = written(mixed.editor, mixed.codec);
    expect(twice.map((line) => line.text)).toEqual(['- x2', '', '1. y2', '']);
    expect(twice.find((line) => line.text === '1. y2')!.id).toBe(
      once.find((line) => line.text === '1. y2')!.id,
    );

    // A diagram changed on its drawing (a box renamed): only its line is new text, the fence as
    // written (`~~~ mermaid`), every id kept; a ```mermaid typed is the same block once reopened.
    const drawn = opened(['~~~ mermaid', 'graph TD', '  A --> B', '~~~', '', 'Nach', '']);
    drawn.editor.update(
      () => {
        const node = $getRoot().getFirstChild();
        if ($isRawBlockNode(node)) node.setText('~~~ mermaid\ngraph TD\n  A --> B[Zwei]\n~~~');
      },
      { discrete: true },
    );
    const renamed = written(drawn.editor, drawn.codec);
    expect(renamed.map((line) => line.text)).toEqual([
      '~~~ mermaid',
      'graph TD',
      '  A --> B[Zwei]',
      '~~~',
      '',
      'Nach',
      '',
    ]);
    expect(renamed.map((line) => line.id)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']);
    const typed = opened([]);
    typed.editor.update(
      () => {
        $getRoot()
          .clear()
          .append($createCodeNode('mermaid').append($createTextNode('flowchart TD\n  A --> B')));
      },
      { discrete: true },
    );
    const typedText = typed.editor.getEditorState().read($pageMarkdown);
    const reopened = opened(typedText.split('\n'));
    expect(
      reopened.editor.getEditorState().read(() => {
        const node = $getRoot().getFirstChild();
        return $isRawBlockNode(node) ? node.__raw : node?.getType();
      }),
    ).toBe('diagram');

    // A drawing by hand (```ink): a stroke drawn is one line more before its fence, every other
    // line and id kept; a stroke wiped is that line gone; a stroke longer than a line holds goes
    // on in a line of its own, from where the one before ended.
    const inked = opened(['```ink 300', 'pen text 4 10 10 20 20', '```', '', 'Nach', '']);
    expect(
      inked.editor.getEditorState().read(() => {
        const node = $getRoot().getFirstChild();
        return $isRawBlockNode(node) ? node.__raw : node?.getType();
      }),
    ).toBe('ink');
    const stroke = {
      tool: 'marker',
      color: 'yellow',
      width: 22,
      points: [
        [5, 5],
        [50, 6],
      ],
    } as const;
    inked.editor.update(
      () => {
        const node = $getRoot().getFirstChild();
        if ($isRawBlockNode(node))
          node.setText(addStrokes(node.getText(), [{ ...stroke, points: [...stroke.points] }]));
      },
      { discrete: true },
    );
    const drawnInk = written(inked.editor, inked.codec);
    expect(drawnInk.map((line) => line.text)).toEqual([
      '```ink 300',
      'pen text 4 10 10 20 20',
      'marker yellow 22 5 5 50 6',
      '```',
      '',
      'Nach',
      '',
    ]);
    expect(drawnInk.filter((line) => line.id.startsWith('L')).map((line) => line.id)).toEqual([
      'L1',
      'L2',
      'L3',
      'L4',
      'L5',
      'L6',
    ]);
    const ink = parseInk(drawnInk.map((line) => line.text).join('\n'));
    expect(ink.height).toBe(300);
    expect(ink.strokes.map(({ line }) => line)).toEqual([1, 2]);
    expect(
      removeLines(
        drawnInk
          .map((line) => line.text)
          .slice(0, 4)
          .join('\n'),
        new Set([1]),
      ),
    ).toBe('```ink 300\nmarker yellow 22 5 5 50 6\n```');
    const long = strokeLines({
      tool: 'pen',
      color: 'text',
      width: 4,
      points: Array.from({ length: 1600 }, (_, at) => [at, at] as const),
    });
    expect(long).toHaveLength(2);
    expect(long[1]!.startsWith('pen text 4 1499 1499 1500 1500')).toBe(true);
    expect(long.every((line) => line.length < 20_000)).toBe(true);
    expect(parseStroke('pen text 4 1 2 3')).toBeNull();
    expect(setHeight('```ink 300\n```', 540)).toBe('```ink 540\n```');
  });
});
