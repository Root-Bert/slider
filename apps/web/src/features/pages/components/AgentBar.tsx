import type { WriterAiProposal, WriterAnchor } from '@slider/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { AttachButton, AttachmentChips, useAttachments } from '@/features/attachments';
import { canRecord, RecorderPanel } from '@/features/viewer';
import {
  fetchDocumentAiProposals,
  moveDocumentAiProposal,
  stopDocumentAiProposal,
  suggestVideoCuts,
  writerKeys,
} from '@/lib/api';
import { isModEnter } from '@/lib/keyboard';
import {
  AI_ICON,
  AutosizeTextarea,
  Button,
  cn,
  Icon,
  IconButton,
  PopoverPanel,
  Spinner,
  useFocusLoop,
} from '@/ui';
import { askPageAi } from '../lib/agent';

/*
 * The page's agent: a bar floating at the bottom while the page is written in. What is typed
 * there (with files or a video put on it) goes to the document's AI as a comment at the caret, as
 * Writer's ✨ does; its change comes in as a step like anyone's typing and is one step to take
 * back („Rückgängig“). Speaking: the microphone turns the bar into the voice bar (`voice`). On
 * Notizen it stands without a page: what is sent makes a new note and is asked there (`onAsk`).
 */

const BUSY = new Set<WriterAiProposal['status']>(['running']);

/**
 * As wide as the page column allows, centred over it – not over the window with the side bar.
 * Measured after the commit (not in a layout effect): the column's ref is set after its children's.
 */
function useColumn(frame: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setBox({ left: rect.left + rect.width / 2, width: rect.width });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [frame]);
  return box;
}

