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
  type Attachment,
  type WriterAiProposal,
  type WriterAnchor,
  type WriterComment,
} from '@slider/shared';
import {
  AttachButton,
  AttachmentChips,
  SentAttachments,
  useAttachments,
} from '@/features/attachments';
import { accentAlpha, accentColor } from '@/lib/accent';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { isModEnter } from '@/lib/keyboard';
import { isApplePlatform } from '@/lib/platform';
import {
  Avatar,
  Button,
  cn,
  ConfirmDialog,
  IconButton,
  ContextMenu,
  Menu,
  Notice,
  Spinner,
  type MenuAction,
  selectedOutlineClass,
} from '@/ui';
import type { DocumentComments, Thread } from './comments';
import { useWriter } from './session';
import {
  CommentBody,
  MentionMenu,
  MentionTextarea,
  ReactionChipsOf,
  ReactionPickerOf,
  reactionMenuActions,
  reactionState,
  useMentions,
  useReplyDraftBody,
} from '@/features/viewer';

/** A thread, or the comment being written, and where its words stand (px from the sheets' top). */
export interface Placed {
  key: string;
  top: number;
  thread?: Thread;
  draft?: WriterAnchor;
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
 * The AI's answer under the comment handed to it – as on a slide (`AiProposalCard`): at work,
 * failed, stopped, or what it changed in the text, written at once. One icon stops it, takes
 * the change back, applies it again or asks once more; for who may write, everyone sees it.
 */
function AiAnswer({
  proposal,
  comments,
}: {
  proposal: WriterAiProposal;
  comments: DocumentComments;
}) {
  const { document } = useWriter();
  const canEdit = document.permissions.canEdit;
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
        {canEdit && status === 'running' && (
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
            label="Änderung zurücknehmen"
            variant="subtle"
            size="compact"
            onClick={() => comments.moveAi(proposal.id, 'revert')}
            className="ml-auto"
          />
        )}
        {canEdit && reverted && (
          <IconButton
            icon="redo"
            label="Wieder anwenden"
            variant="subtle"
            size="compact"
            onClick={() => comments.moveAi(proposal.id, 'reapply')}
            className="ml-auto"
          />
        )}
        {canEdit && (status === 'failed' || stopped) && (
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
          Arbeitet am Text
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
function Entry(props: { comment: WriterComment; comments: DocumentComments; isRoot: boolean }) {
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
  comment: WriterComment;
  comments: DocumentComments;
  isRoot: boolean;
}) {
  const { me, document } = useWriter();
  const [editing, setEditing] = useState<string | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const editMentions = useMentions(editing ?? '', setEditing, editRef);
  const [deleting, setDeleting] = useState(false);
  const own = comment.author.id === me.id;
  const done = comment.status === 'done';
  // Not while the AI is at work on it already – as on a slide.
  const aiAtWork = comments.proposals.some(
    (proposal) => proposal.commentId === comment.id && proposal.status === 'running',
  );
  const [contextAt, setContextAt] = useState<{ x: number; y: number } | null>(null);
  // 👍 / 👎 / egal, as on a slide: chips under the text, the picker over the author line, the menu.
  const reaction = reactionState(
    comment.reactions ?? [],
    me.id,
    document.permissions.canComment,
    (kind) => comments.react(comment.id, kind),
  );
  const actions: MenuAction[] = [
    ...(isRoot && document.permissions.canComment
      ? [
          {
            label: done ? 'Wieder öffnen' : 'Erledigt',
            icon: done ? 'undo' : 'check',
            onSelect: () => comments.setStatus(comment.id, done ? 'open' : 'done'),
          } satisfies MenuAction,
        ]
      : []),
    ...reactionMenuActions(reaction),
    ...(document.permissions.canEdit && !aiAtWork
      ? [
          {
            label: 'An die KI geben',
            icon: 'autoAwesome',
            onSelect: () => comments.askAi(comment.id),
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
    <div
      className="group/message relative flex flex-col gap-1.5"
      // A right click: its actions at the pointer, as on a slide; ⇧ keeps the browser's menu.
      onContextMenu={(event) => {
        if (event.shiftKey || actions.length === 0 || editing !== null) return;
        event.preventDefault();
        // A reply in a thread: the innermost comment's menu.
        event.stopPropagation();
        setContextAt({ x: event.clientX, y: event.clientY });
      }}
    >
      {contextAt && (
        <ContextMenu
          label={`Aktionen für den Kommentar von ${comment.author.name}`}
          actions={actions}
          at={contextAt}
          onClose={() => setContextAt(null)}
        />
      )}
      <header className="flex min-w-0 items-center gap-2">
        <Avatar author={comment.author} size={24} />
        <span className="min-w-0 truncate text-xs font-medium text-fg">{comment.author.name}</span>
        <time
          title={formatDateTime(comment.createdAt)}
          className="min-w-0 shrink-[4] truncate text-caption text-fg-subtle"
        >
          {formatRelativeTime(comment.createdAt)}
        </time>
        <span className="relative -ml-2 shrink-0 self-stretch">
          <ReactionPickerOf state={reaction} floating />
        </span>
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
        <>
          {comment.body && <CommentBody body={comment.body} className="leading-5" />}
          <SentAttachments attachments={comment.attachments} />
          <ReactionChipsOf state={reaction} />
        </>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-2">
          <div className="field-well focus-field relative min-w-0 rounded-control-sm px-3 py-2">
            <MentionMenu mentions={editMentions} />
            <MentionTextarea
              {...editMentions.fieldProps}
              ref={editRef}
              autoFocus
              aria-label="Kommentar bearbeiten"
              value={editing}
              maxHeight={200}
              onKeyDown={(event) => {
                if (editMentions.onKeyDown(event)) return;
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
  draftKey,
}: {
  /** A reply's thread: its unsent text is kept while the thread is closed, as on a slide. */
  draftKey?: string;
  placeholder: string;
  label: string;
  autoFocus?: boolean;
  /** `toAi`: sent and handed to the AI in one (✨, ⌘↵) – where one may write. */
  onSend: (body: string, toAi: boolean, attachments: Attachment[]) => void;
  onCancel?: () => void;
}) {
  const { document, notify } = useWriter();
  const attach = useAttachments({
    workspaceId: document.workspaceId,
    keep: draftKey && `writer:${draftKey}`,
    onError: (message) => notify(message, 'danger'),
  });
  const canAsk = document.permissions.canEdit;
  const [own, setOwn] = useState('');
  const [kept, setKept] = useReplyDraftBody(draftKey ?? '');
  const [text, setText] = draftKey ? [kept, setKept] : [own, setOwn];
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const mentions = useMentions(text, setText, fieldRef);
  const files = attach.ready;
  const sendable = (text.trim() !== '' || files.length > 0) && !attach.busy;
  const send = (event?: SyntheticEvent, toAi = false) => {
    event?.preventDefault();
    const body = text.trim();
    if (!sendable) return;
    setText('');
    attach.clear();
    onSend(body, toAi && canAsk, files);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || mentions.onKeyDown(event)) return;
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
      className={cn(
        'field-well focus-field relative flex min-h-9 min-w-0 items-end gap-0.5 rounded-control-sm py-1 pr-1 pl-3',
        attach.items.length > 0 && 'flex-wrap justify-end',
      )}
    >
      <MentionMenu mentions={mentions} />
      <div
        className={cn('min-w-0 flex-1 self-center', attach.items.length > 0 && 'basis-full pr-2')}
      >
        <MentionTextarea
          {...mentions.fieldProps}
          ref={fieldRef}
          autoFocus={autoFocus}
          aria-label={label}
          placeholder={placeholder}
          value={text}
          maxHeight={160}
          rows={1}
          onKeyDown={onKeyDown}
          onPaste={attach.onPaste}
          className="w-full resize-none bg-transparent text-body leading-5 text-fg outline-none placeholder:text-fg-subtle"
        />
        <AttachmentChips files={attach} className="pt-2 pb-1" />
      </div>
      <AttachButton files={attach} />
      {canAsk && (
        <IconButton
          icon="autoAwesome"
          label="Senden und die KI den Text ändern lassen"
          title={`Senden und an die KI geben (${isApplePlatform() ? '⌘' : 'Strg'}↵)`}
          size="compact"
          disabledStyle="dim"
          disabled={!sendable}
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
        disabled={!sendable}
      />
    </form>
  );
}

export function CommentColumn({
  side,
  items,
  width,
  height,
  active,
  onActivate,
  comments,
  onDraftSent,
  onDraftCancel,
  overlay = false,
  selected,
  onSelect,
  onSelectionMenu,
}: {
  /** Threads picked with ⌘/⇧-click for actions on several at once, as under the slides. */
  selected: ReadonlySet<string>;
  onSelect: (id: string) => void;
  /** A right click on one of several picked: their actions there. */
  onSelectionMenu: (at: { x: number; y: number }) => void;
  side: 'left' | 'right';
  items: readonly Placed[];
  width: number;
  height: number;
  active: string | null;
  onActivate: (id: string | null) => void;
  comments: DocumentComments;
  onDraftSent: (
    body: string,
    anchor: WriterAnchor,
    toAi: boolean,
    attachments: Attachment[],
  ) => void;
  onDraftCancel: () => void;
  /** No room beside the page: the cards lie over it, the page under them stays in reach. */
  overlay?: boolean;
}) {
  const { me, document } = useWriter();
  const ref = useRef<HTMLDivElement>(null);

  // Each card at its words, the next one below it where two would lie on each other.
  useLayoutEffect(() => {
    const column = ref.current;
    if (!column) return;
    const place = () => {
      let floor = 0;
      for (const card of column.querySelectorAll<HTMLElement>('[data-card]')) {
        const top = Math.max(Number(card.dataset.top) || 0, floor);
        card.style.top = `${top}px`;
        floor = top + card.offsetHeight + GAP;
      }
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
      aria-label={side === 'left' ? 'Kommentare links der Seite' : 'Kommentare rechts der Seite'}
      role="group"
      className={cn(
        overlay
          ? 'pointer-events-none absolute top-16 right-4 z-(--z-chrome) *:pointer-events-auto'
          : 'relative shrink-0',
      )}
      style={{ width, height }}
    >
      {items.map((item) => {
        const thread = item.thread;
        if (item.draft) {
          const anchor = item.draft;
          return (
            <div
              key={item.key}
              data-card
              data-top={item.top}
              className="glass-elevated absolute inset-x-0 z-(--z-chrome) flex animate-pop-in flex-col gap-2.5 rounded-panel p-3"
              style={{
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
                onSend={(body, toAi, attachments) => onDraftSent(body, anchor, toAi, attachments)}
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
            data-top={item.top}
            data-thread={thread.root.id}
            className={cn(
              'absolute inset-x-0 transition-[top,opacity] duration-150',
              isActive && 'z-(--z-chrome)',
              done && !isActive && 'opacity-60',
            )}
            style={{ '--card-accent': accentColor(thread.root.author.color) } as CSSProperties}
            data-selected={selected.has(thread.root.id) || undefined}
            onMouseDown={(event) => {
              // ⌘/⇧-click – or any click while some are picked – picks it, as the decks do.
              if (
                event.button === 0 &&
                (event.metaKey || event.ctrlKey || event.shiftKey || selected.size > 0)
              ) {
                event.preventDefault();
                onSelect(thread.root.id);
                return;
              }
              onActivate(thread.root.id);
            }}
            onClickCapture={(event) => {
              if (selected.size > 0 || event.metaKey || event.ctrlKey || event.shiftKey) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            onFocus={() => selected.size === 0 && onActivate(thread.root.id)}
            onContextMenuCapture={(event) => {
              if (event.shiftKey || selected.size < 2 || !selected.has(thread.root.id)) return;
              event.preventDefault();
              event.stopPropagation();
              onSelectionMenu({ x: event.clientX, y: event.clientY });
            }}
          >
            <div
              className={cn(
                'glass relative flex flex-col gap-3 rounded-panel px-3.5 py-3 transition-[background-color,box-shadow] duration-200',
                isActive
                  ? 'shadow-[inset_0_0_0_1px_var(--card-accent),0_0_20px_color-mix(in_srgb,var(--card-accent)_50%,transparent)]!'
                  : 'cursor-pointer hover:bg-glass-hover',
                selected.has(thread.root.id) && selectedOutlineClass,
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
                  draftKey={`document-reply:${thread.root.id}`}
                  label="Antwort senden"
                  placeholder="Antworten …"
                  onSend={(body, toAi, attachments) =>
                    comments.add(body, null, thread.root.id, toAi, attachments)
                  }
                />
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
