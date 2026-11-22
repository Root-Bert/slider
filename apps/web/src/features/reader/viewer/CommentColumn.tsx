import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';
import {
  AI_RUNNING_LIMIT_MS,
  type ReaderAiProposal,
  type ReaderAnchor,
  type ReaderComment,
} from '@slider/shared';
import { accentAlpha, accentColor } from '@/lib/accent';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { isModEnter } from '@/lib/keyboard';
import { isApplePlatform } from '@/lib/platform';
import {
  AutosizeTextarea,
  Avatar,
  Button,
  cn,
  ConfirmDialog,
  IconButton,
  Menu,
  Notice,
  Spinner,
  type MenuAction,
} from '@/ui';
import type { PdfComments, Thread } from './comments';
import { useReader } from './session';

/**
 * A thread, or the comment being written, and where its words stand: px from the pages' top
 * beside them, from their left edge in the row under them.
 */
export interface Placed {
  key: string;
  at: number;
  thread?: Thread;
  draft?: ReaderAnchor;
}

const GAP = 8;

const clock = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/** How long the AI has been at it, of the time it has. */
function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = Math.min(Math.max(0, now - Date.parse(since)), AI_RUNNING_LIMIT_MS);
  return (
    <span
      className="ml-auto text-caption tabular-nums text-fg-subtle"
      title="Nach 10 Minuten wird der Auftrag gestoppt."
    >
      {clock(elapsed)} / {clock(AI_RUNNING_LIMIT_MS)}
    </span>
  );
}

/**
 * The AI's answer under the comment handed to it – as in Writer: at work, failed, stopped,
 * its answer, or the fields it filled in, written at once. One icon stops it, takes
 * the change back, applies it again or asks once more; for who may write, everyone sees it.
 */
function AiAnswer({ proposal, comments }: { proposal: ReaderAiProposal; comments: PdfComments }) {
  const { pdf } = useReader();
  const canEdit = pdf.permissions.canEdit;
  const canAsk = pdf.permissions.canComment;
  const { status } = proposal;
  const reverted = status === 'reverted';
  const stopped = status === 'stopped';
  return (
    <div
      data-ai-proposal={status}
      aria-busy={status === 'running' || undefined}
      className="flex flex-col gap-1.5"
    >
      <header className="flex min-w-0 items-center gap-2">
        <Avatar author={proposal.author} size={24} nativeTitle={false} />
        <span className="min-w-0 truncate text-xs font-medium text-fg">{proposal.author.name}</span>
        {reverted && <span className="text-caption text-fg-subtle">zurückgenommen</span>}
        {stopped && <span className="text-caption text-fg-subtle">abgebrochen</span>}
        {canAsk && status === 'running' && (
          <IconButton
            icon="stop"
            label="Auftrag abbrechen"
            variant="subtle"
            size="compact"
            onClick={() => comments.stopAi(proposal.id)}
            className="ml-auto"
          />
        )}
        {canEdit && status === 'applied' && (
          <IconButton
            icon="undo"
            label="Ausfüllen zurücknehmen"
            variant="subtle"
            size="compact"
            onClick={() => comments.moveAi(proposal.id, 'revert')}
            className="ml-auto"
          />
        )}
        {canEdit && reverted && (
          <IconButton
            icon="redo"
            label="Wieder ausfüllen"
            variant="subtle"
            size="compact"
            onClick={() => comments.moveAi(proposal.id, 'reapply')}
            className="ml-auto"
          />
        )}
        {canAsk && (status === 'failed' || stopped) && (
          <IconButton
            icon="refresh"
            label="Nochmal versuchen"
            variant="subtle"
            size="compact"
            onClick={() => comments.askAi(proposal.commentId)}
            className="ml-auto"
          />
        )}
      </header>
      {status === 'running' && (
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Spinner size="sm" />
          Liest das PDF
          <Elapsed since={proposal.createdAt} />
        </div>
      )}
      {status === 'failed' && (
        <Notice tone="danger" variant="plain" size="sm">
          {proposal.error ?? 'Das ging schief.'}
        </Notice>
      )}
      {proposal.summary && status !== 'failed' && (
        <p
          className={cn(
            'text-body leading-5 break-words whitespace-pre-wrap',
            reverted ? 'text-fg-subtle' : 'text-fg',
          )}
        >
          {proposal.summary}
        </p>
      )}
    </div>
  );
}