function videoFile(blob: Blob): File {
  const type = blob.type.split(';')[0]?.trim() || 'video/webm';
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}`;
  return new File([blob], `Aufnahme ${stamp}.${type === 'video/mp4' ? 'mp4' : 'webm'}`, { type });
}

export interface AgentBarProps {
  workspaceId: string;
  /** The page's document; `null` on Notizen, where `onAsk` makes the note. */
  documentId: string | null;
  /** Where what is typed and put on is kept until sent. */
  keep: string;
  placeholder: string;
  notify: (message: string, tone: 'danger') => void;
  /** The page's column: the bar stands centred under it. */
  frame: RefObject<HTMLElement | null>;
  /** What is typed in the page, sent now: the AI reads the file. */
  flush?: () => void;
  /** The caret or the words picked in the page, in the file's lines. */
  anchor?: () => WriterAnchor | null;
  /** Back into the page (Esc). */
  onLeave?: () => void;
  /** Sent somewhere else (Notizen: a new note made and asked there); resolves once it is. */
  onAsk?: (ask: { body: string; attachments: string[] }, commented: () => void) => Promise<void>;
  /** Asked before the page opened (a note made from Notizen): how it goes is shown. */
  asked?: string | null;
  /** The microphone's button and, while one speaks, the voice bar in the field's place. */
  voice?: { button: ReactNode; bar: ReactNode | null };
}

export function AgentBar({
  workspaceId,
  documentId,
  keep: draft,
  placeholder,
  notify,
  frame,
  flush,
  anchor,
  onLeave,
  onAsk,
  asked: askedBefore = null,
  voice,
}: AgentBarProps) {
  const queryClient = useQueryClient();
  const column = useColumn(frame);
  const attach = useAttachments({
    workspaceId,
    keep: draft,
    onError: (message) => notify(message, 'danger'),
  });
  const [text, setText] = useState('');
  const [asking, setAsking] = useState(false);
  const [askedId, setAskedId] = useState<string | null>(askedBefore);
  const [filming, setFilming] = useState(false);
  const filmRef = useRef<HTMLElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  useFocusLoop(filmRef, filming);

  const aiKey = writerKeys.aiProposals(documentId ?? '');
  const proposals = useQuery({
    queryKey: aiKey,
    queryFn: () => fetchDocumentAiProposals(documentId!),
    enabled: askedId !== null && documentId !== null,
    // The page's live stream tells when it is done; asked again now and then in case it did not.
    refetchInterval: (query) =>
      query.state.data?.some((each) => each.id === askedId && BUSY.has(each.status))
        ? 2_000
        : false,
  });
  const asked = proposals.data?.find((each) => each.id === askedId) ?? null;
  const keep = (saved: WriterAiProposal) =>
    queryClient.setQueryData<WriterAiProposal[]>(aiKey, (list) => [
      ...(list ?? []).filter((each) => each.id !== saved.id),
      saved,
    ]);

  const files = attach.ready;
  const sendable = (text.trim() !== '' || files.length > 0) && !attach.busy && !asking;
  const send = async () => {
    if (!sendable) return;
    const body = text.trim();
    const attachments = files.map((one) => one.id);
    setAsking(true);
    try {
      if (onAsk) {
        await onAsk({ body, attachments }, attach.clear);
      } else if (documentId) {
        // The AI reads the file: what was typed a moment ago goes first.
        flush?.();
        const proposal = await askPageAi(
          documentId,
          { body, attachments, anchor: anchor?.() ?? null },
          attach.clear,
        );
        keep(proposal);
        setAskedId(proposal.id);
      }
      setText('');
    } catch (error) {
      // Refused: the words stay to send again.
      notify(error instanceof Error ? error.message : 'Die KI ist nicht erreichbar.', 'danger');
    } finally {
      setAsking(false);
    }
  };
  const act = (request: Promise<WriterAiProposal>, failed: string) =>
    request.then(keep, (error: unknown) =>
      notify(`${failed}: ${error instanceof Error ? error.message : 'nicht erreichbar'}`, 'danger'),
    );

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onLeave?.();
    } else if (isModEnter(event) || (event.key === 'Enter' && !event.shiftKey)) {
      event.preventDefault();
      void send();
    }
  };

  const working = asking || (asked !== null && BUSY.has(asked.status));
  const name = asked?.author.name ?? 'Die KI';
  const status: ReactNode =
    asking && !asked ? null : asked?.status === 'running' ? (
      <>
        <span className="min-w-0 flex-1 truncate">{name} ändert die Seite …</span>
        <Button
          variant="ghost"
          size="sm"
          icon="stop"
          onClick={() => void act(stopDocumentAiProposal(asked.id), 'Nicht abgebrochen')}
        >
          Stopp
        </Button>
      </>
    ) : asked?.status === 'applied' || asked?.status === 'answered' ? (
      <>
        <span className="min-w-0 flex-1 line-clamp-2">{asked.summary || 'Erledigt.'}</span>
        {asked.status === 'applied' && (
          <Button
            variant="ghost"
            size="sm"
            icon="undo"
            onClick={() =>
              void act(moveDocumentAiProposal(asked.id, 'revert'), 'Nicht zurückgenommen')
            }
          >
            Rückgängig
          </Button>
        )}
      </>
    ) : asked?.status === 'reverted' ? (
      <>
        <span className="min-w-0 flex-1 truncate">Zurückgenommen.</span>
        <Button
          variant="ghost"
          size="sm"
          icon="redo"
          onClick={() => void act(moveDocumentAiProposal(asked.id, 'reapply'), 'Nicht angewendet')}
        >
          Wieder anwenden
        </Button>
      </>
    ) : asked?.status === 'failed' ? (
      <span className="min-w-0 flex-1 text-danger">{asked.error ?? 'Das hat nicht geklappt.'}</span>
    ) : asked?.status === 'stopped' ? (
      <span className="min-w-0 flex-1">Abgebrochen.</span>
    ) : null;

  if (!column) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-4 z-(--z-chrome) flex -translate-x-1/2 justify-center"
      style={{ left: column.left, width: Math.max(0, column.width - 32) }}
    >
      {voice?.bar ?? (
        <section
          aria-label="Agent"
          className="glass-elevated pointer-events-auto relative flex w-full max-w-[720px] flex-col rounded-panel p-1.5"
        >
          {filming && (
            <PopoverPanel
              ref={filmRef}
              as="section"
              aria-label="Video aufnehmen"
              side="top"
              align="end"
              padding="lg"
              className="w-[min(36rem,calc(100vw-2rem))]"
            >
              <RecorderPanel
                kind="video"
                autoFocus
                onChange={() => undefined}
                onDiscard={() => setFilming(false)}
                editor={{
                  doneLabel: 'Anhängen',
                  onDone: (recorded) => {
                    attach.add([videoFile(recorded)]);
                    setFilming(false);
                    fieldRef.current?.focus();
                  },
                  autoCut: (speech, signal) => suggestVideoCuts(workspaceId, speech, signal),
                }}
              />
            </PopoverPanel>
          )}
          {status && (
            <div
              role="status"
              className="flex min-h-9 items-center gap-2 border-b border-border-subtle px-2.5 pb-1.5 text-body text-fg-muted"
            >
              {status}
              <IconButton
                icon="close"
                label="Ausblenden"
                size="compact"
                onClick={() => setAskedId(null)}
              />
            </div>
          )}
          {
            <div className={cn('flex min-w-0 items-end gap-0.5', status && 'pt-1.5')}>
              <span className="flex size-8 shrink-0 items-center justify-center text-fg-subtle">
                {working ? <Spinner size={16} /> : <Icon name={AI_ICON} size={18} />}
              </span>
              <div className="min-w-0 flex-1 self-center">
                <AutosizeTextarea
                  ref={fieldRef}
                  aria-label="An die KI"
                  placeholder={placeholder}
                  value={text}
                  rows={1}
                  maxHeight={160}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={onKeyDown}
                  onPaste={attach.onPaste}
                  className="w-full resize-none bg-transparent py-1.5 text-body leading-5 text-fg outline-none placeholder:text-fg-subtle"
                />
                <AttachmentChips files={attach} className="pt-1 pb-1" />
              </div>
              <AttachButton files={attach} />
              {canRecord() && (
                <IconButton
                  icon="videocam"
                  label={filming ? 'Aufnahme schließen' : 'Video aufnehmen'}
                  title={
                    filming
                      ? 'Aufnahme schließen'
                      : 'Video aufnehmen – Bildschirm, Kamera oder beides'
                  }
                  aria-pressed={filming}
                  size="compact"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => setFilming((now) => !now)}
                />
              )}
              {voice?.button}
              <IconButton
                icon="arrowUpward"
                label="An die KI senden"
                title="Senden (Enter)"
                size="compact"
                iconTone="success"
                disabledStyle="dim"
                disabled={!sendable}
                onClick={() => void send()}
              />
            </div>
          }
        </section>
      )}
    </div>
  );
}
