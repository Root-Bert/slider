import { COMMENT_REACTIONS, type Comment, type CommentReactionKind } from '@slider/shared';
import { useState, type CSSProperties, type MouseEvent } from 'react';
import { cn } from '@/ui';
import { useCommentReaction } from './hooks/useCommentReaction';
import { REACTION_COLORS, REACTION_LABELS } from './lib/reactions';
import { ReactionGlyph } from './ReactionGlyph';

/**
 * Toggles one's own reaction; picking it (not taking it back) bumps `burst`, which plays the
 * glyph's animation once.
 */
function useBurstToggle(
  toggle: (kind: CommentReactionKind) => void,
  mine: CommentReactionKind | null,
) {
  const [burst, setBurst] = useState<{ kind: CommentReactionKind; count: number } | null>(null);
  const pick = (event: MouseEvent, kind: CommentReactionKind) => {
    // Cards open their thread on a click anywhere else.
    event.stopPropagation();
    if (mine !== kind) setBurst((last) => ({ kind, count: (last?.count ?? 0) + 1 }));
    toggle(kind);
  };
  const burstOf = (kind: CommentReactionKind) => (burst?.kind === kind ? burst.count : 0);
  return { pick, burstOf };
}

/**
 * The reactions under a comment as chips with their count – a click toggles one's own. `all`
 * shows every kind, the ones nobody picked yet quiet (cards and the thread panel); otherwise only
 * kinds someone picked, and nothing at all without reactions (replies on a card).
 */
export function ReactionChips({
  comment,
  all = false,
  className,
}: {
  comment: Comment;
  all?: boolean;
  className?: string;
}) {
  const { mine, canReact, toggle, byKind } = useCommentReaction(comment);
  const { pick, burstOf } = useBurstToggle(toggle, mine);
  const kinds = COMMENT_REACTIONS.filter((kind) => (all && canReact) || byKind(kind).length > 0);
  if (kinds.length === 0) return null;

  return (
    <div role="group" aria-label="Reaktionen" className={cn('flex flex-wrap gap-1', className)}>
      {kinds.map((kind) => {
        const authors = byKind(kind);
        const label = REACTION_LABELS[kind];
        const names = authors.map((author) => author.name).join(', ');
        const picked = mine === kind;
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={picked}
            aria-label={`${label}${authors.length > 0 ? ` (${authors.length})` : ''}`}
            title={names ? `${label}: ${names}` : label}
            disabled={!canReact}
            onClick={(event) => pick(event, kind)}
            style={{ '--reaction': REACTION_COLORS[kind] } as CSSProperties}
            className={cn(
              'group/reaction relative z-(--z-raised) inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-[background-color,color,box-shadow,transform] duration-200 enabled:active:scale-95',
              picked
                ? 'bg-[color-mix(in_srgb,var(--reaction)_16%,transparent)] text-fg ring-hairline-strong'
                : authors.length > 0
                  ? 'text-fg-subtle ring-hairline-strong enabled:hover:bg-hover enabled:hover:text-fg'
                  : // Not picked by anyone yet: quiet until hovered.
                    'text-fg-subtle enabled:hover:bg-hover enabled:hover:text-fg enabled:hover:ring-hairline-strong',
              !canReact && 'cursor-default',
            )}
          >
            <ReactionGlyph
              kind={kind}
              active={picked}
              burst={burstOf(kind)}
              size={20}
              className="transition-transform duration-300 group-enabled/reaction:group-hover/reaction:-rotate-6 group-enabled/reaction:group-hover/reaction:scale-110"
            />
            {authors.length > 0 && (
              // The count pops when it changes.
              <span key={authors.length} className="tabular-nums motion-safe:animate-pop-in">
                {authors.length}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 👍 / 👎 / egal floating at the message's top edge while it is hovered or has focus (thread
 * panel, cards) – the chips under the text then only show what was picked. Needs a
 * `group/message relative` parent.
 */
export function ReactionPicker({
  comment,
  className = '-top-3.5 right-12',
}: {
  comment: Comment;
  /** Where it floats; by default on the top edge, left of the ⋯ menu. */
  className?: string;
}) {
  const { mine, canReact, toggle } = useCommentReaction(comment);
  const { pick, burstOf } = useBurstToggle(toggle, mine);
  if (!canReact) return null;
  return (
    <div
      role="group"
      aria-label="Reagieren"
      data-reaction-picker
      className={cn(
        'glass-elevated absolute z-(--z-raised) flex gap-0.5 rounded-full p-0.5',
        'invisible translate-y-1 opacity-0 transition-[opacity,translate,visibility] duration-200',
        'group-focus-within/message:visible group-focus-within/message:translate-y-0 group-focus-within/message:opacity-100',
        'group-hover/message:visible group-hover/message:translate-y-0 group-hover/message:opacity-100',
        className,
      )}
    >
      {COMMENT_REACTIONS.map((kind) => {
        const picked = mine === kind;
        return (
          <button
            key={kind}
            type="button"
            aria-label={REACTION_LABELS[kind]}
            aria-pressed={picked}
            title={
              picked ? `${REACTION_LABELS[kind]} – klicken zum Zurücknehmen` : REACTION_LABELS[kind]
            }
            onClick={(event) => pick(event, kind)}
            style={{ '--reaction': REACTION_COLORS[kind] } as CSSProperties}
            className={cn(
              'group/reaction grid size-8 place-items-center rounded-full transition-[background-color,color,transform] duration-200 active:scale-95',
              picked
                ? 'bg-[color-mix(in_srgb,var(--reaction)_16%,transparent)] text-fg'
                : 'text-fg-muted hover:bg-hover hover:text-fg',
            )}
          >
            <ReactionGlyph
              kind={kind}
              active={picked}
              burst={burstOf(kind)}
              size={20}
              className="transition-transform duration-300 group-hover/reaction:-translate-y-px group-hover/reaction:scale-115"
            />
          </button>
        );
      })}
    </div>
  );
}