/** A comment with what the AI answered to it. */
function Entry(props: { comment: ReaderComment; comments: PdfComments; isRoot: boolean }) {
  const answers = props.comments.proposals.filter((each) => each.commentId === props.comment.id);
  return (
    <>
      <Message {...props} />
      {answers.map((proposal) => (
        <AiAnswer key={proposal.id} proposal={proposal} comments={props.comments} />
      ))}
    </>
  );
}

function Message({
  comment,
  comments,
  isRoot,
}: {
  comment: ReaderComment;
  comments: PdfComments;
  isRoot: boolean;
}) {
  const { me, pdf: document } = useReader();
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const own = comment.author.id === me.id;
  const done = comment.status === 'done';
  const actions: MenuAction[] = [
    ...(document.permissions.canComment
      ? [
          {
            label: 'An die KI geben',
            icon: 'autoAwesome',
            onSelect: () => comments.askAi(comment.id),
          } satisfies MenuAction,
        ]
      : []),
    ...(isRoot && document.permissions.canComment
      ? [
          {
            label: done ? 'Wieder öffnen' : 'Erledigt',
            icon: done ? 'undo' : 'check',
            onSelect: () => comments.setStatus(comment.id, done ? 'open' : 'done'),
          } satisfies MenuAction,
        ]
      : []),
    ...(own
      ? [
          {
            label: 'Bearbeiten',
            icon: 'edit',
            onSelect: () => setEditing(comment.body),
          } satisfies MenuAction,
        ]
      : []),
    ...(own || document.permissions.canManage
      ? [
          {
            label: 'Löschen',
            icon: 'delete',
            tone: 'danger',
            onSelect: () => setDeleting(true),
          } satisfies MenuAction,
        ]
      : []),
  ];
  const save = (event: SyntheticEvent) => {
    event.preventDefault();
    const body = editing?.trim();
    if (body && body !== comment.body) comments.edit(comment.id, body);
    setEditing(null);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <header className="flex min-w-0 items-center gap-2">
        <Avatar author={comment.author} size={24} />
        <span className="min-w-0 truncate text-xs font-medium text-fg">{comment.author.name}</span>
        <time
          title={formatDateTime(comment.createdAt)}
          className="min-w-0 shrink-[4] truncate text-caption text-fg-subtle"
        >
          {formatRelativeTime(comment.createdAt)}
        </time>
        <span className="ml-auto flex shrink-0 items-center">
          {isRoot && document.permissions.canComment && (
            <IconButton
              icon="check"
              label={done ? 'Erledigt' : 'Erledigen'}
              title={done ? 'Erledigt. Klicken zum Wiederöffnen' : 'Als erledigt markieren'}
              variant="subtle"
              size="compact"
              iconTone={done ? 'success' : undefined}
              aria-pressed={done}
              onClick={() => comments.setStatus(comment.id, done ? 'open' : 'done')}
            />
          )}
          {actions.length > 0 && (
            <Menu label="Aktionen für diesen Kommentar" triggerSize="compact" actions={actions} />
          )}
        </span>
      </header>
      {editing === null ? (
        <p className="text-body leading-5 break-words whitespace-pre-wrap text-fg">
          {comment.body}
        </p>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-2">
          <div className="field-well focus-field min-w-0 rounded-control-sm px-3 py-2">
            <AutosizeTextarea
              autoFocus
              aria-label="Kommentar bearbeiten"
              value={editing}
              maxHeight={200}
              onChange={(event) => setEditing(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setEditing(null);
                else if (event.key === 'Enter' && !event.shiftKey) save(event);
              }}
              className="w-full resize-none bg-transparent text-body leading-5 text-fg outline-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Abbrechen
            </Button>
            <Button type="submit" size="sm">
              Speichern
            </Button>
          </div>
        </form>
      )}
      {deleting && (
        <ConfirmDialog
          title="Kommentar löschen?"
          description={
            isRoot
              ? 'Der ganze Thread mit allen Antworten wird gelöscht.'
              : 'Das lässt sich nicht rückgängig machen.'
          }
          confirmLabel="Löschen"
          onClose={() => setDeleting(false)}
          onConfirm={() => {
            setDeleting(false);
            comments.remove(comment.id);
          }}
        />
      )}
    </div>
  );
}

