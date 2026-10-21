import type { stars } from '../lib/stars';

/**
 * Stars of a sky from `lib/stars` as SVG circles (inside the caller's `<svg>`): the steady ones
 * at `opacity`, every fourth slowly twinkling.
 */
export function Stars({ sky, opacity }: { sky: ReturnType<typeof stars>; opacity: number }) {
  return sky.map((star) => (
    <circle
      key={`${star.x}-${star.y}`}
      cx={star.x}
      cy={star.y}
      r={star.r}
      fill="var(--color-fg)"
      opacity={star.twinkle === null ? opacity : undefined}
      className={star.twinkle === null ? undefined : 'motion-safe:animate-twinkle'}
      style={star.twinkle === null ? undefined : { animationDelay: `${star.twinkle}s` }}
    />
  ));
}
