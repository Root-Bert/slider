import type { CSSProperties } from 'react';
import { cn } from '@/ui';

/** Staggered entrance: each part comes in a little after the one before, hidden until then. */
const rise = (delayMs: number): CSSProperties => ({
  animationDelay: `${delayMs}ms`,
  animationFillMode: 'backwards',
});
/** SVG parts scale around their own centre (the pin pops in). */
const popOrigin: CSSProperties = { transformBox: 'fill-box', transformOrigin: 'center' };

/**
 * Login hero: what Slider does in one picture – a slide with a marked area, its comment pin and
 * the connector line to the comment beside it, on a faint white glow. Decorative only.
 */
export function LoginHero({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 150"
      fill="none"
      aria-hidden
      className={cn('h-auto overflow-visible', className)}
    >
      <defs>
        <radialGradient id="login-hero-glow">
          <stop offset="0" stopColor="var(--color-primary-hover)" stopOpacity="0.09" />
          <stop offset="1" stopColor="var(--color-primary-hover)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="160" cy="76" rx="170" ry="80" fill="url(#login-hero-glow)" />

      {/* The slide behind, fanned out. */}
      <rect
        x="20"
        y="30"
        width="168"
        height="96"
        rx="8"
        transform="rotate(-6 20 30)"
        fill="var(--color-glass-solid)"
        stroke="var(--color-surface-3)"
        className="animate-rise-in"
      />

      {/* The slide under review: title, two lines of text, a small bar chart. */}
      <g className="animate-rise-in" style={rise(60)}>
        <rect
          x="36"
          y="22"
          width="168"
          height="96"
          rx="8"
          fill="var(--color-placeholder)"
          stroke="var(--color-hairline-strong)"
        />
        <rect x="50" y="37" width="70" height="7" rx="3.5" fill="var(--color-fg-faint)" />
        <rect x="50" y="52" width="110" height="3" rx="1.5" fill="var(--color-selected)" />
        <rect x="50" y="60" width="88" height="3" rx="1.5" fill="var(--color-selected)" />
        <rect x="52" y="90" width="11" height="16" rx="2" fill="var(--color-surface-4)" />
        <rect x="67" y="82" width="11" height="24" rx="2" fill="var(--color-surface-4)" />
        <rect x="82" y="73" width="11" height="33" rx="2" fill="var(--color-fg-faint)" />
      </g>

      {/* The marked area, its connector line and the comment it leads to. */}
      <g className="animate-fade-in" style={rise(260)}>
        <rect
          x="46"
          y="68"
          width="53"
          height="43"
          rx="3"
          fill="var(--color-accent-blue)"
          fillOpacity="0.1"
          stroke="var(--color-accent-blue)"
          strokeWidth="1.5"
        />
        <path d="M99 68H222" stroke="var(--color-accent-blue)" strokeWidth="1.5" />
      </g>
      <g className="animate-rise-in" style={rise(340)}>
        <rect
          x="222"
          y="48"
          width="96"
          height="46"
          rx="10"
          fill="var(--color-glass-elevated)"
          stroke="var(--color-hairline-strong)"
        />
        <circle cx="236" cy="62" r="6" fill="var(--color-accent-green)" />
        <rect x="247" y="60" width="36" height="4" rx="2" fill="var(--color-fg-muted)" />
        <rect x="231" y="75" width="74" height="3" rx="1.5" fill="var(--color-selected)" />
        <rect x="231" y="82" width="52" height="3" rx="1.5" fill="var(--color-selected)" />
      </g>
      <g className="animate-pop-in" style={{ ...popOrigin, ...rise(300) }}>
        <circle cx="99" cy="68" r="7.5" fill="var(--color-accent-blue)" />
        <circle cx="99" cy="68" r="2.75" fill="var(--color-primary-hover)" />
      </g>
    </svg>
  );
}
