import { $createLinkNode, $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from '@lexical/list';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
} from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import { $findMatchingParent } from '@lexical/utils';
import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  type TextFormatType,
} from 'lexical';
import { useEffect, useState, type ReactNode } from 'react';
import { cn, IconButton, Toolbar, ToolbarDivider, type IconName } from '@/ui';

/*
 * The buttons that format rich text being typed in Lexical – a page (`FormatBar`) and a Sender
 * message (`RichField`): bold, italic, underlined, struck through,
 * lists, two sizes of heading, a link; for a message also code and a quote. In the format bar's
 * look; where it floats is its owner's.
 */

type Block = 'paragraph' | 'h1' | 'h2' | 'ul' | 'ol' | 'quote';

/** The buttons without the pill around them – standing in a field („Aa“). */
function BareBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="toolbar" aria-label={label} className="flex flex-wrap items-center gap-1">
      {children}
    </div>
  );
}

export function RichFormatToolbar({
  chat = false,
  bare = false,
  onLinking,
}: {
  /** A message's: code and a quote too. */
  chat?: boolean;
  /** No pill of its own: it stands in a field. */
  bare?: boolean;
  /** The link's address is being typed (its field has the focus, the text not). */
  onLinking?: (linking: boolean) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<{ formats: Set<TextFormatType>; block: Block; link: boolean }>(
    { formats: new Set(), block: 'paragraph', link: false },
  );
  const [linking, setLinkingState] = useState<string | null>(null);
  const setLinking = (next: string | null) => {
    setLinkingState(next);
    onLinking?.(next !== null);
  };
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) =>
        editorState.read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          const node = selection.anchor.getNode();
          const formats = new Set(
            (['bold', 'italic', 'underline', 'strikethrough', 'code'] as const).filter((format) =>
              selection.hasFormat(format),
            ),
          );
          const heading = $findMatchingParent(node, $isHeadingNode);
          const list = $findMatchingParent(node, $isListNode);
          const block: Block = list
            ? list.getListType() === 'number'
              ? 'ol'
              : 'ul'
            : heading
              ? (heading.getTag() as 'h1' | 'h2')
              : $findMatchingParent(node, $isQuoteNode)
                ? 'quote'
                : 'paragraph';
          setState({ formats, block, link: $findMatchingParent(node, $isLinkNode) !== null });
        }),
      ),
    [editor],
  );
  const format = (type: TextFormatType) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, type);
  const block = (next: 'paragraph' | 'h1' | 'h2' | 'quote') =>
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $setBlocksType(selection, () =>
        next === 'paragraph'
          ? $createParagraphNode()
          : next === 'quote'
            ? $createQuoteNode()
            : $createHeadingNode(next),
      );
    });
  // A list's button again: back to lines.
  const list = (kind: 'ul' | 'ol') =>
    state.block === kind
      ? editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined)
      : editor.dispatchCommand(
          kind === 'ul' ? INSERT_UNORDERED_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND,
          undefined,
        );
  const button = (icon: IconName, label: string, on: boolean, run: () => void) => (
    <IconButton
      key={label}
      icon={icon}
      label={label}
      size="compact"
      aria-pressed={on}
      className={cn(on && 'bg-selected text-fg')}
      // Keeps the caret in the text.
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
    />
  );
  if (linking !== null)
    return (
      <form
        className="flex items-center gap-1 p-1"
        onSubmit={(event) => {
          event.preventDefault();
          const url = linking.trim();
          setLinking(null);
          if (!/^https?:\/\//i.test(url)) return;
          editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection) && selection.isCollapsed()) {
              const link = $createLinkNode(url);
              link.append($createTextNode(url));
              selection.insertNodes([link]);
            }
          });
          editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
          editor.focus();
        }}
      >
        <input
          autoFocus
          value={linking}
          placeholder="https://"
          aria-label="Adresse des Links"
          className="h-7 w-56 rounded-control bg-surface-1 px-2 text-body text-fg outline-none"
          onChange={(event) => setLinking(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              setLinking(null);
              editor.focus();
            }
          }}
        />
        <IconButton type="submit" icon="check" label="Link setzen" size="compact" />
      </form>
    );
  const Bar = bare ? BareBar : Toolbar;
  return (
    <Bar label="Text formatieren">
      {button('formatBold', 'Fett (⌘B)', state.formats.has('bold'), () => format('bold'))}
      {button('formatItalic', 'Kursiv (⌘I)', state.formats.has('italic'), () => format('italic'))}
      {button('formatUnderlined', 'Unterstrichen (⌘U)', state.formats.has('underline'), () =>
        format('underline'),
      )}
      {button('formatStrikethrough', 'Durchgestrichen', state.formats.has('strikethrough'), () =>
        format('strikethrough'),
      )}
      {chat && button('code', 'Code (`)', state.formats.has('code'), () => format('code'))}
      <ToolbarDivider />
      {button('formatListBulleted', 'Aufzählung (- )', state.block === 'ul', () => list('ul'))}
      {button('formatListNumbered', 'Nummerierung (1. )', state.block === 'ol', () => list('ol'))}
      {chat &&
        button('formatQuote', 'Zitat (> )', state.block === 'quote', () =>
          block(state.block === 'quote' ? 'paragraph' : 'quote'),
        )}
      <ToolbarDivider />
      {(
        [
          ['paragraph', 'Text', 'textFields'],
          ['h2', 'Groß (## )', 'formatSize'],
          ['h1', 'Überschrift (# )', 'title'],
        ] as const
      ).map(([tag, label, icon]) =>
        button(icon as IconName, label, state.block === tag, () => block(tag)),
      )}
      <ToolbarDivider />
      {button('link', state.link ? 'Link entfernen' : 'Link', state.link, () =>
        state.link ? editor.dispatchCommand(TOGGLE_LINK_COMMAND, null) : setLinking(''),
      )}
    </Bar>
  );
}