function Field({
  placeholder,
  label,
  autoFocus,
  onSend,
  onCancel,
}: {
  placeholder: string;
  label: string;
  autoFocus?: boolean;
  /** `toAi`: sent and handed to the AI in one (✨, ⌘↵) – where one may write. */
  onSend: (body: string, toAi: boolean) => void;
  onCancel?: () => void;
}) {
  const { pdf } = useReader();
  const canAsk = pdf.permissions.canComment;
  const [text, setText] = useState('');
  const send = (event?: SyntheticEvent, toAi = false) => {
    event?.preventDefault();
    const body = text.trim();
    if (body === '') return;
    setText('');
    onSend(body, toAi && canAsk);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && onCancel) {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (isModEnter(event)) send(event, true);
    else if (event.key === 'Enter' && !event.shiftKey) send(event);
  };
  return (
    <form
      onSubmit={send}
      className="field-well focus-field flex min-h-9 min-w-0 items-end gap-0.5 rounded-control-sm py-1 pr-1 pl-3"
    >
      <AutosizeTextarea
        autoFocus={autoFocus}
        aria-label={label}
        placeholder={placeholder}
        value={text}
        maxHeight={160}
        rows={1}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        className="min-w-0 flex-1 resize-none self-center bg-transparent text-body leading-5 text-fg outline-none placeholder:text-fg-subtle"
      />
      {canAsk && (
        <IconButton
          icon="autoAwesome"
          label="Senden und an die KI geben"
          title={`Senden und an die KI geben (${isApplePlatform() ? '⌘' : 'Strg'}↵)`}
          size="compact"
          disabledStyle="dim"
          disabled={text.trim() === ''}
          onClick={() => send(undefined, true)}
        />
      )}
      <IconButton
        type="submit"
        icon="arrowUpward"
        label={label}
        title="Senden (Enter)"
        size="compact"
        iconTone="success"
        disabledStyle="dim"
        disabled={text.trim() === ''}
      />
    </form>
  );
}

