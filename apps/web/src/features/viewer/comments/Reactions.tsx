import { COMMENT_REACTIONS, type CommentReactionKind } from '@slider/shared';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import { cn } from '@/ui';
import { useReaction, type ReactionTarget } from './hooks/useCommentReaction';
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
 * The reactions under a comment (or an answer of the AI) as chips with their count – a click toggles one's own. `all`
 * shows every kind, the ones nobody picked yet quiet (cards and the thread panel); otherwise only
 * kinds someone picked, and nothing at all without reactions (replies on a card).
 */
export function ReactionChips({
  all = false,
  className,
  ...target
}: ReactionTarget & {
  all?: boolean;
  className?: string;
}) {
  const { mine, canReact, toggle, byKind } = useReaction(target);
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

/** Whether the picker can float in the top layer, tied to its place in the author line. */
const CAN_FLOAT =
  typeof CSS !== 'undefined' &&
  typeof HTMLElement !== 'undefined' &&
  'showPopover' in HTMLElement.prototype &&
  CSS.supports('anchor-name: --a') &&
  CSS.supports('position-visibility: anchors-visible');

/**
 * 👍 / 👎 / egal floating above the author line while the message is hovered or has
 * focus (thread panel, cards) – the chips under the text then only show what was picked. Needs a
 * `group/message` ancestor.
 */
export function ReactionPicker({
  className = 'bottom-full left-0 mb-1',
  floating = false,
  ...target
}: ReactionTarget & {
  /**
   * In a scrolling panel (the thread): same place, but in the top layer, so it floats over the
   * panel's header rather than being cut off by the scroller's edge. Gone once its line scrolled
   * out of view.
   */
  floating?: boolean;
  /**
   * Where it floats; by default above the author line, starting after the time (`afterTime`) – on
   * the line itself it covered the line's own buttons (✨, Erledigen) in a narrow card.
   */
  className?: string;
}) {
  const { mine, canReact, toggle } = useReaction(target);
  const { pick, burstOf } = useBurstToggle(toggle, mine);
  const floats = floating && CAN_FLOAT;
  const anchorName = `--reaction-picker-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const pickerRef = useRef<HTMLDivElement>(null);
  // Always open as a popover (the top layer); hover and focus still decide whether it shows.
  useLayoutEffect(() => {
    const picker = pickerRef.current;
    if (floats && picker && !picker.matches(':popover-open')) picker.showPopover();
  }, [floats, canReact]);
  if (!canReact) return null;
  return (
    <>
      {floats && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-px"
          style={{ anchorName } as CSSProperties}
        />
      )}
      <div
        ref={pickerRef}
        role="group"
        aria-label="Reagieren"
        data-reaction-picker
        popover={floats ? 'manual' : undefined}
        style={
          floats
            ? ({
                positionAnchor: anchorName,
                bottom: 'anchor(top)',
                left: 'anchor(left)',
                positionVisibility: 'anchors-visible',
              } as CSSProperties)
            : undefined
        }
        className={cn(
          'glass-elevated z-(--z-raised) flex gap-0.5 rounded-full p-0.5',
          // As a popover: the browser's own box (centred, bordered, own text colour) undone. The
          // pointer or focus on it no longer counts as on the message (top layer), so it holds
          // itself open – or it went away under the pointer and could not be clicked.
          floats
            ? 'fixed inset-auto m-0 mb-1 overflow-visible border-0 text-inherit focus-within:visible focus-within:translate-y-0 focus-within:opacity-100 hover:visible hover:translate-y-0 hover:opacity-100'
            : 'absolute',
          'invisible translate-y-1 opacity-0 transition-[opacity,translate,visibility] duration-200',
          'group-focus-within/message:visible group-focus-within/message:translate-y-0 group-focus-within/message:opacity-100',
          'group-hover/message:visible group-hover/message:translate-y-0 group-hover/message:opacity-100',
          !floats && className,
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
                picked
                  ? `${REACTION_LABELS[kind]} – klicken zum Zurücknehmen`
                  : REACTION_LABELS[kind]
              }
              onClick={(event) => pick(event, kind)}
              style={{ '--reaction': REACTION_COLORS[kind] } as CSSProperties}
              className={cn(
                'group/reaction grid size-7 place-items-center rounded-full transition-[background-color,color,transform] duration-200 active:scale-95',
                picked
                  ? 'bg-[color-mix(in_srgb,var(--reaction)_16%,transparent)] text-fg'
                  : 'text-fg-muted hover:bg-hover hover:text-fg',
              )}
            >
              <ReactionGlyph
                kind={kind}
                active={picked}
                burst={burstOf(kind)}
                size={18}
                className="transition-transform duration-300 group-hover/reaction:-translate-y-px group-hover/reaction:scale-115"
              />
            </button>
          );
        })}
      </div>
    </>
  );
}
