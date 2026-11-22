import { aiInSentence, MAX_MATERIAL_CHAT_MESSAGE, markdownToRich } from '@slider/shared';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMe } from '@/lib/api';
import { AutosizeTextarea, Avatar, Icon, IconButton, LogoMark, useFocusLoop } from '@/ui';
import { SidePanel, SidePanelHeader } from '../components/SidePanel';
import { useRestoreFocus } from '../hooks/useRestoreFocus';
import { RichText } from './rich-text';

/*
 * A chat with the AI in a side panel, as with Claude or ChatGPT: the talk, what the AI does
 * while it writes, the field below. One look and one set of keys wherever the AI is asked –
 * beside a presentation's material (`MaterialChat`) and beside the files in Cloud.
 */

export interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** The AI's: `answering` while it is written. */
  state?: 'answering' | 'done' | 'failed' | 'stopped';
  /** What it does right now („Sucht im Web …“). */
  reading?: string | null;
  /** It does that in Slider: Slider's mark stands before it. */
  readingIn?: 'slider' | null;
  error?: string | null;
}

/** The open chat and what can be done with it. */
export interface Chat {
  entries: readonly ChatEntry[];
  busy: boolean;
  /** `false`: refused at once – the text goes back into the field. */
  send: (text: string) => Promise<boolean>;
  stop: () => void;
  clear: () => void;
}

interface ChatPanelProps {
  title: string;
  chat: Chat;
  /** Shown while the chat is empty, above the ways in. */
  intro: ReactNode;
  /** Ways in while the chat is empty – each sent as it reads. */
  starters: readonly string[];
  /** Above the intro while the chat is empty: one's earlier chats. */
  earlier?: ReactNode;
  /** A run of an answer's text, drawn (sources as chips). */
  renderText?: (run: string) => ReactNode;
  /** An answer as it is copied. */
  copyText?: (text: string) => string;
  toast: (message: string, tone?: 'danger') => void;
  onClose: () => void;
  /** Hooks of the place (`data-*`) on the panel. */
  panel?: Record<`data-${string}`, string | boolean>;
}

export function ChatPanel({
  title,
  chat,
  intro,
  starters,
  earlier,
  renderText,
  copyText,
  toast,
  onClose,
  panel,
}: ChatPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const me = useMe().data?.viewer.author;
  const [body, setBody] = useState('');
  useRestoreFocus();
  useFocusLoop(panelRef);
  useEffect(() => fieldRef.current?.focus({ preventScroll: true }), []);

  // Follows the answer while it is written, unless one scrolled up to read.
  const last = chat.entries.at(-1);
  const pinned = useRef(true);
  const empty = chat.entries.length === 0;
  useEffect(() => {
    // A chat begun or opened starts at its end.
    if (empty) pinned.current = true;
    const list = listRef.current;
    if (list && pinned.current) list.scrollTop = list.scrollHeight;
  }, [last?.text, last?.reading, chat.entries.length, empty]);

  // The buttons a click just took away (a starter, „Neuer Chat“, „Stoppen“) would leave the
  // focus on the page: it goes back to the field, so typing and Esc go on working.
  const toField = () => fieldRef.current?.focus({ preventScroll: true });

  const send = (text: string) => {
    if (!text.trim() || chat.busy) return;
    setBody('');
    pinned.current = true;
    toField();
    void chat.send(text).then((sent) => {
      if (!sent) setBody((now) => now || text);
    });
  };

  return (
    <SidePanel
      ref={panelRef}
      {...panel}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing)
          return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <SidePanelHeader>
        <div className="flex items-center gap-2">
          <Icon name="autoAwesome" size={18} className="shrink-0 text-fg-muted" />
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
            {title}
          </h2>
          {!empty && (
            <IconButton
              icon="add"
              label="Neuer Chat"
              size="sm"
              onClick={() => {
                chat.clear();
                toField();
              }}
            />
          )}
          <IconButton icon="close" label={`${title} schließen (Esc)`} size="sm" onClick={onClose} />
        </div>
      </SidePanelHeader>

      {empty ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          {earlier}
          <p className="mt-auto text-body text-fg-muted">{intro}</p>
          <div className="flex flex-col items-start gap-1.5">
            {starters.map((starter) => (
              <button
                key={starter}
                type="button"
                onClick={() => send(starter)}
                className="rounded-control bg-surface-2 px-3 py-1.5 text-left text-xs text-fg-muted hover:bg-hover hover:text-fg"
              >
                {starter}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ol
          ref={listRef}
          aria-label="Chat"
          onScroll={(event) => {
            const list = event.currentTarget;
            pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
          }}
          className="roll-away-list flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 py-4 select-text"
        >
          {chat.entries.map((entry) => (
            <li key={entry.id} className="flex flex-col">
              {entry.role === 'user' ? (
                <ChatMessage
                  text={entry.text}
                  above={me && <Avatar author={me} size={20} nativeTitle={false} />}
                  onCopied={(ok) =>
                    toast(ok ? 'Nachricht kopiert' : 'Nicht kopiert', ok ? undefined : 'danger')
                  }
                />
              ) : (
                <ChatAnswer
                  entry={entry}
                  above={
                    <>
                      <Icon name="autoAwesome" size={16} className="shrink-0" />
                      <span className="truncate">{title}</span>
                    </>
                  }
                  renderText={renderText}
                  copyText={copyText}
                  onCopied={(ok) =>
                    toast(ok ? 'Antwort kopiert' : 'Nicht kopiert', ok ? undefined : 'danger')
                  }
                />
              )}
            </li>
          ))}
        </ol>
      )}

      <form
        aria-label={`Nachricht an ${aiInSentence(title)}`}
        onSubmit={(event) => {
          event.preventDefault();
          send(body);
        }}
        className="shrink-0 border-t border-hairline p-3"
      >
        <div className="glass-elevated flex items-end gap-0.5 rounded-control py-1 pr-1 pl-3">
          <div className="flex min-w-0 flex-1 flex-col py-[5px]">
            <AutosizeTextarea
              ref={fieldRef}
              aria-label="Nachricht"
              placeholder={`Frag ${aiInSentence(title)} …`}
              maxLength={MAX_MATERIAL_CHAT_MESSAGE}
              maxHeight={160}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                // Esc closes the chat from its field too (the page's keys never see it here).
                if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  onClose();
                  return;
                }
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing)
                  return;
                event.preventDefault();
                send(body);
              }}
              className="text-body leading-4.5 text-fg placeholder:text-fg-subtle"
            />
          </div>
          {chat.busy ? (
            <IconButton
              icon="stop"
              label="Stoppen"
              size="compact"
              onClick={() => {
                chat.stop();
                toField();
              }}
            />
          ) : (
            <IconButton
              type="submit"
              icon="arrowUpward"
              label="Senden"
              title="Senden (Enter)"
              size="compact"
              iconTone={body.trim() ? 'success' : undefined}
              disabled={!body.trim()}
            />
          )}
        </div>
      </form>
    </SidePanel>
  );
}