export function CommentColumn({
  side,
  items,
  width,
  length,
  active,
  onActivate,
  comments,
  onDraftSent,
  onDraftCancel,
  overlay = false,
  axis = 'y',
}: {
  side: 'left' | 'right';
  items: readonly Placed[];
  /** The column's width; in a row, each card's. */
  width: number;
  /** How far the pages reach: the column's height, the row's width. */
  length: number;
  active: string | null;
  onActivate: (id: string | null) => void;
  comments: PdfComments;
  onDraftSent: (body: string, anchor: ReaderAnchor, toAi: boolean) => void;
  onDraftCancel: () => void;
  /** No room beside the page: the cards lie over it, the page under them stays in reach. */
  overlay?: boolean;
  /**
   * `y`: a column beside the pages, as in Writer; `x`: a row under pages lying side by side, as
   * in Slider – each card `width` wide, the row as tall as its tallest.
   */
  axis?: 'x' | 'y';
}) {
  const { me, pdf: document } = useReader();
  const ref = useRef<HTMLDivElement>(null);

  // Each card at its words, the next one after it where two would lie on each other.
  useLayoutEffect(() => {
    const column = ref.current;
    if (!column) return;
    const place = () => {
      let floor = 0;
      let tallest = 0;
      for (const card of column.querySelectorAll<HTMLElement>('[data-card]')) {
        const at = Math.max(Number(card.dataset.at) || 0, floor);
        if (axis === 'x') {
          card.style.left = `${at}px`;
          floor = at + card.offsetWidth + GAP;
          tallest = Math.max(tallest, card.offsetHeight);
        } else {
          card.style.top = `${at}px`;
          floor = at + card.offsetHeight + GAP;
        }
      }
      if (axis === 'x') column.style.height = `${tallest}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    for (const card of column.querySelectorAll('[data-card]')) observer.observe(card);
    return () => observer.disconnect();
  });

  return (
    <div
      ref={ref}
      data-chrome
      aria-label={
        axis === 'x'
          ? 'Kommentare unter den Seiten'
          : side === 'left'
            ? 'Kommentare links der Seite'
            : 'Kommentare rechts der Seite'
      }
      role="group"
      className={cn(
        overlay
          ? 'pointer-events-none absolute top-16 right-4 z-(--z-chrome) *:pointer-events-auto'
          : 'relative shrink-0',
      )}
      style={axis === 'x' ? { width: length } : { width, height: length }}
    >
      {items.map((item) => {
        const thread = item.thread;
        if (item.draft) {
          const anchor = item.draft;
          return (
            <div
              key={item.key}
              data-card
              data-at={item.at}
              className={cn(
                'glass-elevated absolute z-(--z-chrome)',
                axis === 'x' ? 'top-0' : 'inset-x-0',
                'flex animate-pop-in flex-col gap-2.5 rounded-panel p-3',
              )}
              style={{
                ...(axis === 'x' && { width }),
                boxShadow: `inset 0 0 0 1px ${accentAlpha(me.color, 90)}, 0 0 32px ${accentAlpha(me.color, 35)}, var(--shadow-float)`,
              }}
            >
              <header className="flex min-w-0 items-center gap-2 text-xs font-medium text-fg">
                <Avatar author={me} size={24} />
                <span className="min-w-0 truncate">{me.name}</span>
                <span className="font-normal text-fg-subtle">jetzt</span>
              </header>
              <Field
                autoFocus
                label="Kommentar senden"
                placeholder="Kommentieren …"
                onSend={(body, toAi) => onDraftSent(body, anchor, toAi)}
                onCancel={onDraftCancel}
              />
              <div className="flex justify-start">
                <Button variant="ghost" size="sm" onClick={onDraftCancel}>
                  Abbrechen
                </Button>
              </div>
            </div>
          );
        }
        if (!thread) return null;
        const isActive = active === thread.root.id;
        const done = thread.root.status === 'done';
        return (
          <article
            key={item.key}
            data-card
            data-at={item.at}
            data-thread={thread.root.id}
            className={cn(
              'absolute',
              axis === 'x'
                ? 'top-0 transition-[left,opacity]'
                : 'inset-x-0 transition-[top,opacity]',
              'duration-150',
              isActive && 'z-(--z-chrome)',
              done && !isActive && 'opacity-60',
            )}
            style={
              {
                ...(axis === 'x' && { width }),
                '--card-accent': accentColor(thread.root.author.color),
              } as CSSProperties
            }
            onMouseDown={() => onActivate(thread.root.id)}
            onFocus={() => onActivate(thread.root.id)}
          >
            <div
              className={cn(
                'glass relative flex flex-col gap-3 rounded-panel px-3.5 py-3 transition-[background-color,box-shadow] duration-200',
                isActive
                  ? 'shadow-[inset_0_0_0_1px_var(--card-accent),0_0_20px_color-mix(in_srgb,var(--card-accent)_50%,transparent)]!'
                  : 'cursor-pointer hover:bg-glass-hover',
              )}
            >
              <Entry comment={thread.root} comments={comments} isRoot />
              {thread.replies.length > 0 && (
                <ol
                  aria-label="Antworten"
                  className="flex flex-col gap-3 border-l border-hairline-strong pl-3"
                >
                  {thread.replies.map((reply) => (
                    <li key={reply.id} className="flex flex-col gap-3">
                      <Entry comment={reply} comments={comments} isRoot={false} />
                    </li>
                  ))}
                </ol>
              )}
              {isActive && document.permissions.canComment && (
                <Field
                  label="Antwort senden"
                  placeholder="Antworten …"
                  onSend={(body, toAi) => comments.add(body, null, thread.root.id, toAi)}
                />
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
