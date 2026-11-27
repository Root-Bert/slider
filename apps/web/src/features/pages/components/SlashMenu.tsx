import { $createCodeNode } from '@lexical/code-core';
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from '@lexical/list';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $createHorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode';
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import { $insertNodeToNearestRoot } from '@lexical/utils';
import {
  $createParagraphNode,
  $getNodeByKey,
  COMMAND_PRIORITY_NORMAL,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
  type LexicalNode,
  type TextNode,
} from 'lexical';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { Icon, MenuItem, type IconName } from '@/ui';
import {
  $createCalloutNode,
  $createDiagramEmbedNode,
  $createLiveBlockNode,
  $createPageLinkNode,
  $createRawBlockNode,
  type LiveKind,
} from '../lib/nodes';
import { newInk } from '../lib/ink';
import { usePageHost, type PageHost } from './PageHost';

/*
 * „/“ at the start of a line or after a space, in Bearbeiten: the blocks a page has, filtered by
 * what is typed after it (Notion's slash menu). Picked, the line becomes that block – or the block
 * goes in under it (a divider, a live block); „Seite“ makes a page beside this one and links it,
 * „Diagramm“ a diagram beside it, shown on the page and opened to be drawn.
 */

interface Ctx {
  editor: LexicalEditor;
  host: PageHost;
  /** The line the menu was opened in (its top-level node). */
  line: string | null;
  /** Goes to a place of the app (a diagram just made, to draw it). */
  open: (href: string) => void;
}

class SlashOption extends MenuOption {
  constructor(
    readonly label: string,
    readonly glyph: IconName,
    readonly words: string,
    readonly run: (ctx: Ctx) => void,
  ) {
    super(label);
  }
}

/** A block made after a wait (a page, a diagram) goes on the menu's line if it is empty, else under it. */
function $placeLater(node: LexicalNode, line: string | null) {
  const at = line ? $getNodeByKey(line) : null;
  if (at && at.getTextContentSize() === 0) at.replace(node);
  else if (at) at.insertAfter(node);
  else $insertNodeToNearestRoot(node);
}

const blockOf = (make: () => LexicalNode) => () => {
  const selection = $getSelection();
  if ($isRangeSelection(selection)) $setBlocksType(selection, make as never);
};

const LIVE: { kind: LiveKind; label: string; icon: IconName; words: string }[] = [
  { kind: 'unterseiten', label: 'Seiten', icon: 'article', words: 'unterseiten pages liste inhalt' },
  { kind: 'dateien', label: 'Dateien', icon: 'folderOpen', words: 'files ordner' },
  { kind: 'aufgaben', label: 'Aufgaben', icon: 'checkCircle', words: 'todos tasks' },
  { kind: 'personen', label: 'Personen', icon: 'groups', words: 'people team mitglieder' },
  { kind: 'termine', label: 'Termine', icon: 'event', words: 'kalender calendar events' },
];

function options(withPages: boolean, withDiagrams: boolean): SlashOption[] {
  const inEditor = (run: () => void) => () => run();
  return [
    new SlashOption('Text', 'textFields', 'absatz paragraph', inEditor(blockOf($createParagraphNode))),
    new SlashOption('Überschrift 1', 'title', 'h1 heading titel', inEditor(blockOf(() => $createHeadingNode('h1')))),
    new SlashOption('Überschrift 2', 'title', 'h2 heading', inEditor(blockOf(() => $createHeadingNode('h2')))),
    new SlashOption('Überschrift 3', 'title', 'h3 heading', inEditor(blockOf(() => $createHeadingNode('h3')))),
    new SlashOption('Aufzählung', 'formatListBulleted', 'liste bullet ul', ({ editor }) =>
      editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
    ),
    new SlashOption('Nummerierung', 'formatListNumbered', 'liste numbered ol', ({ editor }) =>
      editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
    ),
    new SlashOption('Checkliste', 'checklist', 'todo aufgabe check', ({ editor }) =>
      editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined),
    ),
    new SlashOption('Zitat', 'formatQuote', 'quote', inEditor(blockOf($createQuoteNode))),
    new SlashOption('Hinweis', 'info', 'callout note box', inEditor(blockOf(() => $createCalloutNode('NOTE')))),
    new SlashOption('Code', 'code', 'codeblock', inEditor(blockOf(() => $createCodeNode()))),
    new SlashOption('Trennlinie', 'lineSolid', 'divider linie hr', () => {
      $insertNodeToNearestRoot($createHorizontalRuleNode());
    }),
    new SlashOption('Zeichnung', 'gesture', 'zeichnen stift pen handschrift skizze ink draw', () => {
      $insertNodeToNearestRoot($createRawBlockNode(newInk(), 'ink'));
    }),
    ...LIVE.map(
      (live) =>
        new SlashOption(live.label, live.icon, `${live.words} live`, () => {
          $insertNodeToNearestRoot($createLiveBlockNode(live.kind));
        }),
    ),
    ...(withDiagrams
      ? [
          new SlashOption(
            'Diagramm',
            'accountTree',
            'flussdiagramm flowchart ablauf schaubild abhängigkeiten zeichnung',
            ({ editor, host, line, open }) => {
              void host.createDiagram?.('Neues Diagramm').then((file) => {
                if (!file) return;
                editor.update(
                  () => {
                    $placeLater($createDiagramEmbedNode(file.id, file.name), line);
                  },
                  // Drawn at once, as a new diagram from Cloud: the page keeps it (it saves as it closes).
                  { onUpdate: () => open(host.linkTo('file', file.id, file.name)) },
                );
              });
            },
          ),
        ]
      : []),
    ...(withPages
      ? [
          new SlashOption('Seite', 'article', 'page unterseite neu', ({ editor, host, line, open }) => {
            void host.createPage?.('Neue Seite').then((page) => {
              if (!page) return;
              editor.update(
                () => {
                  $placeLater(
                    $createParagraphNode().append($createPageLinkNode('file', page.id, page.name)),
                    line,
                  );
                },
                // Opened to be named and written, as Notion's; this page keeps the link (it saves as it closes).
                { onUpdate: () => open(page.href) },
              );
            });
          }),
        ]
      : []),
  ];
}

