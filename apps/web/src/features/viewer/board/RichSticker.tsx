import { $createLinkNode, $isLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
} from '@lexical/list';
import {
  $convertToMarkdownString,
  BOLD_ITALIC_STAR,
  BOLD_STAR,
  HEADING,
  ITALIC_STAR,
  LINK,
  ORDERED_LIST,
  STRIKETHROUGH,
  UNORDERED_LIST,
} from '@lexical/markdown';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { $createHeadingNode, $isHeadingNode, HeadingNode } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import { $findMatchingParent, mergeRegister } from '@lexical/utils';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type EditorState,
  type TextFormatType,
} from 'lexical';
import { useStore } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { cn, IconButton, Toolbar, ToolbarDivider, type IconName } from '@/ui';
import type { NoteEnd } from './NoteComposer';
import { RICH_THEME as THEME } from './rich-theme';

/*
 * A sticker's rich text on the board (the material page): typed in Lexical right in its box – bold, italic,
 * underlined, struck through, lists, two sizes of heading, links; ⌘B/⌘I/⌘U and Markdown-like
 * starts (`- `, `1. `, `# `) – with a small floating bar in the format bar's look. Kept as
 * Lexical's state (`rich`) plus the same as Markdown (`text`, for the AI and search); shown again
 * by `RichText`, without an editor. The text takes the box's colour.
 */

const NODES = [HeadingNode, ListNode, ListItemNode, LinkNode];

/** The Markdown it understands as typed (`- `, `1. `, `# `, `**…**`) and writes for the AI. */
const TRANSFORMERS = [
  HEADING,
  UNORDERED_LIST,
  ORDERED_LIST,
  BOLD_ITALIC_STAR,
  BOLD_STAR,
  ITALIC_STAR,
  STRIKETHROUGH,
  LINK,
];

/** A plain note's text as an editor state: one paragraph per line. */
function fromPlain(text: string) {
  return () => {
    const root = $getRoot();
    for (const line of text.split('\n')) {
      const paragraph = $createParagraphNode();
      if (line) paragraph.append($createTextNode(line));
      root.append(paragraph);
    }
  };
}

export interface RichValue {
  rich: Record<string, unknown>;
  /** The same as Markdown: for the AI and search. */
  text: string;
  /** Just its words (a box that turns into a frame's label or a note beside a thing). */
  plain: string;
}

/**
 * Typing a sticker's rich text in its box. ↵ ends it (in a list: a new point), ⇧↵ a new line, Esc
 * drops what was typed; left (a click elsewhere) it is taken.
 */
export function RichStickerEditor({
  rich,
  text,
  className,
  placeholder = 'Notiz …',
  onDone,
  onAsk,
  onCancel,
  endRef,
}: {
  rich: Record<string, unknown> | null;
  text: string;
  className?: string;
  placeholder?: string;
  onDone: (value: RichValue) => void;
  /** ⌘↵: taken as with ↵, then handed to the AI (as a comment is). */
  onAsk?: (value: RichValue) => void;
  onCancel: () => void;
  /** Set to end it as its keys do – by its composer's buttons (`NoteComposer`). */
  endRef?: { current: (how: NoteEnd) => void };
}) {
  const [config] = useState(() => ({
    namespace: 'sticker',
    theme: THEME,
    nodes: NODES,
    editorState: rich ? JSON.stringify(rich) : fromPlain(text),
    onError: (error: Error) => {
      throw error;
    },
  }));
  return (
    <LexicalComposer initialConfig={config}>
      <div className={cn('relative size-full', className)}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              aria-label="Notiz"
              aria-placeholder={placeholder}
              aria-keyshortcuts={onAsk ? 'Meta+Enter' : undefined}
              spellCheck
              // Typed in, not dragged, panned or scrolled by the board.
              className="nodrag nopan nowheel size-full overflow-auto outline-none"
              placeholder={
                <span className="pointer-events-none absolute top-0 left-0 opacity-50">
                  {placeholder}
                </span>
              }
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin />
      <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
      <Keys onDone={onDone} onAsk={onAsk} onCancel={onCancel} endRef={endRef} />
      <FormatBar />
    </LexicalComposer>
  );
}

/** What the editor holds, as kept. */
function valueOf(state: EditorState): RichValue {
  return {
    rich: state.toJSON() as unknown as Record<string, unknown>,
    text: state.read(() => $convertToMarkdownString(TRANSFORMERS)).trim(),
    plain: state.read(() => $getRoot().getTextContent()).trim(),
  };
}

/**
 * Focus at once (the caret at the end), ↵/Esc, ⌘↵ to the AI, and leaving the box takes what was
 * typed.
 */
