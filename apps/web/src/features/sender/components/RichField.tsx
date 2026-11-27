import { $isListNode } from '@lexical/list';
import {
  BOLD_ITALIC_STAR,
  BOLD_STAR,
  HEADING,
  INLINE_CODE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  LINK,
  ORDERED_LIST,
  QUOTE,
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
import { $findMatchingParent, mergeRegister } from '@lexical/utils';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  BLUR_COMMAND,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  type Klass,
  type LexicalNode,
} from 'lexical';
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { RichFormatToolbar } from '@/lib/rich-format';
import { cn } from '@/ui';
import { MARKUP_LOOK } from '../lib/markup';
import { $getMarkup, $markupNodes, $setMarkup, RICH_MARKUP_NODES } from '../lib/rich-markup';

/*
 * The field a Sender message is typed in, as it will show (`MessageText`): bold, italic,
 * underlined, struck through, code, lists, a quote, two sizes of heading, links – by ⌘B/⌘I/⌘U,
 * by Markdown typed (`**…**`, `- `, `1. `, `> `, `# `), or by the bar over the field while words
 * are selected (the sticker's on the board, `RichFormatToolbar`). What it holds is the message's
 * text (`markup.ts`): what comes in is shown, what is typed goes out as that text again.
 */

const THEME = {
  paragraph: 'm-0',
  heading: { h1: cn('m-0', MARKUP_LOOK.h1), h2: cn('m-0', MARKUP_LOOK.h2) },
  quote: cn('m-0', MARKUP_LOOK.quote),
  list: {
    ul: MARKUP_LOOK.ul,
    ol: MARKUP_LOOK.ol,
    listitem: 'm-0',
    nested: { listitem: 'list-none' },
  },
  link: MARKUP_LOOK.link,
  text: {
    bold: 'font-semibold',
    italic: 'italic',
    underline: 'underline',
    strikethrough: 'line-through',
    underlineStrikethrough: '[text-decoration:underline_line-through]',
    code: MARKUP_LOOK.code,
  },
};

