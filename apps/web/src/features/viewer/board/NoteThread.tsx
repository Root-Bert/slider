import { MAX_MATERIAL_QUESTION, type AuthorColor } from '@slider/shared';
import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { accentColor } from '@/lib/accent';
import { formatDateTime, formatRelativeTime, pluralize } from '@/lib/format';
import { AutosizeTextarea, Avatar, AvatarStack, Button, cn, DeleteButton, IconButton } from '@/ui';
import { ThreadBranch } from '../comments/CommentCard';
import { NoteAnswer, type NoteAnswerActions } from './NoteAnswer';
import { askKeys, useThreadOpen, type NoteAnswerValue } from './note-answers';

/** What a note's card gets from its thread: „Zuklappen“ in its head, „Aufklappen“ at its foot. */
export interface ThreadFold {
  trailing: ReactNode;
  footer: ReactNode;
}

const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

/**
 * A note's card with its thread under it, as a comment's on a slide (`CommentCard`): folded, the
 * card shows sheets behind it and „2 Antworten | KI hat geantwortet“ with „Aufklappen“; open,
 * the AI's answers and the replies hang under it on the thread's line in the note's colour, and
 * „Zuklappen“ folds it. Under a hovered or typed-into card the field „Antworten …“ writes a
 * reply – ↵ puts it down, ✨ (⌘↵) hands it to the AI too; under a question ↵ always asks.
 */
export function NoteThread({
  noteId,
  color,
  question,
  entries,
  actions,
  canReply,
  card,
}: {
  noteId: string;
  color: AuthorColor;
  /** A question to the AI: a reply always asks it. */
  question: boolean;
  entries: readonly NoteAnswerValue[];
  actions: NoteAnswerActions;
  /** The field shows (the note put down, comment rights). */
  canReply: boolean;
  card: (fold: ThreadFold) => ReactNode;
}) {
  const [open, setOpen] = useThreadOpen(noteId);
  const listId = useId();
  const replies = entries.filter((entry) => entry.kind === 'reply');
  const answers = entries.filter((entry) => entry.state !== null);
  const stacked = entries.length > 0 && !open;
  const working = answers.some((answer) => answer.state === 'answering');
  const repliers = [
    ...new Map(
      replies.flatMap((reply) => (reply.author ? [[reply.author.id, reply.author]] : [])),
    ).values(),
    ...(answers.length > 0 ? [{ id: 'ai', ...actions.ai }] : []),
  ];
  const fold: ThreadFold = {
    trailing:
      open && entries.length > 0 ? (
        <Button
          variant="soft"
          size="2xs"
          weight="normal"
          trailingIcon="expandLess"
          expanded
          aria-controls={listId}
          onClick={(event) => {
            event.stopPropagation();
            setOpen(false);
          }}
          onDoubleClick={stop}
          className="nodrag relative -my-0.5 ml-auto"
        >
          Zuklappen
        </Button>
      ) : null,
    footer: stacked ? (
      <footer className="flex items-center gap-2 pt-0.5">
        <AvatarStack authors={repliers} size={16} max={3} />
        <span className="min-w-0 text-xs text-fg-subtle">
          {[
            replies.length > 0 && pluralize(replies.length, 'Antwort', 'Antworten'),
            working
              ? `${actions.ai.name} arbeitet …`
              : answers.length > 0 && `${actions.ai.name} hat geantwortet`,
          ]
            .filter(Boolean)
            .join(' | ')}
        </span>
        <Button
          variant="ghost"
          tone="subtle"
          size="2xs"
          weight="normal"
          trailingIcon="expandMore"
          expanded={false}
          aria-controls={listId}
          onClick={(event) => {
            event.stopPropagation();
            setOpen(true);
          }}
          onDoubleClick={stop}
          className="nodrag relative ml-auto shrink-0"
        >
          Aufklappen
        </Button>
      </footer>
    ) : null,
  };
  return (
    <div
      data-note-thread={noteId}
      className="group/thread relative flex flex-col focus-within:z-10 hover:z-10"
      style={{ '--card-accent': accentColor(color) } as CSSProperties}
    >
      <div className="relative">
        {stacked && (
          // Sheets behind the card hint at its thread, as under a comment's.
          <>
            <span
              aria-hidden
              className="glass absolute inset-x-3 -bottom-2 h-6 rounded-b-panel opacity-60"
            />
            <span
              aria-hidden
              className="glass absolute inset-x-1.5 -bottom-1 h-6 rounded-b-panel"
            />
          </>
        )}
        {card(fold)}
      </div>
      {open && entries.length > 0 && (
        <ol id={listId} aria-label="Antworten" className="flex flex-col gap-1.5 pt-1.5 pl-11">
          {entries.flatMap((entry) => [
            entry.kind === 'reply' && (
              <ThreadBranch key={`${entry.id}:reply`}>
                <ReplyCard entry={entry} actions={actions} />
              </ThreadBranch>
            ),
            entry.state !== null && (
              <ThreadBranch key={entry.id}>
                <NoteAnswer answer={entry} actions={actions} />
              </ThreadBranch>
            ),
          ])}
        </ol>
      )}
      {canReply && (
        <ReplyBar
          question={question}
          offset={stacked ? 14 : 6}
          onSend={(text, ask) => actions.reply(noteId, text, ask || question)}
        />
      )}
    </div>
  );
}