/**
 * Takes the typed „/…“ out of the line. It ends where the caret was – the end of `end`, the node the
 * menu split off – and starts at the last „/“ before. The menu's own match may be a keystroke behind
 * (it is set in a transition; Enter typed fast comes first), so it is looked for, not trusted.
 */
function $removeQuery(end: TextNode) {
  const chain: TextNode[] = [];
  for (let node: LexicalNode | null = end; $isTextNode(node); node = node.getPreviousSibling()) {
    chain.push(node);
    const text = node.getTextContent();
    const slash = text.lastIndexOf('/');
    if (slash < 0) continue;
    for (const each of chain.slice(0, -1)) each.remove();
    if (slash === 0) node.remove();
    else node.spliceText(slash, text.length - slash, '', true);
    return;
  }
}

export function SlashMenu() {
  const [editor] = useLexicalComposerContext();
  const host = usePageHost();
  const [query, setQuery] = useState<string | null>(null);
  const trigger = useBasicTypeaheadTriggerMatch('/', { minLength: 0, maxLength: 24, allowWhitespace: true });
  const navigate = useNavigate();
  const all = useMemo(
    () => options(host.createPage !== undefined, host.createDiagram !== undefined),
    [host.createPage, host.createDiagram],
  );
  const shown = useMemo(() => {
    const q = (query ?? '').trim().toLowerCase();
    if (!q) return all;
    // The block named so first („/Seite“ makes a page, not the list „Seiten“), then those it begins.
    const rank = (option: SlashOption) => {
      const label = option.label.toLowerCase();
      return label === q ? 0 : label.startsWith(q) ? 1 : 2;
    };
    return all
      .filter((option) => `${option.label} ${option.words}`.toLowerCase().includes(q))
      .sort((one, other) => rank(one) - rank(other));
  }, [all, query]);

  return (
    <LexicalTypeaheadMenuPlugin<SlashOption>
      onQueryChange={setQuery}
      // Above „Fertig“ on Esc (LOW): an open menu takes Esc, Enter and the arrows first.
      commandPriority={COMMAND_PRIORITY_NORMAL}
      options={shown}
      triggerFn={trigger}
      onSelectOption={(option, textNode, close) => {
        editor.update(() => {
          const line = textNode?.getTopLevelElement()?.getKey() ?? null;
          if (textNode) $removeQuery(textNode);
          option.run({ editor, host, line, open: (href) => void navigate(href) });
          close();
        });
      }}
      menuRenderFn={(anchor, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) =>
        anchor.current && shown.length > 0
          ? createPortal(
              <div
                data-popover-panel=""
                className="glass-elevated page-slash-menu rounded-panel p-1"
                role="listbox"
                aria-label="Blöcke"
              >
                {shown.map((option, index) => (
                  <MenuItem
                    key={option.key}
                    ref={(element: HTMLElement | null) => option.setRefElement(element)}
                    role="option"
                    aria-selected={selectedIndex === index}
                    selected={selectedIndex === index}
                    size="sm"
                    icon={<Icon name={option.glyph} size={18} />}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectOptionAndCleanUp(option)}
                  >
                    {option.label}
                  </MenuItem>
                ))}
              </div>,
              anchor.current,
            )
          : null
      }
    />
  );
}
