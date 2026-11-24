import { SentAttachments } from '@/features/attachments';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  DELETED_ACCOUNT_NAME,
  MAX_SENDER_MESSAGE,
  type AccountAuthor,
  type CommentReactionKind,
  type SenderMessage,
} from '@slider/shared';
import { accentColor } from '@/lib/accent';
import { isPending } from '@/lib/api';
import { chatMatches, useMarkedMatches, useShowHit } from '@/lib/chat-search';
import { AgentAvatar, CallEntry } from '@/features/cloud';
import {
  AutosizeTextarea,
  Avatar,
  Badge,
  Button,
  cn,
  Icon,
  IconButton,
  useCopyToClipboard,
} from '@/ui';
import { dayKey, dayOf, stampOf, timeOf } from '../lib/time';
import { MessageText } from './MessageText';
import { ReplyQuote } from './ReplyQuote';
import {
  ReactionChipsOf,
  reactionMenuActions,
  reactionState,
  type ReactionState,
} from '@/features/viewer';

/** Messages of one author this close together stand as one block, under one name. */
const BLOCK_MS = 5 * 60_000;
/** Older messages are asked for this close to the top. */
const OLDER_PX = 240;
/** Closer to the end than this, the list follows what comes in. */
const PINNED_PX = 48;

const whoOf = (message: SenderMessage) =>
  message.agent ? `agent:${message.agent.id}` : (message.author?.id ?? 'gone');

/** Above a block: who wrote it, as small as in an agent's chat (an agent's mark a little larger). */
function Who({ message }: { message: SenderMessage }) {
  if (message.agent)
    return <AgentAvatar id={message.agent.id} size={22} className="rounded-mark" />;
  return (
    <Avatar
      author={message.author ?? { name: DELETED_ACCOUNT_NAME, type: 'deleted', color: 'deleted' }}
      size={20}
      nativeTitle={false}
    />
  );
}

function Editor({
  message,
  onSave,
  onCancel,
}: {
  message: SenderMessage;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(message.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);
  const save = () => {
    const trimmed = text.trim();
    if (!trimmed || trimmed === message.text) onCancel();
    else onSave(trimmed);
  };
  return (
    <div className="mt-1 flex flex-col gap-2">
      <div className="glass-elevated rounded-control px-3 py-[9px]">
        <AutosizeTextarea
          ref={ref}
          aria-label="Nachricht ändern"
          value={text}
          maxLength={MAX_SENDER_MESSAGE}
          maxHeight={240}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            } else if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              save();
            }
          }}
          className="text-body leading-4.5 text-fg"
        />
      </div>
      <div className="flex items-center gap-2 text-xs text-fg-subtle">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button size="sm" variant="primary" onClick={save}>
          Speichern
        </Button>
        <span className="max-sm:hidden">Esc bricht ab, Enter speichert</span>
      </div>
    </div>
  );
}

/**
 * A message's tools while the pointer is on it, in the line of its time and face – there from the
 * start, only unseen, so nothing moves. A message in a row under one name has no such line: the
 * same plain tools beside it on its free side.
 */
