import type { Comment } from '@slider/shared';
import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { accentColor } from '@/lib/accent';
import { isPendingComment } from '@/lib/comment-cache';
import { pluralize } from '@/lib/format';
import { AvatarStack, cn, Icon } from '@/ui';
import { isStrokeOnly, type Thread } from '../lib/comment-selectors';
import { MEDIA_KINDS, MEDIA_SOON } from '../lib/media-kinds';
import { useViewerDispatch } from '../state/viewer-state';
import { AuthorLine } from './AuthorLine';
import { CommentBody } from './CommentBody';
import { ReplyComposer } from './ReplyComposer';
import { ResolveButton } from './ResolveButton';

export type CardEmphasis = 'normal' | 'focused' | 'hovered' | 'dimmed';

interface CommentCardProps {
  thread: Thread;
  deckId: string;
  emphasis: CardEmphasis;
  /** Resolving and replying need comment rights (BER-102). */
  canResolve: boolean;
  /** Extra context line, e.g. "Zwischen Folie 2 und 3". */
  location?: string | undefined;
}

/**
 * Glass card for one thread (B1) that expands inline into the whole thread with a reply box
 * (B3). The root opens the thread panel; nested controls sit above the invisible full-size
 * button ("stretched button"), so there is no nested interactive content.
 */
