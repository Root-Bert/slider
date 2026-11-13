import type { CSSProperties } from 'react';
import { cn } from '@/ui';
import { trackName } from './lib/timeline-layout';
import { useTrackDots } from './lib/track-dots';

/**
 * Where the band is among its tracks: a dot per track, top to bottom as they lie (variants over
 * the slides, notes under them), the one shown filled – a click goes there. In every gap between
 * the slides, over its buttons, so it is at hand wherever one looks.
 */
export function TrackDots({ className, style }: { className?: string; style?: CSSProperties }) {
  const dots = useTrackDots();
  if (!dots) return null;
  const { stack, track, go } = dots;
  const levels: number[] = [];
  for (let level = -stack.above; level <= stack.below; level++) levels.push(level);
  return (
    <div
      data-track-dots
      role="tablist"
      aria-orientation="vertical"
      aria-label="Ebenen"
      className={cn('flex flex-col items-center gap-1', className)}
      style={style}
    >
      {levels.map((level) => (
        <button
          key={level}
          type="button"
          role="tab"
          aria-selected={level === track}
          aria-label={trackName(level)}
          title={trackName(level)}
          onClick={() => go(level)}
          className="group flex size-2.5 items-center justify-center"
        >
          <span
            className={cn(
              'block rounded-full transition-all',
              level === track
                ? 'size-1.5 bg-fg'
                : 'size-1 bg-fg-faint group-hover:size-1.5 group-hover:bg-fg-subtle',
            )}
          />
        </button>
      ))}
    </div>
  );
}

/**
 * The dots alone in a gap of a track without its buttons (variants, notes): where they are on the
 * slides' track, `lift` px over the gap's middle (`gapDotsLift`), so they stay put as it swipes.
 */
export function GapDots({
  x,
  width,
  height,
  lift,
}: {
  x: number;
  width: number;
  height: number;
  lift: number;
}) {
  return (
    <TrackDots
      className="absolute z-(--z-overlay) -translate-x-1/2 -translate-y-full"
      style={{ left: x + width / 2, top: height / 2 - lift }}
    />
  );
}
