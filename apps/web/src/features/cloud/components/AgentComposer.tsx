import { useEffect, useRef, useState } from 'react';
import { MAX_MATERIAL_CHAT_MESSAGE, type Attachment } from '@slider/shared';
import {
  AttachButton,
  AttachmentChips,
  useAttachments,
  useCloudDrop,
} from '@/features/attachments';
import { draftOf, setDraft, useDrafts, type DraftTarget } from '@/lib/drafts';
import { isModKey } from '@/lib/keyboard';
import { useTallField } from '@/lib/useTallField';
import { useTypeInto } from '@/lib/useTypeInto';
import { AutosizeTextarea, cn, IconButton } from '@/ui';

/**
 * The field an agent is written to – as the chat's beside the files (`ChatPanel`): Enter sends,
 * Shift+Enter breaks the line. While the agent works one writes on – it takes the message up as
 * soon as it can –, and „Stoppen“ stands beside „Senden“.
 */
export function AgentComposer({
  placeholder,
  busy = false,
  working = false,
  autoFocus = false,
  inline = false,
  top = false,
  draft,
  keep,
  onSend,
  onStop,
  onTyping,
  onEscape,
  typeInto = false,
  workspaceId,
}: {
  /** Where files put on the message go up – with it, the clip and pasting files are there. */
  workspaceId?: string;
  /** A text to start from, put into the field each time it is another one. */
  draft?: { text: string } | null;
  /** What is written and not sent is kept under this key (`Entwürfe`) and comes back here. */
  keep?: { key: string; target: DraftTarget };
  placeholder: string;
  /** Nothing is sent right now: an order is being placed. */
  busy?: boolean;
  /** The agent works: it can be stopped, and written to all the same. */
  working?: boolean;
  autoFocus?: boolean;
  /** In a column that scrolls (`MailAside`): a field in the page, no float shadow cut at its edges. */
  inline?: boolean;
  /**
   * At a page's top, beside its buttons (`Agenten`, „Zuletzt“): a field as high as they are and
   * dressed as every other field there (`TextField`). Otherwise the slim one under a conversation.
   */
  top?: boolean;
  /** `false`: refused – the text and the files go back into the field. */
  onSend: (text: string, attachments: Attachment[]) => Promise<boolean>;
  onStop?: () => void;
  /** Something is being written – as often as a key is pressed. */
  onTyping?: () => void;
  /** Esc in the field – where the page has one (back, on „Neu“); else the field keeps it. */
  onEscape?: () => void;
  /** Typing with the focus on no field (the chat just picked in the side bar) writes here. */
  typeInto?: boolean;
}) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const attach = useAttachments({
    workspaceId,
    keep: keep ? `agent:${keep.key}` : undefined,
  });
  // Cloud files and folders dropped on the field: pointed to, not copied.
  const drop = useCloudDrop(attach);
  const [body, setBody] = useState(() => (keep ? draftOf(keep.key) : (draft?.text ?? '')));
  const change = (text: string) => {
    setBody(text);
    if (keep) setDraft(keep.key, text, keep.target);
  };
  // Another chat in the same field: its draft.
  // What the field shows that is kept: taken in, or taken by the server – typed on since, not yet.
  const [saved, setSaved] = useState(body);
  const [kept, setKept] = useState(keep?.key);
  if (kept !== keep?.key) {
    setKept(keep?.key);
    setBody(keep ? draftOf(keep.key) : '');
    setSaved(keep ? draftOf(keep.key) : '');
  }
  // Written on another device or tab (the list came down): in the field – unless one typed on and
  // that is not on the server yet (it would be gone).
  const keptDraft = useDrafts()[keep?.key ?? ''];
  const stored = keep ? (keptDraft?.text ?? '') : '';
  if (keep && keptDraft?.synced && keptDraft.text === body && saved !== body) setSaved(body);
  const [seen, setSeen] = useState(stored);
  if (keep && stored !== seen) {
    setSeen(stored);
    if (body === saved || !body.trim()) {
      setBody(stored);
      setSaved(stored);
    }
  }
  useEffect(() => {
    if (autoFocus) fieldRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  useTypeInto(fieldRef, typeInto);
  // Written past one line: the buttons go below the words (as Sender's composer).
  const tall = useTallField(fieldRef, body) || attach.items.length > 0 || !!attach.error;

  // A picked example lies in the field at once: taken while rendering, not an effect later.
  const [taken, setTaken] = useState(draft);
  if (draft !== taken) {
    setTaken(draft);
    if (draft) setBody(draft.text);
  }
  useEffect(() => {
    if (draft) fieldRef.current?.focus({ preventScroll: true });
  }, [draft]);

  const files = attach.ready;
  const sendable = (!!body.trim() || files.length > 0) && !attach.busy && !busy;
  const send = () => {
    const text = body.trim();
    if (!sendable) return;
    change('');
    attach.clear();
    void onSend(text, files).then((sent) => {
      if (sent) return;
      setBody((now) => now || text);
      attach.restore(files);
      if (keep && !draftOf(keep.key)) setDraft(keep.key, text, keep.target);
    });
  };

  return (
    <form
      aria-label="Nachricht an den Agenten"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      {...drop.props}
      className={cn(
        top
          ? 'glass focus-field min-h-10 py-1.5 transition-shadow'
          : cn(inline ? 'glass-control' : 'glass-elevated', 'py-1'),
        'flex shrink-0 items-end gap-0.5 rounded-control pr-1 pl-3',
        tall && 'flex-wrap justify-end',
        drop.over && 'ring-2 ring-focus',
      )}
    >
      <div className={cn('flex min-w-0 flex-1 flex-col py-[5px]', tall && 'basis-full pr-2')}>
        <AutosizeTextarea
          ref={fieldRef}
          aria-label="Nachricht"
          placeholder={placeholder}
          maxLength={MAX_MATERIAL_CHAT_MESSAGE}
          maxHeight={200}
          value={body}
          onPaste={attach.onPaste}
          onChange={(event) => {
            change(event.target.value);
            if (event.target.value.trim()) onTyping?.();
          }}
          onKeyDown={(event) => {
            // The page's keys (⌫, ⌘A) are not meant while one writes – ⌘F and ⌘K (the searches) are.
            if (!(isModKey(event) && 'fk'.includes(event.key.toLowerCase())))
              event.stopPropagation();
            if (event.key === 'Escape' && onEscape) {
              event.preventDefault();
              onEscape();
              return;
            }
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            send();
          }}
          className={cn(
            top ? 'text-sm' : 'text-body',
            'leading-4.5 text-fg placeholder:text-fg-subtle',
          )}
        />
        <AttachmentChips files={attach} className="pt-2 pb-0.5" />
      </div>
      <AttachButton files={attach} />
      {working && onStop && (
        <IconButton icon="stop" label="Stoppen" size="compact" onClick={onStop} />
      )}
      <IconButton
        type="submit"
        icon="arrowUpward"
        label="Senden"
        title="Senden (Enter)"
        size="compact"
        iconTone={sendable ? 'success' : undefined}
        disabled={!sendable}
      />
    </form>
  );
}