/**
 * The copy button of a message or an answer: small, in its head line beside who wrote it, and
 * shown only while one is over the message or on the button (always where nothing hovers).
 */
function CopyButton({
  label,
  text,
  onCopied,
}: {
  label: string;
  text: () => string;
  onCopied: (ok: boolean) => void;
}) {
  return (
    <IconButton
      icon="contentCopy"
      label={label}
      size="xs"
      iconSize={14}
      className="opacity-0 transition-opacity group-hover/message:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
      onClick={() => {
        navigator.clipboard
          .writeText(text())
          .then(() => onCopied(true))
          .catch(() => onCopied(false));
      }}
    />
  );
}

/**
 * A person's message in the chat: above its bubble who wrote it (`above`: their picture) and
 * the same copy button an answer has – to send it again, or elsewhere.
 */
export function ChatMessage({
  text,
  above,
  onCopied,
}: {
  text: string;
  above?: ReactNode;
  onCopied: (ok: boolean) => void;
}) {
  return (
    <div className="group/message ml-8 flex flex-col items-end gap-1 self-end [--roll-from:100%_0] *:roll-away">
      <div className="flex min-h-6 items-center gap-1.5 text-xs text-fg-subtle">
        <CopyButton label="Nachricht kopieren" text={() => text} onCopied={onCopied} />
        {above}
      </div>
      <p className="rounded-panel bg-surface-2 px-3 py-2 text-body leading-[1.45] break-words whitespace-pre-wrap text-fg">
        {text}
      </p>
    </div>
  );
}

/** The AI's answer in the chat: who answers (`above`), its text, what it does while it writes. */
export function ChatAnswer({
  entry,
  above,
  renderText,
  copyText,
  onCopied,
}: {
  entry: ChatEntry;
  above?: ReactNode;
  renderText?: (run: string) => ReactNode;
  copyText?: (text: string) => string;
  onCopied: (ok: boolean) => void;
}) {
  const writing = entry.state === 'answering';
  // While it is written, a source half come is left out until it is whole.
  const text = writing ? entry.text.replace(/\[\[[^\]]*\]?$/, '') : entry.text;
  const rich = useMemo(() => (text.trim() ? markdownToRich(text) : null), [text]);
  return (
    <article aria-label="Antwort der KI" className="group/message flex flex-col gap-2">
      <div className="roll-away -mb-1 flex min-h-6 min-w-0 items-center gap-1.5 text-xs text-fg-subtle">
        {above}
        {!writing && entry.text.trim() && (
          <CopyButton
            label="Antwort kopieren"
            text={() => (copyText ? copyText(entry.text) : entry.text)}
            onCopied={onCopied}
          />
        )}
      </div>
      {rich && (
        <RichText
          rich={rich}
          className="flex flex-col gap-2 text-body leading-[1.45] break-words text-fg *:roll-away [&_li+li]:mt-1"
          {...(renderText ? { renderText } : {})}
        />
      )}
      {writing && (
        <div className="roll-away flex items-center gap-2">
          <p
            className="flex min-w-0 flex-1 items-center gap-2 text-caption text-fg-subtle"
            aria-live="polite"
          >
            {entry.reading && entry.readingIn === 'slider' ? (
              <LogoMark width={14} className="shrink-0 animate-pulse" />
            ) : (
              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-fg-subtle" />
            )}
            <span className="truncate">
              {entry.reading ?? (rich ? 'Schreibt …' : 'Denkt nach …')}
            </span>
          </p>
        </div>
      )}
      {entry.state === 'stopped' && (
        <p className="roll-away text-caption text-fg-subtle">Gestoppt</p>
      )}
      {entry.error && <p className="roll-away text-caption text-danger">{entry.error}</p>}
    </article>
  );
}
