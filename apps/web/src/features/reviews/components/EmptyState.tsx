import type { ReactNode } from 'react';
import { EmptyState as KitEmptyState } from '@/ui';

interface EmptyStateProps {
  title: string;
  message: string;
  action?: ReactNode;
  /** Defaults to the stacked-slides illustration. */
  illustration?: ReactNode;
}

/** The kit's empty state with the reviews illustration as its default. */
export function EmptyState({ illustration = <StackedSlides />, ...props }: EmptyStateProps) {
  return <KitEmptyState illustration={illustration} {...props} />;
}

/** Three fanned-out slide outlines with a comment pin – hints at what Slider does. */
function StackedSlides() {
  return (
    <svg width="132" height="92" viewBox="0 0 132 92" fill="none" aria-hidden>
      <rect
        x="10"
        y="22"
        width="88"
        height="56"
        rx="6"
        transform="rotate(-8 10 22)"
        fill="var(--color-glass-solid)"
        stroke="var(--color-surface-3)"
      />
      <rect
        x="30"
        y="18"
        width="88"
        height="56"
        rx="6"
        fill="var(--color-placeholder)"
        stroke="var(--color-hairline-strong)"
      />
      <rect x="40" y="30" width="40" height="5" rx="2.5" fill="var(--color-fg-faint)" />
      <rect x="40" y="41" width="60" height="3" rx="1.5" fill="var(--color-selected)" />
      <rect x="40" y="48" width="52" height="3" rx="1.5" fill="var(--color-selected)" />
      <circle cx="108" cy="22" r="9" fill="var(--color-accent-blue)" />
      <circle cx="108" cy="22" r="3" fill="var(--color-primary-hover)" />
    </svg>
  );
}