/** What typed Markdown turns into at once – a heading only in the two sizes a message has. */
const TRANSFORMERS = [
  { ...HEADING, regExp: /^(#{1,2})\s/ },
  QUOTE,
  UNORDERED_LIST,
  ORDERED_LIST,
  INLINE_CODE,
  BOLD_ITALIC_STAR,
  BOLD_STAR,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  LINK,
];

/** The `@…` being typed just before the caret, as the plain field reads it. */
const MENTION = /(^|\s)@([\p{L}\p{N}.-]*)$/u;

const validUrl = (url: string) => /^https?:\/\/\S+$/i.test(url);

export interface RichFieldHandle {
  /** The caret into it – where it was, else at the end. */
  focus: () => void;
  /** The `@…` before the caret becomes `@name ` – `false`: the caret is elsewhere now. */
  replaceMention: (name: string) => boolean;
  /** An @ at the caret (a space before it after a word): naming someone starts. */
  insertMentionSign: () => void;
  /** All of it replaced – a step ⌘Z takes back (the AI's words for one's notes). */
  replaceAll: (text: string) => void;
  /** The caret in a list: Enter makes a new point there. */
  inList: () => boolean;
}

export function RichField({
  ref,
  fieldRef,
  value,
  onChange,
  onMention,
  label,
  placeholder,
  readOnly = false,
  maxLength,
  maxHeight,
  barSide = 'top',
  barOpen = false,
  className,
  combobox,
  onKeyDownCapture,
  onKeyDown,
  onPasteCapture,
  onBlur,
}: {
  ref?: Ref<RichFieldHandle>;
  /** The editable element itself (measured, typed into from outside). */
  fieldRef?: Ref<HTMLDivElement>;
  /** The message's text; a new one from outside (a draft, cleared on sending) is shown. */
  value: string;
  onChange: (text: string) => void;
  /** The `@…` typed before the caret, `null` once there is none. */
  onMention?: (query: string | null) => void;
  label: string;
  placeholder: string;
  readOnly?: boolean;
  maxLength?: number;
  maxHeight?: number;
  /** Where the bar floats: over the field, or under it (a field at a page's top). */
  barSide?: 'top' | 'bottom';
  /** The format bar stands in the field, over the text („Aa“) – else it floats over words picked. */
  barOpen?: boolean;
  className?: string;
  /** The @ list it opens. */
  combobox?: { expanded: boolean; controls?: string; activeDescendant?: string };
  /** Keys before the editor sees them (send, the @ list) – only those typed in the text. */
  onKeyDownCapture?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  /** Before the editor: files pasted (handled: `preventDefault`). */
  onPasteCapture?: (event: ClipboardEvent<HTMLDivElement>) => void;
  onBlur?: () => void;
}) {
  const [config] = useState(() => ({
    namespace: 'sender',
    theme: THEME,
    nodes: RICH_MARKUP_NODES as Klass<LexicalNode>[],
    editorState: () => $setMarkup(value),
    onError: (error: Error) => {
      throw error;
    },
  }));
  const typedIn = (event: { target: EventTarget; currentTarget: HTMLElement }) =>
    event.target instanceof HTMLElement && event.target.isContentEditable;
  return (
    <LexicalComposer initialConfig={config}>
      <div className={cn('touch-field relative min-w-0', className)}>
        {barOpen && (
          <div className="-mx-1.5 mb-1.5 border-b border-hairline pb-1.5">
            <RichFormatToolbar chat bare />
          </div>
        )}
        <div
          className="relative"
          onKeyDownCapture={(event) => {
            if (typedIn(event)) onKeyDownCapture?.(event);
          }}
          onKeyDown={(event) => {
            if (typedIn(event)) onKeyDown?.(event);
          }}
          onPasteCapture={(event) => {
            onPasteCapture?.(event);
            // Files taken by the message: not the editor's as well.
            if (event.defaultPrevented) event.stopPropagation();
          }}
          onBlur={onBlur}
        >
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                ref={fieldRef}
                ariaLabel={label}
                role={combobox ? 'combobox' : 'textbox'}
                ariaMultiline
                ariaExpanded={combobox?.expanded}
                ariaControls={combobox?.controls}
                ariaActiveDescendant={combobox?.activeDescendant}
                ariaAutoComplete={combobox ? 'list' : undefined}
                aria-busy={readOnly || undefined}
                aria-placeholder={placeholder}
                spellCheck
                style={
                  maxHeight !== undefined && maxHeight !== Infinity ? { maxHeight } : undefined
                }
                className="overflow-y-auto break-words whitespace-pre-wrap outline-none"
                placeholder={
                  <span className="pointer-events-none absolute top-0 right-0 left-0 truncate text-fg-subtle select-none">
                    {placeholder}
                  </span>
                }
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        {!barOpen && <FloatingBar side={barSide} />}
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin validateUrl={validUrl} />
      <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
      <Bridge
        handleRef={ref}
        value={value}
        onChange={onChange}
        onMention={onMention}
        readOnly={readOnly}
        maxLength={maxLength}
      />
    </LexicalComposer>
  );
}

/** Between the editor and its owner: the text both ways, the @ typed, the handle, the keys. */
function Bridge({
  handleRef,
  value,
  onChange,
  onMention,
  readOnly,
  maxLength,
}: {
  handleRef: Ref<RichFieldHandle> | undefined;
  value: string;
  onChange: (text: string) => void;
  onMention: ((query: string | null) => void) | undefined;
  readOnly: boolean;
  maxLength: number | undefined;
}) {
  const [editor] = useLexicalComposerContext();
  // The text last shown or sent out: a value from outside that differs is put in.
  const emitted = useRef(value);
  const latest = useRef({ onChange, onMention, maxLength });
  useEffect(() => {
    latest.current = { onChange, onMention, maxLength };
  });
  const mention = useRef<string | null>(null);

  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    editor.update(
      () => {
        $setMarkup(value);
        if (document.activeElement === editor.getRootElement()) $getRoot().selectEnd();
        else $setSelection(null);
      },
      { tag: 'external' },
    );
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
  }, [editor, value]);

  useEffect(() => editor.setEditable(!readOnly), [editor, readOnly]);

  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(
          ({ editorState, prevEditorState, dirtyElements, dirtyLeaves, tags }) => {
            const query = editorState.read(() => {
              const selection = $getSelection();
              if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
              const node = selection.anchor.getNode();
              if (!$isTextNode(node)) return null;
              const before = node.getTextContent().slice(0, selection.anchor.offset);
              return MENTION.exec(before)?.[2] ?? null;
            });
            if (query !== mention.current) {
              mention.current = query;
              latest.current.onMention?.(query);
            }
            if (tags.has('external') || tags.has('too-long')) return;
            if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
            const text = editorState.read($getMarkup);
            const { maxLength: max } = latest.current;
            // Past the most a message holds: what was typed last does not go in.
            if (max !== undefined && text.length > max && text.length > emitted.current.length) {
              editor.setEditorState(prevEditorState, { tag: 'too-long' });
              return;
            }
            if (text === emitted.current) return;
            emitted.current = text;
            latest.current.onChange(text);
          },
        ),
        // ⇧↵: a new line – a paragraph of its own, so `- `, `1. `, `> ` and `# ` start one there.
        editor.registerCommand(
          KEY_ENTER_COMMAND,
          (event) => {
            if (!event?.shiftKey) return false;
            event.preventDefault();
            editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        // Pasted words are read as a message's text (Markdown an AI wrote comes formatted);
        // what was copied from a field like this keeps its own.
        editor.registerCommand(
          PASTE_COMMAND,
          (event) => {
            const data = 'clipboardData' in event ? event.clipboardData : null;
            if (!data || data.types.includes('application/x-lexical-editor')) return false;
            const text = data.getData('text/plain').replace(/\r\n?/g, '\n');
            if (!text) return false;
            event.preventDefault();
            editor.update(() => {
              const selection = $getSelection();
              if ($isRangeSelection(selection)) selection.insertNodes($markupNodes(text));
            });
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
      ),
    [editor],
  );

  useImperativeHandle(
    handleRef,
    () => ({
      // The element first: Lexical's focus only places its selection.
      focus: () => {
        editor.getRootElement()?.focus({ preventScroll: true });
        editor.focus(undefined, { defaultSelection: 'rootEnd' });
      },
      replaceMention: (name) => {
        let done = false;
        editor.update(
          () => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
            const node = selection.anchor.getNode();
            if (!$isTextNode(node)) return;
            const offset = selection.anchor.offset;
            const typed = MENTION.exec(node.getTextContent().slice(0, offset));
            if (!typed) return;
            const start = offset - typed[2]!.length - 1;
            node.spliceText(start, offset - start, `@${name} `, true);
            done = true;
          },
          { discrete: true },
        );
        return done;
      },
      insertMentionSign: () => {
        editor.update(() => {
          let selection = $getSelection();
          if (!$isRangeSelection(selection)) {
            $getRoot().selectEnd();
            selection = $getSelection();
          }
          if (!$isRangeSelection(selection)) return;
          const node = selection.anchor.getNode();
          const before = $isTextNode(node)
            ? node.getTextContent().slice(0, selection.anchor.offset)
            : '';
          selection.insertText(before && !/\s$/.test(before) ? ' @' : '@');
        });
        editor.focus();
      },
      replaceAll: (text) => {
        editor.update(() => {
          $setMarkup(text);
          $getRoot().selectEnd();
        });
      },
      inList: () =>
        editor.getEditorState().read(() => {
          const selection = $getSelection();
          return (
            $isRangeSelection(selection) &&
            $findMatchingParent(selection.anchor.getNode(), $isListNode) !== null
          );
        }),
    }),
    [editor],
  );
  return null;
}

/** The format bar over the field while words in it are selected (or a link's address typed). */
function FloatingBar({ side }: { side: 'top' | 'bottom' }) {
  const [editor] = useLexicalComposerContext();
  const [selected, setSelected] = useState(false);
  const [linking, setLinking] = useState(false);
  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(({ editorState }) =>
          editorState.read(() => {
            const selection = $getSelection();
            setSelected(
              $isRangeSelection(selection) &&
                !selection.isCollapsed() &&
                document.activeElement === editor.getRootElement(),
            );
          }),
        ),
        editor.registerCommand(
          BLUR_COMMAND,
          () => {
            setSelected(false);
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
      ),
    [editor],
  );
  if (!selected && !linking) return null;
  return (
    <div
      data-popover-panel=""
      className={cn(
        'glass-elevated absolute left-0 z-(--z-raised) rounded-panel',
        side === 'top' ? 'bottom-full mb-3' : 'top-full mt-3',
      )}
    >
      <RichFormatToolbar chat onLinking={setLinking} />
    </div>
  );
}
