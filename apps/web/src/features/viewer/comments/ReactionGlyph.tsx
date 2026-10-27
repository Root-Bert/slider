import type { CommentReactionKind } from '@slider/shared';
import { useId, type CSSProperties } from 'react';
import { cn } from '@/ui';
import { REACTION_COLORS } from './lib/reactions';

/** The thumb, pointing up; the cuff on the left. Rotated, it is the thumb down. */
const THUMB =
  'M7 11.2 10.1 5c.45-.88 1.5-1.24 2.37-.8.82.42 1.22 1.36.97 2.24L12.7 9.6h5.4a2 2 0 0 1 1.96 2.4l-1.25 6.4A2 2 0 0 1 16.85 20H7Z';

/** SVG parts scale and turn about their own box, not the icon's. */
const ownBox = (origin: string): CSSProperties => ({
  transformBox: 'fill-box',
  transformOrigin: origin,
});

interface ReactionGlyphProps {
  kind: CommentReactionKind;
  /** Picked by the viewer: in the reaction's colour, the thumb up with its sparks. */
  active?: boolean;
  /**
   * Bumped each time the viewer picks it: plays its little animation once (not when someone else
   * reacts). `0` never plays.
   */
  burst?: number;
  size?: number;
  className?: string;
}

/**
 * Drawn reaction icons (👍 / 👎 / egal) – solid shapes, which stay crisp at small sizes where thin
 * outlines blur; in the reaction's colour once picked. Own drawings rather than `Icon`: they come
 * in parts that move on their own.
 */
export function ReactionGlyph({
  kind,
  active = false,
  burst = 0,
  size = 22,
  className,
}: ReactionGlyphProps) {
  const playing = burst > 0;
  const maskId = useId();
  const color = active ? 'var(--reaction)' : 'currentColor';
  // A thin outline in the fill's colour rounds the shapes' corners.
  const body = { fill: color, stroke: color, strokeWidth: 1.5 };
  return (
    <span
      aria-hidden
      className={cn('relative inline-grid shrink-0 place-items-center', className)}
      style={{ '--reaction': REACTION_COLORS[kind], width: size, height: size } as CSSProperties}
    >
      {playing && (
        // Remounted per pick (`key`), so the ring goes out every time.
        <span
          key={`ring-${burst}`}
          className="pointer-events-none absolute inset-0 rounded-full border-2 border-(--reaction) opacity-0 motion-safe:animate-reaction-ring"
        />
      )}
      <svg
        key={`glyph-${burst}`}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        className="overflow-visible transition-colors"
      >
        {kind === 'neutral' ? (
          // Abstaining: a circle with a level bar, like a vote left out.
          <g
            style={ownBox('50% 50%')}
            className={cn(playing && 'motion-safe:animate-reaction-neutral')}
          >
            {/* A disc with the bar cut out of it, so it shows whatever is behind. */}
            <mask id={maskId}>
              <circle cx="12" cy="12" r="9.6" fill="#fff" />
              <rect
                x="7"
                y="10.75"
                width="10"
                height="2.5"
                rx="1.25"
                fill="#000"
                style={ownBox('50% 50%')}
                className={cn(playing && 'motion-safe:animate-reaction-level')}
              />
            </mask>
            <circle cx="12" cy="12" r="9.6" fill={color} mask={`url(#${maskId})`} />
          </g>
        ) : (
          // Animated in screen space (the thud goes down), the thumb down turned inside.
          <g
            style={ownBox(kind === 'up' ? '25% 90%' : '50% 100%')}
            className={cn(
              playing &&
                (kind === 'up'
                  ? 'motion-safe:animate-reaction-up'
                  : 'motion-safe:animate-reaction-down'),
            )}
          >
            <g transform={kind === 'down' ? 'rotate(180 12 12)' : undefined}>
              <rect x="1.6" y="10.6" width="2.9" height="9.4" rx="1" {...body} />
              <path d={THUMB} {...body} />
            </g>
          </g>
        )}
        {kind === 'up' && active && (
          // Sparks off the thumb's tip, in the up's colour.
          <g
            stroke="var(--reaction)"
            strokeWidth={2.4}
            style={ownBox('0% 100%')}
            className={cn(playing && 'motion-safe:animate-reaction-sparks')}
          >
            <path d="M15.3 3.7l.9-1.6M17.6 5.9l1.6-.9M19.4 8.6l1.7-.2" />
          </g>
        )}
      </svg>
    </span>
  );
}