function Tools({
  message,
  own,
  mine,
  deletable,
  inLine,
  reaction,
  onReply,
  onEdit,
  onDelete,
}: {
  message: SenderMessage;
  own: boolean;
  mine: boolean;
  /** One's own, or anyone's where one manages the conversation. */
  deletable: boolean;
  /** In the line of its time and face (the first of a row); otherwise beside the message. */
  inLine: boolean;
  /** 👍 / 👎 / egal, before the rest (not on one's own). */
  reaction?: ReactionState;
  onReply?: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { state, copy } = useCopyToClipboard();
  const copied = state === 'copied';
  return (
    <div
      className={cn(
        'invisible flex items-center gap-0.5 group-hover/message:visible group-focus-within/message:visible',
        // Plain beside it on its free side; a phone has no room there – over it, on glass.
        !inLine &&
          cn(
            'absolute z-(--z-raised) max-sm:glass-elevated max-sm:bottom-full max-sm:mb-0.5 max-sm:rounded-control max-sm:p-0.5 sm:top-1/2 sm:-translate-y-1/2',
            own ? 'right-0 sm:right-full sm:mr-2' : 'left-0 sm:left-full sm:ml-2',
          ),
      )}
    >
      {reaction &&
        reactionMenuActions(reaction).map((action) => (
          <button
            key={action.label}
            type="button"
            aria-label={action.label}
            title={action.label}
            className="grid size-6 place-items-center rounded-control hover:bg-hover"
            onClick={action.onSelect}
          >
            {action.icon}
          </button>
        ))}
      {onReply && (
        <IconButton
          icon="reply"
          label="Antworten"
          size="xs"
          iconSize={16}
          variant="subtle"
          onClick={onReply}
        />
      )}
      <IconButton
        icon={copied ? 'check' : 'contentCopy'}
        label={copied ? 'Kopiert' : 'Kopieren'}
        size="xs"
        iconSize={16}
        variant="subtle"
        onClick={() => void copy(message.text)}
      />
      {mine && (
        <IconButton
          icon="edit"
          label="Bearbeiten"
          size="xs"
          iconSize={16}
          variant="subtle"
          onClick={onEdit}
        />
      )}
      {deletable && (
        <IconButton
          icon="delete"
          label="Löschen"
          size="xs"
          iconSize={16}
          variant="subtle"
          onClick={onDelete}
        />
      )}
    </div>
  );
}

/**
 * A conversation's messages, the oldest at the top: by day, one author's in a row under one
 * name, the „Neu“ line before what one has not read. It opens at that line (or the end), follows
 * what comes in while at the end, and brings older messages when scrolled up to them.
 */
export function MessageList({
  conversationId,
  messages,
  readSeq,
  me,
  people,
  editing,
  older,
  intro,
  onEditing,
  onSave,
  onDelete,
  readOnly = false,
  moderate = false,
  failed,
  onRetry,
  onDiscard,
  onReact,
  onReply,
  below,
  callHref,
  search,
}: {
  conversationId: string;
  messages: SenderMessage[];
  /** What was read when it opened: the „Neu“ line stands after it. */
  readSeq: number;
  me: AccountAuthor;
  people: readonly AccountAuthor[];
  editing: string | null;
  older: { more: boolean; loading: boolean; load: () => void };
  /** Above the first message, once there are no older ones. */
  intro: ReactNode;
  onEditing: (id: string | null) => void;
  onSave: (message: SenderMessage, text: string) => void;
  onDelete: (message: SenderMessage) => void;
  /** Nothing to change or delete (a mail conversation shown as a chat): copying only. */
  readOnly?: boolean;
  /** Who manages the conversation deletes anyone's message (not a call's entry). */
  moderate?: boolean;
  /** Why one's own message was not sent (`undefined`: it was, or is on its way). */
  failed?: (message: SenderMessage) => string | undefined;
  /** „Erneut senden“ / „Löschen“ under a message that was not sent. */
  onRetry?: (message: SenderMessage) => void;
  onDiscard?: (message: SenderMessage) => void;
  /** 👍 / 👎 / egal, or taken back (`null`) – where one may write. */
  onReact?: (message: SenderMessage, kind: CommentReactionKind | null) => void;
  /** „Antworten“: the message quoted above the field. */
  onReply?: (message: SenderMessage) => void;
  /** Under a message's text – a mail's attachments. */
  below?: (message: SenderMessage) => ReactNode;
  /** Where a call in the conversation opens (its entry, `message.call`). */
  callHref?: (callId: string) => string;
  /** The chat's search: only the messages it finds, marked (`lib/chat-search.ts`). */
  search?: { query: string; clear: () => void };
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [away, setAway] = useState(false);
  // Before older ones come in at the top: how tall it was, so the view stays where it is.
  const heightBefore = useRef<number | null>(null);
  const opened = useRef<string | null>(null);
  const query = search?.query.trim() ?? '';
  const searching = query !== '';
  useMarkedMatches(listRef, query);
  const showHit = useShowHit(listRef, searching, () => search?.clear());
  const loaded = new Set(messages.map((each) => each.id));

  const firstNew = messages.find(
    (each) =>
      each.seq > readSeq &&
      !isPending(each) &&
      whoOf(each) !== me.id &&
      // A call is no news to who was in it.
      !each.call?.people.some((person) => person.id === me.id),
  );
  const last = messages.at(-1);
  const lastPending = !!last && isPending(last);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (heightBefore.current !== null) {
      list.scrollTop += list.scrollHeight - heightBefore.current;
      heightBefore.current = null;
      return;
    }
    if (opened.current !== conversationId && messages.length > 0) {
      opened.current = conversationId;
      const line = newRef.current;
      if (line) list.scrollTop = Math.max(0, line.offsetTop - list.clientHeight / 3);
      else list.scrollTop = list.scrollHeight;
      pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < PINNED_PX;
      return;
    }
    // One's own message always brings one to the end.
    if (pinned.current || lastPending) {
      list.scrollTop = list.scrollHeight;
      pinned.current = true;
    }
  }, [conversationId, messages.length, last?.id, last?.text, lastPending, editing]);

  const onScroll = () => {
    const list = listRef.current;
    if (!list) return;
    pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < PINNED_PX;
    setAway(!pinned.current && list.scrollHeight - list.scrollTop - list.clientHeight > 400);
    if (list.scrollTop < OLDER_PX && older.more && !older.loading) {
      heightBefore.current = list.scrollHeight;
      older.load();
    }
  };

  const rows: ReactNode[] = [];
  let previous: SenderMessage | undefined;
  for (const message of messages) {
    if (
      searching &&
      (message.deleted || !chatMatches(`${message.mail?.subject ?? ''}\n${message.text}`, query))
    )
      continue;
    const newDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
    const isFirstNew = !searching && message === firstNew;
    const head =
      newDay ||
      isFirstNew ||
      !previous ||
      whoOf(previous) !== whoOf(message) ||
      previous.deleted ||
      new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() > BLOCK_MS;
    // One's own on the right in a bubble, everyone else's on the left – as in an agent's chat.
    const own = !message.agent && !message.call && message.author?.id === me.id;
    const mine = !readOnly && own;
    const notSent = isPending(message) ? failed?.(message) : undefined;
    const reactable = !message.call && !message.deleted && !isPending(message);
    const reaction = reactable
      ? reactionState(message.reactions ?? [], me.id, Boolean(onReact), (kind) =>
          onReact?.(message, kind),
        )
      : undefined;
    const name = message.agent?.title ?? message.author?.name ?? DELETED_ACCOUNT_NAME;
    const time = (
      <time
        dateTime={message.createdAt}
        title={stampOf(message.createdAt)}
        className="shrink-0 tabular-nums"
      >
        {timeOf(message.createdAt)}
      </time>
    );
    const tools = (inLine: boolean) =>
      !message.deleted &&
      !isPending(message) &&
      editing !== message.id && (
        <Tools
          message={message}
          own={own}
          mine={mine}
          deletable={mine || (!readOnly && moderate && !message.call)}
          inLine={inLine}
          reaction={!own && reaction?.canReact ? reaction : undefined}
          onReply={reactable && onReply ? () => onReply(message) : undefined}
          onEdit={() => onEditing(message.id)}
          onDelete={() => onDelete(message)}
        />
      );
    rows.push(
      <Fragment key={message.id}>
        {newDay && (
          <div role="separator" className="flex items-center gap-3 py-3">
            <span className="h-px flex-1 bg-hairline-strong" />
            <span className="rounded-full bg-surface-1 px-2.5 py-0.5 text-micro font-medium text-fg-muted ring-hairline-strong">
              {dayOf(message.createdAt)}
            </span>
            <span className="h-px flex-1 bg-hairline-strong" />
          </div>
        )}
        {isFirstNew && (
          <div
            ref={newRef}
            role="separator"
            aria-label="Neu"
            className="flex items-center gap-2 py-1"
          >
            <span className="h-px flex-1" style={{ backgroundColor: accentColor(me.color) }} />
            <span className="text-micro font-semibold" style={{ color: accentColor(me.color) }}>
              Neu
            </span>
          </div>
        )}
        <article
          aria-label={`${name}, ${timeOf(message.createdAt)}`}
          data-message={message.id}
          onClick={showHit(message.id)}
          className={cn(
            'group/message relative flex max-w-full min-w-0 flex-col gap-1',
            // Editing, or a call over: as wide as the conversation.
            editing === message.id || (message.call && !message.deleted)
              ? 'self-stretch'
              : own
                ? 'ml-12 items-end self-end sm:ml-24'
                : 'mr-12 items-start self-start sm:mr-24',
            head ? 'mt-4' : 'mt-1',
            isPending(message) && notSent === undefined && 'opacity-60',
            searching && 'cursor-pointer',
          )}
        >
          {head &&
            (own ? (
              <div className="flex min-h-6 items-center gap-1.5 text-xs text-fg-subtle">
                {tools(true)}
                {time}
                <Who message={message} />
              </div>
            ) : (
              <div className="flex min-h-6 min-w-0 items-center gap-1.5 text-xs text-fg-subtle">
                <Who message={message} />
                <span className="truncate">{name}</span>
                {message.agent && <Badge tone="info">Agent</Badge>}
                {time}
                {tools(true)}
              </div>
            ))}
          <div
            title={head ? undefined : stampOf(message.createdAt)}
            className={cn(
              'min-w-0',
              editing === message.id || message.call
                ? 'w-full'
                : own && 'rounded-panel bg-surface-2 px-3 py-2',
            )}
          >
            {/* It came as a mail: its subject, so one knows (a colleague's mail in the chat). */}
            {message.mail && !message.deleted && (
              <p className="flex items-center gap-1.5 text-xs text-fg-muted">
                <Icon name="mail" size={14} className="shrink-0" />
                <span className="truncate">{message.mail.subject || '(ohne Betreff)'}</span>
              </p>
            )}
            {message.replyTo && !message.deleted && editing !== message.id && (
              <ReplyQuote
                quote={message.replyTo}
                className="mb-1"
                onShow={
                  loaded.has(message.replyTo.id)
                    ? () =>
                        listRef.current
                          ?.querySelector(`[data-message="${CSS.escape(message.replyTo!.id)}"]`)
                          ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                    : undefined
                }
              />
            )}
            {editing === message.id ? (
              <Editor
                message={message}
                onCancel={() => onEditing(null)}
                onSave={(text) => {
                  onEditing(null);
                  onSave(message, text);
                }}
              />
            ) : message.deleted ? (
              <p className="text-body leading-[1.45] text-fg-subtle italic">Nachricht gelöscht</p>
            ) : message.call && callHref ? (
              // A call here, over: one entry that opens its page.
              <div>
                <CallEntry call={message.call} to={callHref(message.call.id)} />
              </div>
            ) : (
              <>
                {(message.text || !message.attachments?.length) && (
                  <div className="text-body leading-[1.45] break-words whitespace-pre-wrap text-fg select-text">
                    <MessageText text={message.text} people={people} me={me} />
                    {message.editedAt && (
                      <span
                        className="ml-1 text-xs text-fg-subtle"
                        title={stampOf(message.editedAt)}
                      >
                        (bearbeitet)
                      </span>
                    )}
                  </div>
                )}
                <SentAttachments
                  attachments={message.attachments}
                  className={cn(message.text && 'pt-1.5')}
                />
              </>
            )}
            {below?.(message)}
          </div>
          {reaction && <ReactionChipsOf state={reaction} />}
          {notSent !== undefined && (
            <p role="alert" className="flex flex-wrap items-center gap-x-2 text-xs text-danger">
              <Icon name="error" size={14} className="shrink-0" />
              <span>{notSent ? `Nicht gesendet: ${notSent}` : 'Nicht gesendet'}</span>
              <button
                type="button"
                className="font-medium text-fg underline-offset-2 hover:underline"
                onClick={() => onRetry?.(message)}
              >
                Erneut senden
              </button>
              <span aria-hidden className="text-fg-subtle">
                |
              </span>
              <button
                type="button"
                className="font-medium text-fg underline-offset-2 hover:underline"
                onClick={() => onDiscard?.(message)}
              >
                Löschen
              </button>
            </p>
          )}
          {!head && tools(false)}
        </article>
      </Fragment>,
    );
    previous = message;
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        onScroll={onScroll}
        role="log"
        aria-label="Nachrichten"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pb-3"
      >
        <div className="flex-1" />
        {!older.more && !searching && intro}
        {older.loading && (
          <p className="py-3 text-center text-xs text-fg-subtle">
            {searching ? 'Ältere Nachrichten werden durchsucht …' : 'Ältere laden …'}
          </p>
        )}
        {rows}
        {searching && rows.length === 0 && !older.more && (
          <p className="m-auto py-3 text-body text-fg-muted">Nichts gefunden.</p>
        )}
      </div>
      {away && (
        <Button
          size="sm"
          variant="secondary"
          icon="keyboardArrowDown"
          onClick={() => {
            const list = listRef.current;
            if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
          }}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-lg"
        >
          Zu den neuesten
        </Button>
      )}
    </div>
  );
}
