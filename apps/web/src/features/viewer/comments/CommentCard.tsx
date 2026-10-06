import { memo, useId, useState, type CSSProperties } from 'react';
import { pluralize } from '@/lib/format';
import { AvatarStack, cn, Icon } from '@/ui';
import { isStrokeOnly, type Thread } from '../lib/comment-selectors';
import { markColor } from '../lib/colors';
import { useViewerDispatch } from '../state/viewer-state';
import { AuthorLine } from './AuthorLine';
import { CommentBody } from './CommentBody';
import { ResolveButton } from './ResolveButton';

export type CardEmphasis = 'normal' | 'focused' | 'hovered' | 'dimmed';

interface CommentCardProps {
  thread: Thread;
  deckId: string;
  emphasis: CardEmphasis;
  canResolve: boolean;
  /** Extra context line, e.g. "Zwischen Folie 2 und 3". */
  location?: string | undefined;
}

/**
 * Glass card for one thread (B1). The whole card opens the thread; nested controls sit above the
 * invisible full-size button ("stretched button"), so there is no nested interactive content.
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
  const repliesId = useId();
  const { root, replies } = thread;
  const color = markColor(root);
  const done = root.status === 'done';
  const highlighted = emphasis === 'focused' || emphasis === 'hovered';

  return (
    <article
      data-comment-card={thread.id}
      onPointerEnter={() => dispatch({ type: 'threadHovered', threadId: thread.id })}
      onPointerLeave={() => dispatch({ type: 'threadHovered', threadId: null })}
      className={cn(
        'group relative transition-opacity duration-200',
        (emphasis === 'dimmed' || done) && 'opacity-45',
        emphasis === 'dimmed' && done && 'opacity-30',
      )}
      style={{ '--card-accent': color } as CSSProperties}
    >
      {replies.length > 0 && (
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
            'shadow-[inset_0_0_0_1px_var(--card-accent),0_0_24px_-4px_var(--card-accent)]!',
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
            canResolve && <ResolveButton comment={root} deckId={deckId} className="-my-1 -mr-1.5" />
          }
        />
        {location && <p className="text-[11px] font-medium text-fg-subtle">{location}</p>}
        {isStrokeOnly(root) ? (
          <p className="text-[13px] text-fg-muted">✏️ Markierung</p>
        ) : (
          <CommentBody body={root.body} />
        )}
        {replies.length > 0 && (
          <footer className="flex items-center gap-2 pt-0.5">
            <AvatarStack authors={thread.repliers} size={16} max={3} />
            <span className="text-xs text-fg-subtle">
              {pluralize(replies.length, 'Antwort', 'Antworten')}
            </span>
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={repliesId}
              onClick={() => setExpanded((value) => !value)}
              className="relative z-10 ml-auto inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs text-fg-subtle hover:bg-white/10 hover:text-fg"
            >
              {expanded ? 'Zuklappen' : 'Aufklappen'}
              <Icon name={expanded ? 'expandLess' : 'expandMore'} size={16} />
            </button>
          </footer>
        )}
      </div>
      {expanded && (
        <ol
          id={repliesId}
          className="relative mt-2 ml-4 flex flex-col gap-2 border-l border-white/15 pl-3"
        >
          {replies.map((reply) => (
            <li
              key={reply.id}
              className="glass flex animate-fade-in flex-col gap-1.5 rounded-2xl px-3 py-2.5"
            >
              <AuthorLine comment={reply} />
              <CommentBody body={reply.body} />
            </li>
          ))}
        </ol>
      )}
    </article>
  );
});