/**
 * A person's reply in a note's thread, as in a comment's (`InlineReply`): its author line, ✨
 * hands it to the AI while it was not, its writer's bin deletes it (its second click confirms).
 */
function ReplyCard({ entry, actions }: { entry: NoteAnswerValue; actions: NoteAnswerActions }) {
  const author = entry.author ?? actions.ai;
  return (
    <article
      data-note-reply={entry.id}
      aria-label={`Antwort von ${author.name}`}
      className="nodrag nopan nowheel glass pointer-events-auto flex cursor-auto flex-col gap-2 rounded-panel px-3.5 py-3 select-text"
      onClick={stop}
      onDoubleClick={stop}
      onPointerDown={stop}
      onContextMenu={stop}
    >
      <header className="flex min-w-0 items-center gap-2">
        <Avatar author={author} size={24} />
        <span title={author.name} className="min-w-0 truncate text-xs font-medium text-fg">
          {author.name}
        </span>
        <time
          dateTime={entry.createdAt}
          title={formatDateTime(entry.createdAt)}
          className="min-w-0 shrink-[4] truncate text-caption text-fg-subtle"
        >
          {formatRelativeTime(entry.createdAt)}
        </time>
        <span className="-my-1 -mr-1.5 ml-auto flex shrink-0 items-center">
          {entry.state === null && actions.canComment && (
            <IconButton
              icon="autoAwesome"
              label="KI dazu fragen"
              size="sm"
              onClick={() => actions.askReply(entry)}
            />
          )}
          {entry.author?.id === actions.me && (
            <DeleteButton label="Antwort löschen" onDelete={() => actions.removeReply(entry)} />
          )}
        </span>
      </header>
      <p className="text-body leading-4.5 break-words whitespace-pre-wrap text-fg-muted">
        {entry.question}
      </p>
    </article>
  );
}

/**
 * „Antworten …“ under a hovered or typed-into note, as under a comment (`ReplyBar`): it lies over
 * what is below instead of pushing it; a transparent bridge keeps the hover across the gap, a
 * draft keeps it open.
 */
function ReplyBar({
  question,
  offset,
  onSend,
}: {
  question: boolean;
  offset: number;
  onSend: (text: string, ask: boolean) => void;
}) {
  const [body, setBody] = useState('');
  const draft = body.trim().length > 0;
  const send = (ask: boolean) => {
    const text = body.trim();
    if (!text) return;
    onSend(text, ask);
    setBody('');
  };
  return (
    <form
      data-sticker-bar
      aria-label="Antworten"
      onSubmit={(event) => {
        event.preventDefault();
        send(false);
      }}
      onClick={stop}
      onDoubleClick={stop}
      onPointerDown={stop}
      onContextMenu={stop}
      style={{ top: `calc(100% + ${offset}px)` }}
      className={cn(
        'nodrag nopan nowheel glass-elevated pointer-events-auto absolute inset-x-0 flex cursor-auto items-end gap-0.5 rounded-control py-1 pr-1 pl-3',
        'transition-[opacity,visibility,box-shadow] duration-150',
        'focus-within:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--card-accent)_45%,transparent)]!',
        'before:absolute before:inset-x-0 before:bottom-full before:h-4',
        draft
          ? 'visible opacity-100'
          : 'invisible opacity-0 group-focus-within/thread:visible group-focus-within/thread:opacity-100 group-hover/thread:visible group-hover/thread:opacity-100',
      )}
    >
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden py-[5px]">
        <AutosizeTextarea
          aria-label="Antwort"
          maxLength={MAX_MATERIAL_QUESTION}
          placeholder={question ? 'Nachfragen …' : 'Antworten …'}
          value={body}
          maxHeight={120}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              setBody('');
              event.currentTarget.blur();
              return;
            }
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            send(event.metaKey || event.ctrlKey);
          }}
          className="text-body leading-4.5 text-fg placeholder:text-fg-subtle"
        />
      </div>
      {draft && !question && (
        <IconButton
          icon="autoAwesome"
          label="Senden und die KI dazu fragen"
          title={`Senden und die KI dazu fragen (${askKeys()})`}
          size="compact"
          onClick={() => send(true)}
        />
      )}
      {draft && (
        <IconButton
          type="submit"
          icon="arrowUpward"
          label={question ? 'Nachfragen' : 'Antwort senden'}
          title={question ? 'Senden – die KI antwortet (Enter)' : 'Senden (Enter)'}
          size="compact"
          iconTone="success"
        />
      )}
    </form>
  );
}
