import { MAX_MATERIAL_CHAT_MESSAGE, markdownToRich, type Material } from '@slider/shared';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AutosizeTextarea, Icon, IconButton, useFocusLoop, type Avatar } from '@/ui';
import { SidePanel, SidePanelHeader } from '../components/SidePanel';
import { useRestoreFocus } from '../hooks/useRestoreFocus';
import { useViewerToast } from '../state/viewer-toast';
import { useMaterialChat, type ChatEntry } from './material-chat';
import { withoutSources } from './note-answers';
import { onMaterialPage } from './material-page';
import { WithSources } from './NoteAnswer';
import { RichText } from './rich-text';

/*
 * The AI on the material page (✨ in its controls): a chat in the deck's side panel, as with
 * Claude or ChatGPT – it reads the material, searches the web and puts what it finds on the
 * board. The chat itself: `material-chat.ts`; the AI's side: `services/material-chat.ts`.
 */

/** Ways in while the chat is empty – each sent as it reads. */
const STARTERS = [
  'Fasse das Material zusammen',
  'Recherchiere aktuelle Zahlen zum Thema und leg die Quellen aufs Board',
  'Schreib eine Gliederung für die Präsentation als Notiz',
];

export interface MaterialChatProps {
  deckId: string;
  ai: Parameters<typeof Avatar>[0]['author'];
  /** The deck's files by id: an answer's sources. */
  byId: ReadonlyMap<string, Material>;
  openSource: (material: Material, page: number | null) => void;
  onClose: () => void;
}

export const MaterialChat = (props: MaterialChatProps) =>
  onMaterialPage(<MaterialChatView {...props} />);

function MaterialChatView({ deckId, ai, byId, openSource, onClose }: MaterialChatProps) {
  const toast = useViewerToast();
  const panelRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const [body, setBody] = useState('');
  const chat = useMaterialChat(deckId, (message) => toast(message, 'danger'));
  useRestoreFocus();
  useFocusLoop(panelRef);
  useEffect(() => fieldRef.current?.focus({ preventScroll: true }), []);

  // Follows the answer while it is written, unless one scrolled up to read.
  const last = chat.entries.at(-1);
  const pinned = useRef(true);
  useEffect(() => {
    const list = listRef.current;
    if (list && pinned.current) list.scrollTop = list.scrollHeight;
  }, [last?.text, last?.reading, chat.entries.length]);

  const send = (text: string) => {
    if (!text.trim() || chat.busy) return;
    setBody('');
    pinned.current = true;
    void chat.send(text).then((sent) => {
      if (!sent) setBody((now) => now || text);
    });
  };

  return (
    <SidePanel ref={panelRef} data-board-panel data-material-chat aria-labelledby={titleId}>
      <SidePanelHeader>
        <div className="flex items-center gap-2">
          <Icon name="autoAwesome" size={18} className="shrink-0 text-fg-muted" />
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
            {ai.name}
          </h2>
          {chat.entries.length > 0 && (
            <IconButton icon="add" label="Neuer Chat" size="sm" onClick={chat.clear} />
          )}
          <IconButton icon="close" label="KI schließen (Esc)" size="sm" onClick={onClose} />
        </div>
      </SidePanelHeader>

      {chat.entries.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-y-auto px-5 py-4">
          <p className="text-body text-fg-muted">
            Frag die KI zum Material: Sie liest die Dateien, recherchiert im Web und legt Ergebnisse
            als Notizen, Links oder Dateien aufs Board.
          </p>
          <div className="flex flex-col items-start gap-1.5">
            {STARTERS.map((starter) => (
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
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 py-4 select-text"
        >
          {chat.entries.map((entry) => (
            <li key={entry.id} className="flex flex-col">
              {entry.role === 'user' ? (
                <p className="ml-8 self-end rounded-panel bg-surface-2 px-3 py-2 text-body leading-[1.45] break-words whitespace-pre-wrap text-fg">
                  {entry.text}
                </p>
              ) : (
                <ChatAnswer
                  entry={entry}
                  byId={byId}
                  openSource={openSource}
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
        aria-label="Nachricht an die KI"
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
              placeholder="Frag die KI …"
              maxLength={MAX_MATERIAL_CHAT_MESSAGE}
              maxHeight={160}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing)
                  return;
                event.preventDefault();
                send(body);
              }}
              className="text-body leading-4.5 text-fg placeholder:text-fg-subtle"
            />
          </div>
          {chat.busy ? (
            <IconButton icon="stop" label="Stoppen" size="compact" onClick={chat.stop} />
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

/** The AI's answer in the chat: its text with sources as chips, what it does while it writes. */
function ChatAnswer({
  entry,
  byId,
  openSource,
  onCopied,
}: {
  entry: ChatEntry;
  byId: ReadonlyMap<string, Material>;
  openSource: (material: Material, page: number | null) => void;
  onCopied: (ok: boolean) => void;
}) {
  const writing = entry.state === 'answering';
  // While it is written, a source half come is left out until it is whole.
  const text = writing ? entry.text.replace(/\[\[[^\]]*\]?$/, '') : entry.text;
  const rich = useMemo(() => (text.trim() ? markdownToRich(text) : null), [text]);
  return (
    <article aria-label="Antwort der KI" className="flex flex-col gap-2">
      {rich && (
        <RichText
          rich={rich}
          className="flex flex-col gap-2 text-body leading-[1.45] break-words text-fg [&_li+li]:mt-1"
          renderText={(run) => <WithSources text={run} byId={byId} onOpen={openSource} />}
        />
      )}
      {writing && (
        <div className="flex items-center gap-2">
          <p
            className="flex min-w-0 flex-1 items-center gap-2 text-caption text-fg-subtle"
            aria-live="polite"
          >
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-fg-subtle" />
            <span className="truncate">
              {entry.reading ?? (rich ? 'Schreibt …' : 'Denkt nach …')}
            </span>
          </p>
        </div>
      )}
      {entry.state === 'stopped' && <p className="text-caption text-fg-subtle">Gestoppt</p>}
      {entry.error && <p className="text-caption text-danger">{entry.error}</p>}
      {!writing && entry.text.trim() && (
        <div className="-mt-1 -ml-1.5 flex items-center">
          <IconButton
            icon="contentCopy"
            label="Antwort kopieren"
            size="sm"
            onClick={() => {
              navigator.clipboard
                .writeText(withoutSources(entry.text, byId))
                .then(() => onCopied(true))
                .catch(() => onCopied(false));
            }}
          />
        </div>
      )}
    </article>
  );
}
