import { useEffect, useId, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { Comment, Deck } from '@slider/shared';
import { routes } from '@/lib/routes';
import { formatRelativeTime } from '@/lib/format';
import { queryKeys, useComments, useSlides, useUpdateComment } from '@/lib/api';
import { Avatar, AvatarStack, cn, Icon, Spinner, useDismiss } from '@/ui';
import {
  buildThreads,
  commentPreview,
  isRemovedInPowerPoint,
  type Thread,
} from '@/features/viewer';

/** Open threads as the card counts them: roots, open, not deleted in the PowerPoint file. */
const isOpenThread = (comment: Comment) =>
  comment.parentId === null && comment.status === 'open' && !isRemovedInPowerPoint(comment);

/**
 * Where the list opens. `card`: fills the card's thumbnail, slightly inset, however many
 * comments – rendered into `cardSlot`, an element right inside the thumbnail's positioned box.
 * `above`: above the button.
 */
type Placement = 'card' | 'above';

/**
 * "n offen" on a deck card: a button that opens the open threads as a small to-do list, where
 * they can be ticked off (resolved) without opening the deck.
 */
export function OpenCommentsButton({
  deck,
  placement = 'above',
  size = 'sm',
  cardSlot,
  onOpenChange,
}: {
  deck: Deck;
  placement?: Placement;
  /** Where the `card` list goes; see {@link Placement}. */
  cardSlot?: HTMLElement | null;
  /** `md`: the deck card's title row. */
  size?: 'sm' | 'md';
  /** The list opened or closed – the card drops its hover look while it's open. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The `card` list is portalled out of the wrapper, so it counts as inside on its own.
  const popoverRef = useRef<HTMLElement>(null);
  const count = deck.openCommentCount;
  const done = count === 0;

  useEffect(() => onOpenChange?.(open), [open, onOpenChange]);

  useDismiss({
    open,
    onDismiss: () => setOpen(false),
    refs: [wrapperRef, popoverRef],
    returnFocusTo: triggerRef,
  });

  // Nothing open: no button. Kept while the list is open, so ticking the last thread doesn't
  // yank it away.
  if (done && !open) return null;

  return (
    <div ref={wrapperRef} className={cn(placement === 'above' && 'relative')}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={done ? 'Alle Kommentare erledigt' : `${count} offene Kommentare anzeigen`}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          // Positioned, so it sits above a stretched deck link.
          'glass-control relative inline-flex items-center gap-1.5 rounded-chip text-fg-muted transition-colors',
          size === 'md' ? 'h-8 px-3 text-[13px]' : 'h-7 px-2.5 text-xs',
          'hover:bg-glass-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-mention focus-visible:outline-none',
          open && 'bg-glass-hover text-fg',
        )}
      >
        <Icon name={done ? 'checkCircle' : 'chatBubble'} size={size === 'md' ? 18 : 16} />
        {done ? 'Alles erledigt' : `${count} offen`}
        <Icon
          name="expandLess"
          size={size === 'md' ? 16 : 14}
          className={cn('-mr-1 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open &&
        placement === 'card' &&
        cardSlot &&
        createPortal(
          // The thumbnail, 8px inset – the same size for one comment or a hundred; the list scrolls inside.
          <OpenCommentsPopover
            ref={popoverRef}
            id={popoverId}
            deck={deck}
            onClose={() => setOpen(false)}
            className="absolute inset-2 z-30"
          />,
          cardSlot,
        )}
      {open && placement === 'above' && (
        <OpenCommentsPopover
          id={popoverId}
          deck={deck}
          onClose={() => setOpen(false)}
          className="absolute bottom-full left-0 z-30 mb-2 origin-bottom-left max-h-[min(420px,60vh)] w-[min(340px,calc(100vw-32px))]"
        />
      )}
    </div>
  );
}

function OpenCommentsPopover({
  ref,
  id,
  deck,
  onClose,
  className,
}: {
  ref?: Ref<HTMLElement>;
  id: string;
  deck: Deck;
  onClose: () => void;
  className?: string;
}) {
  const headingId = useId();
  const queryClient = useQueryClient();
  const comments = useComments(deck.id);
  const slides = useSlides(deck.id);
  const update = useUpdateComment(deck.id);
  // Ticked threads stay in the list (struck through) until the popover closes, so a mis-click
  // can be undone in place.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const canResolve = deck.permissions.canComment;

  const threads = buildThreads(
    (comments.data ?? []).filter((comment) => !isRemovedInPowerPoint(comment)),
  ).filter(({ root }) => isOpenThread(root) || ticked.has(root.id));
  const slideNumber = new Map(
    (slides.data ?? [])
      .filter((slide) => !slide.hidden)
      .map((slide, index) => [slide.id, index + 1]),
  );

  const toggle = (comment: Comment) => {
    const resolve = !ticked.has(comment.id);
    setTicked((current) => {
      const next = new Set(current);
      if (resolve) next.add(comment.id);
      else next.delete(comment.id);
      return next;
    });
    update.mutate(
      { commentId: comment.id, status: resolve ? 'done' : 'open' },
      // The card's "n offen" comes from the deck list.
      { onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.deckLists }) },
    );
  };

  return (
    <section
      ref={ref}
      id={id}
      aria-labelledby={headingId}
      className={cn('glass-elevated flex animate-pop-in flex-col rounded-panel', className)}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3.5 pb-2">
        <h2 id={headingId} className="text-sm font-semibold text-fg">
          Offene Kommentare
        </h2>
        {threads.length > 0 && (
          <span className="text-xs text-fg-subtle">
            {threads.length - ticked.size} von {threads.length} offen
          </span>
        )}
      </header>

      <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-2">
        {comments.isPending ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : comments.isError ? (
          <p className="px-2 py-6 text-center text-[13px] text-fg-subtle">
            Kommentare konnten nicht geladen werden.
          </p>
        ) : threads.length === 0 ? (
          <p className="px-2 py-6 text-center text-[13px] text-fg-subtle">Nichts mehr offen.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {threads.map((thread) => (
              <li key={thread.id}>
                <OpenThreadItem
                  thread={thread}
                  deckId={deck.id}
                  slideNumber={
                    thread.root.slideId ? slideNumber.get(thread.root.slideId) : undefined
                  }
                  done={ticked.has(thread.id)}
                  canResolve={canResolve}
                  onToggle={() => toggle(thread.root)}
                  onOpen={onClose}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

interface OpenThreadItemProps {
  thread: Thread;
  deckId: string;
  slideNumber: number | undefined;
  done: boolean;
  canResolve: boolean;
  onToggle: () => void;
  onOpen: () => void;
}

/** One thread: the root with its tick box, the replies folded away behind "n Antworten". */
function OpenThreadItem({
  thread,
  deckId,
  slideNumber,
  done,
  canResolve,
  onToggle,
  onOpen,
}: OpenThreadItemProps) {
  const [expanded, setExpanded] = useState(false);
  const repliesId = useId();
  const { root, replies } = thread;
  const to = routes.deck(deckId, root.slideId);

  return (
    <div className="flex items-center gap-3 rounded-control py-1.5 pr-1.5 pl-2 transition-colors hover:bg-white/5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          to={to}
          onClick={onOpen}
          className="flex min-w-0 flex-col gap-0.5 rounded-badge outline-none focus-visible:ring-2 focus-visible:ring-mention"
        >
          <CommentMeta
            comment={root}
            extra={slideNumber ? `Folie ${slideNumber}` : 'Zwischen Folien'}
          />
          <span
            className={cn(
              'line-clamp-2 text-[13px] text-fg transition-colors',
              done && 'text-fg-subtle line-through',
            )}
          >
            {commentPreview(root)}
          </span>
        </Link>

        {replies.length > 0 && (
          <>
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={expanded ? repliesId : undefined}
              onClick={() => setExpanded((value) => !value)}
              className={cn(
                '-ml-1 flex w-fit items-center gap-1.5 rounded-chip px-1 py-0.5 text-xs text-fg-subtle transition-colors',
                'hover:text-fg focus-visible:ring-2 focus-visible:ring-mention focus-visible:outline-none',
              )}
            >
              <AvatarStack
                // Only the root author answered: show them rather than nobody.
                authors={thread.repliers.length > 0 ? thread.repliers : [root.author]}
                max={3}
                size={16}
              />
              {replies.length === 1 ? '1 Antwort' : `${replies.length} Antworten`}
              <Icon
                name="expandMore"
                size={14}
                className={cn('transition-transform', expanded && 'rotate-180')}
              />
            </button>
            {expanded && (
              <ul
                id={repliesId}
                className="flex animate-fade-in flex-col gap-2 border-l border-hairline-strong py-0.5 pl-3"
              >
                {replies.map((reply) => (
                  <li key={reply.id}>
                    <Link
                      to={to}
                      onClick={onOpen}
                      className="flex min-w-0 flex-col gap-0.5 rounded-badge outline-none focus-visible:ring-2 focus-visible:ring-mention"
                    >
                      <CommentMeta comment={reply} />
                      <span className="line-clamp-3 text-[13px] text-fg-muted">
                        {commentPreview(reply)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      {canResolve && (
        // Same as the review tool's resolve button (ResolveButton, `icon`).
        <button
          type="button"
          aria-pressed={done}
          aria-label={done ? 'Wieder öffnen' : 'Als erledigt markieren'}
          title={done ? 'Erledigt – klicken zum Wiederöffnen' : 'Als erledigt markieren'}
          onClick={onToggle}
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-chip transition-colors',
            'focus-visible:ring-2 focus-visible:ring-mention focus-visible:outline-none',
            done ? 'text-success' : 'text-fg-subtle hover:bg-white/10 hover:text-fg',
          )}
        >
          <Icon name="check" size={18} />
        </button>
      )}
    </div>
  );
}

/** "Avatar Name · [extra ·] time" above a comment. */
function CommentMeta({ comment, extra }: { comment: Comment; extra?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-subtle">
      <Avatar author={comment.author} size={16} />
      <span className="truncate text-fg-muted">{comment.author.name}</span>
      {extra && (
        <>
          <span aria-hidden>·</span>
          <span className="shrink-0">{extra}</span>
        </>
      )}
      <span aria-hidden>·</span>
      <span className="shrink-0">{formatRelativeTime(comment.createdAt)}</span>
    </span>
  );
}