function Keys({
  onDone,
  onAsk,
  onCancel,
  endRef,
}: {
  onDone: (value: RichValue) => void;
  onAsk: ((value: RichValue) => void) | undefined;
  onCancel: () => void;
  /** Ends it from outside (its composer's buttons). */
  endRef: { current: (how: NoteEnd) => void } | undefined;
}) {
  const [editor] = useLexicalComposerContext();
  const ended = useRef(false);
  useEffect(() => {
    const end = (how: NoteEnd) => {
      if (ended.current) return;
      ended.current = true;
      if (how === 'cancel') onCancel();
      else if (how === 'ask') onAsk?.(valueOf(editor.getEditorState()));
      else onDone(valueOf(editor.getEditorState()));
    };
    if (endRef) endRef.current = end;
    // In the box at once, its caret at the end – React Flow shows a new node a frame late.
    let tries = 10;
    const focus = () => {
      editor.focus(undefined, { defaultSelection: 'rootEnd' });
      if (document.activeElement !== editor.getRootElement() && tries-- > 0)
        requestAnimationFrame(focus);
    };
    requestAnimationFrame(focus);
    const root = editor.getRootElement();
    const onBlur = (event: FocusEvent) => {
      // Into its own bar: still typing.
      if (
        event.relatedTarget instanceof Element &&
        event.relatedTarget.closest('[data-sticker-bar]')
      )
        return;
      end('done');
    };
    root?.addEventListener('blur', onBlur);
    return mergeRegister(
      () => root?.removeEventListener('blur', onBlur),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          // ⌘↵: taken and handed to the AI – in a list too.
          if (onAsk && (event?.metaKey || event?.ctrlKey)) {
            event.preventDefault();
            end('ask');
            return true;
          }
          // ⇧↵: a new line – a paragraph of its own, so `- `, `1. ` and `# ` start one there.
          if (event?.shiftKey) {
            event.preventDefault();
            editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
            return true;
          }
          // In a list: a new point.
          const inList = editor.getEditorState().read(() => {
            const selection = $getSelection();
            return (
              $isRangeSelection(selection) &&
              $findMatchingParent(selection.anchor.getNode(), $isListNode) !== null
            );
          });
          if (inList) return false;
          event?.preventDefault();
          end('done');
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          end('cancel');
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    );
  }, [editor, onDone, onAsk, onCancel, endRef]);
  return null;
}

type Block = 'paragraph' | 'h1' | 'h2' | 'ul' | 'ol';

/** The floating bar while typing: the format bar's look, over the box. */
function FormatBar() {
  const [editor] = useLexicalComposerContext();
  // As large on screen at any zoom, as the editor's format bar.
  const zoom = useStore((store) => store.transform[2]);
  const [state, setState] = useState<{ formats: Set<TextFormatType>; block: Block; link: boolean }>(
    {
      formats: new Set(),
      block: 'paragraph',
      link: false,
    },
  );
  const [linking, setLinking] = useState<string | null>(null);
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) =>
        editorState.read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          const node = selection.anchor.getNode();
          const formats = new Set(
            (['bold', 'italic', 'underline', 'strikethrough'] as const).filter((format) =>
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
              : 'paragraph';
          setState({ formats, block, link: $findMatchingParent(node, $isLinkNode) !== null });
        }),
      ),
    [editor],
  );
  const format = (type: TextFormatType) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, type);
  const block = (next: 'paragraph' | 'h1' | 'h2') =>
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $setBlocksType(selection, () =>
        next === 'paragraph' ? $createParagraphNode() : $createHeadingNode(next),
      );
    });
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
  return (
    <div
      data-sticker-bar
      className="nodrag nopan glass-elevated absolute bottom-full left-0 z-(--z-raised) mb-2 origin-bottom-left rounded-panel"
      style={{ transform: `scale(${1 / zoom})` }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {linking === null ? (
        <Toolbar label="Text formatieren">
          {button('formatBold', 'Fett (⌘B)', state.formats.has('bold'), () => format('bold'))}
          {button('formatItalic', 'Kursiv (⌘I)', state.formats.has('italic'), () =>
            format('italic'),
          )}
          {button('formatUnderlined', 'Unterstrichen (⌘U)', state.formats.has('underline'), () =>
            format('underline'),
          )}
          {button(
            'formatStrikethrough',
            'Durchgestrichen',
            state.formats.has('strikethrough'),
            () => format('strikethrough'),
          )}
          <ToolbarDivider />
          {button('formatListBulleted', 'Aufzählung (- )', state.block === 'ul', () =>
            editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
          )}
          {button('formatListNumbered', 'Nummerierung (1. )', state.block === 'ol', () =>
            editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
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
        </Toolbar>
      ) : (
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
                setLinking(null);
                editor.focus();
              }
            }}
          />
          <IconButton type="submit" icon="check" label="Link setzen" size="compact" />
        </form>
      )}
    </div>
  );
}

export default RichStickerEditor;