export const CommentCard = memo(function CommentCard({
  thread,
  deckId,
  emphasis,
  canResolve,
  location,
}: CommentCardProps) {
  const dispatch = useViewerDispatch();
  const [expanded, setExpanded] = useState(false);
  const [composing, setComposing] = useState(false);
  const repliesId = useId();
  const repliesRef = useRef<HTMLOListElement>(null);
  const { root, replies } = thread;
  const done = root.status === 'done';
  const highlighted = expanded || emphasis === 'focused' || emphasis === 'hovered';
  const stacked = replies.length > 0 && !expanded;
  const canReply = canResolve;

  // Every sent reply pushes the inline reply box down; keep it in view while typing.
  useEffect(() => {
    if (!composing) return;
    repliesRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [composing, replies.length]);

  // An expanded thread is the selected one: its line stays lit, the other cards dim (B3).
  const expand = (compose: boolean) => {
    setExpanded(true);
    setComposing(compose);
    dispatch({ type: 'threadFocused', threadId: thread.id, openPanel: false });
  };
  const collapse = () => {
    setExpanded(false);
    setComposing(false);
    dispatch({ type: 'threadUnfocused', threadId: thread.id });
  };
  const stopComposing = () => {
    if (replies.length === 0) collapse();
    else setComposing(false);
  };

  return (
    <article
      data-comment-card={thread.id}
      onPointerEnter={() => dispatch({ type: 'threadHovered', threadId: thread.id })}
      onPointerLeave={() => dispatch({ type: 'threadHovered', threadId: null })}
      className={cn(
        // Raised while hovered or focused, so the reply bar overlaps the cards below.
        'group relative transition-opacity duration-200 focus-within:z-20 hover:z-20',
        emphasis === 'focused' && 'z-20',
        (emphasis === 'dimmed' || done) && 'opacity-45',
        emphasis === 'dimmed' && done && 'opacity-30',
      )}
      style={{ '--card-accent': accentColor(root.author.color) } as CSSProperties}
    >
      {stacked && (
        // Stacked sheets behind the card hint at the thread (B1 "Thread Stack").
        <>
          <span
            aria-hidden
            className="glass absolute inset-x-3 -bottom-2 h-6 rounded-b-2xl opacity-60"
          />
          <span aria-hidden className="glass absolute inset-x-1.5 -bottom-1 h-6 rounded-b-2xl" />
        </>
      )}
      <div
        className={cn(
          'glass relative flex flex-col gap-2 rounded-2xl px-3.5 py-3 transition-shadow duration-200',
          highlighted &&
            'shadow-[inset_0_0_0_1px_var(--card-accent),0_0_20px_color-mix(in_srgb,var(--card-accent)_50%,transparent)]!',
        )}
      >
        <button
          type="button"
          aria-label={`Thread von ${root.author.name} öffnen`}
          onClick={() => dispatch({ type: 'threadFocused', threadId: thread.id, openPanel: true })}
          className="absolute inset-0 rounded-2xl"
        />
        <AuthorLine
          comment={root}
          trailing={
            expanded ? (
              <button
                type="button"
                aria-expanded
                aria-controls={repliesId}
                onClick={collapse}
                className="relative z-10 -my-0.5 inline-flex items-center gap-0.5 rounded-lg bg-white/8 py-0.5 pr-1 pl-2 text-[11px] text-fg-muted hover:bg-white/15 hover:text-fg"
              >
                Zuklappen
                <Icon name="expandLess" size={16} />
              </button>
            ) : (
              canResolve && (
                <ResolveButton comment={root} deckId={deckId} className="-my-1 -mr-1.5" />
              )
            )
          }
        />
        {location && <p className="text-[11px] font-medium text-fg-subtle">{location}</p>}
        {isStrokeOnly(root) ? (
          <p className="text-[13px] text-fg-muted">✏️ Markierung</p>
        ) : (
          <CommentBody body={root.body} />
        )}
        {stacked && (
          <footer className="flex items-center gap-2 pt-0.5">
            <AvatarStack authors={thread.repliers} size={16} max={3} />
            <span className="text-xs text-fg-subtle">
              {pluralize(replies.length, 'Antwort', 'Antworten')}
            </span>
            <button
              type="button"
              aria-expanded={false}
              aria-controls={repliesId}
              onClick={() => expand(false)}
              className="relative z-10 ml-auto inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs text-fg-subtle hover:bg-white/10 hover:text-fg"
            >
              Aufklappen
              <Icon name="expandMore" size={16} />
            </button>
          </footer>
        )}
      </div>

      {expanded && (
        <ol
          ref={repliesRef}
          id={repliesId}
          aria-label="Antworten"
          className="flex flex-col gap-1.5 pt-1.5 pl-11"
        >
          {replies.map((reply) => (
            <ThreadBranch key={reply.id}>
              <InlineReply reply={reply} />
            </ThreadBranch>
          ))}
          {composing && canReply && (
            <ThreadBranch>
              <ReplyComposer
                root={root}
                deckId={deckId}
                variant="inline"
                autoFocus
                onCancel={stopComposing}
              />
            </ThreadBranch>
          )}
        </ol>
      )}

      {canReply && !composing && (
        <ReplyBar
          root={root}
          deckId={deckId}
          // Below the stacked sheets, if any.
          offset={stacked ? 14 : 6}
          visible={emphasis === 'focused' && !expanded}
          onText={() => expand(true)}
        />
      )}
    </article>
  );
});

/**
 * One item of the inline thread with its branch of the accent tree line (Figma 110:460): a
 * rounded tick at avatar height into the item, the trunk continuing to the next item. The trunk
 * runs at x=26 of the card, items start at x=44.
 */
function ThreadBranch({ children }: { children: ReactNode }) {
  // SVG rather than CSS borders: a 1.5px border snaps to 1px on standard-density screens.
  return (
    <li className="group/branch relative w-64 scroll-mb-6 animate-fade-in">
      <svg
        aria-hidden
        width="18"
        height="30"
        className="pointer-events-none absolute -top-1.5 -left-[18px] overflow-visible text-(--card-accent)"
      >
        <path
          d="M0.75 0 V21.25 A8 8 0 0 0 8.75 29.25 H18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
      <svg
        aria-hidden
        width="2"
        className="pointer-events-none absolute -top-1.5 -left-[18px] h-[calc(100%+6px)] overflow-visible text-(--card-accent) group-last/branch:hidden"
      >
        <line x1="0.75" y1="0" x2="0.75" y2="100%" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      {children}
    </li>
  );
}

function InlineReply({ reply }: { reply: Comment }) {
  return (
    <article
      aria-busy={isPendingComment(reply) || undefined}
      className={cn(
        'glass flex flex-col gap-2 rounded-2xl px-3.5 py-3',
        isPendingComment(reply) && 'opacity-60',
      )}
    >
      <AuthorLine comment={reply} />
      {isStrokeOnly(reply) ? (
        <p className="text-[13px] text-fg-muted">✏️ Markierung</p>
      ) : (
        <CommentBody body={reply.body} className="text-fg-muted" />
      )}
    </article>
  );
}

/**
 * "Antworten mit" bar under a hovered or focused card (Figma B1 105:277): text opens the inline
 * thread with a reply box, audio/video/image follow with BER-116, ✓ resolves. It overlays the
 * cards below instead of pushing them, so the layout and the connector lines stay put; a
 * transparent bridge keeps the hover alive across the gap.
 */
function ReplyBar({
  root,
  deckId,
  offset,
  visible,
  onText,
}: {
  root: Comment;
  deckId: string;
  offset: number;
  visible: boolean;
  onText: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Antworten mit"
      style={{ top: `calc(100% + ${offset}px)` }}
      className={cn(
        'glass absolute left-0 flex items-center gap-0.5 rounded-[12px] py-1 pr-1 pl-3',
        'transition-[opacity,visibility] duration-150',
        'before:absolute before:inset-x-0 before:bottom-full before:h-4',
        visible
          ? 'visible opacity-100'
          : 'invisible opacity-0 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100',
      )}
    >
      <span className="mr-1.5 text-[11px] whitespace-nowrap text-white/60">Antworten mit</span>
      {MEDIA_KINDS.map((kind) => (
        <button
          key={kind.id}
          type="button"
          aria-label={
            kind.enabled ? `Mit ${kind.label} antworten` : `${kind.label} – ${MEDIA_SOON}`
          }
          aria-disabled={!kind.enabled || undefined}
          tabIndex={kind.enabled ? undefined : -1}
          title={kind.enabled ? `Mit ${kind.label} antworten` : MEDIA_SOON}
          onClick={kind.enabled ? onText : undefined}
          className={cn(
            'flex size-7 items-center justify-center rounded-lg',
            kind.enabled
              ? 'text-fg-muted hover:bg-white/10 hover:text-fg'
              : 'cursor-not-allowed text-fg-faint',
          )}
        >
          <Icon name={kind.icon} size={18} />
        </button>
      ))}
      <span aria-hidden className="mx-0.5 h-4 w-px bg-white/15" />
      <ResolveButton comment={root} deckId={deckId} />
    </div>
  );
}
