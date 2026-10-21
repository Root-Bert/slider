import { memo } from 'react';
import { stars } from '../lib/stars';
import { Stars } from './Stars';

const SKY = stars(70, 1440, 900, 7);

/**
 * The welcome page's sky, behind everything (BER-130): faint stars, a few twinkling, and in the
 * top-right corner the website's orbit – dim arcs, one sage trajectory with a satellite at its
 * end. Never over the headline, no labels. Decorative only.
 */
export const SpaceBackdrop = memo(function SpaceBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 size-full"
      >
        <Stars sky={SKY} opacity={0.45} />
      </svg>
      <svg
        viewBox="0 0 400 360"
        fill="none"
        className="absolute -top-6 -right-10 h-[360px] w-[400px] max-sm:opacity-50"
      >
        {/* Quarter arcs around a centre beyond the top-right corner (420, -40). */}
        <path d="M420 140A180 180 0 0 1 240 -40" stroke="var(--color-hairline-strong)" />
        <path d="M420 220A260 260 0 0 1 160 -40" stroke="var(--color-hairline)" />
        <path d="M420 300A340 340 0 0 1 80 -40" stroke="var(--color-hairline)" />
        {/* The trajectory on the middle arc, the satellite at its end. */}
        <path
          d="M374.9 216A260 260 0 0 1 220.8 127.1"
          stroke="var(--color-sage)"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        <circle cx={220.8} cy={127.1} r={10} fill="var(--color-sage)" opacity={0.17} />
        <circle cx={220.8} cy={127.1} r={4.5} fill="var(--color-sage)" />
      </svg>
    </div>
  );
});
