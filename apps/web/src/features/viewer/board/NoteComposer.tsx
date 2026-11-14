import type { Author, AuthorColor } from '@slider/shared';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { accentAlpha, accentColor } from '@/lib/accent';
import { isTextTarget } from '@/lib/dom';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import {
  Avatar,
  Button,
  cn,
  DeleteButton,
  IconButton,
  Kbd,
  ReturnKey,
  selectedOutlineClass,
} from '@/ui';
import { askKeys } from './note-answers';

/** How typing a note ends: taken, taken and handed to the AI, or dropped. */
export type NoteEnd = 'done' | 'ask' | 'cancel';

/**
 * A note or question being written on the board, as a new comment is (`Composer`): its author and
 * „jetzt“ over the field (`children`), „Abbrechen“ and „Senden“ under it – a note's ✨ sends it and
 * asks the AI. Its bin: a draft goes, a sent one is deleted (its second click confirms). A press on
 * it keeps the caret in the field (`data-sticker-bar`: neither the board nor the field's blur takes
 * it as leaving).
 */
export function NoteComposer({
  author,
  color,
  createdAt,
  fresh,
  label,
  deleteLabel,
  sendTitle,
  canSend = true,
  onSend,
  onAsk,
  onCancel,
  onDelete,
  className,
  children,
}: {
  author: Author;
  color: AuthorColor;
  createdAt: string;
  /** Not sent yet: „jetzt“, and its bin drops the draft. */
  fresh: boolean;
  label: string;
  /** Its bin's name once sent („Notiz löschen“, „Frage löschen“). */
  deleteLabel: string;
  sendTitle: string;
  canSend?: boolean;
  onSend: () => void;
  /** A note's ✨: sent, then handed to the AI. */
  onAsk?: () => void;
  onCancel: () => void;
  onDelete: () => void;
  className?: string;
  children: ReactNode;
}) {
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    <form
      data-note-composer
      data-sticker-bar
      aria-label={label}
      // Typed in and clicked, not dragged, panned or zoomed by the board.
      className={cn(
        'nodrag nopan nowheel glass-elevated pointer-events-auto relative flex w-full animate-pop-in cursor-auto flex-col gap-3 rounded-panel p-3',
        className,
      )}
      style={{
        boxShadow: `inset 0 0 0 1px ${accentAlpha(color, 90)}, 0 0 32px ${accentAlpha(color, 35)}, var(--shadow-float)`,
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSend();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onCancel();
      }}
      // Pressed beside the field, the caret stays in it.
      onMouseDown={(event) => {
        if (!isTextTarget(event.target)) event.preventDefault();
      }}
      onClick={stop}
      onDoubleClick={stop}
      onPointerDown={stop}
      onContextMenu={stop}
    >
      <header className="flex items-center gap-2">
        <Avatar author={author} size={24} />
        <span className="min-w-0 truncate text-xs font-medium text-fg">
          {author.name}{' '}
          <span className="font-normal text-fg-subtle">
            {fresh ? 'jetzt' : formatRelativeTime(createdAt)}
          </span>
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <DeleteButton
            label={fresh ? 'Entwurf löschen' : deleteLabel}
            // Tab goes into the field, not here; Esc drops it from the keys.
            tabIndex={-1}
            onDelete={fresh ? onCancel : onDelete}
          />
        </div>
      </header>
      <div className="field-well focus-field flex min-w-0 rounded-control-sm px-3 py-2">
        {children}
      </div>
      <footer className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" tabIndex={-1} onClick={onCancel}>
          Abbrechen
        </Button>
        <div className="flex items-center gap-1">
          {onAsk && (
            <IconButton
              icon="autoAwesome"
              label="Senden und die KI dazu fragen"
              title={`Senden und die KI dazu fragen (${askKeys()})`}
              size="sm"
              tabIndex={-1}
              disabled={!canSend}
              onClick={onAsk}
            />
          )}
          <Button
            type="submit"
            size="sm"
            icon="send"
            tabIndex={-1}
            disabled={!canSend}
            title={sendTitle}
            className="group"
          >
            Senden
            {/* Only on hover, so the button stays calm (as in the composer). */}
            <Kbd className="-mr-1 hidden text-on-primary/55 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-on-primary)_15%,transparent)] group-hover:inline-flex max-sm:hidden max-sm:group-hover:hidden">
              <ReturnKey />
            </Kbd>
          </Button>
        </div>
      </footer>
    </form>
  );
}

/**
 * A note or question once sent, as a comment's card (`CommentCard`): its author, name and time
 * over its text, edged and lit in its colour as a thread's first one is (`ThreadMessage`).
 */
export function NoteCardLook({
  author,
  color,
  createdAt,
  selected,
  trailing,
  footer,
  className,
  style,
  children,
  ...rest
}: {
  author: Author;
  color: AuthorColor;
  createdAt: string;
  selected: boolean;
  /** At the end of its head („Zuklappen“). */
  trailing?: ReactNode;
  /** Under its text (its thread folded: „Aufklappen“). */
  footer?: ReactNode;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return (
    <article
      {...rest}
      className={cn(
        'glass flex flex-col gap-2 rounded-panel px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--card-accent),0_0_20px_-4px_color-mix(in_srgb,var(--card-accent)_50%,transparent)]!',
        selected && selectedOutlineClass,
        className,
      )}
      style={{ '--card-accent': accentColor(color), ...style } as CSSProperties}
    >
      <header className="flex min-w-0 items-center gap-2">
        <Avatar author={author} size={24} />
        <span title={author.name} className="min-w-0 truncate text-xs font-medium text-fg">
          {author.name}
        </span>
        <time
          dateTime={createdAt}
          title={formatDateTime(createdAt)}
          className="min-w-0 shrink-[4] truncate text-caption text-fg-subtle"
        >
          {formatRelativeTime(createdAt)}
        </time>
        {trailing}
      </header>
      {children}
      {footer}
    </article>
  );
}
