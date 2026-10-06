import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  message: string;
  action?: ReactNode;
  /** Defaults to the stacked-slides illustration. */
  illustration?: ReactNode;
}

export function EmptyState({
  title,
  message,
  action,
  illustration = <StackedSlides />,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-5 px-4 py-20 text-center">
      {illustration}
      <div className="flex max-w-sm flex-col gap-1.5">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        <p className="text-sm text-fg-subtle">{message}</p>
      </div>
      {action}
    </div>
  );
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
        fill="#141414"
        stroke="rgb(255 255 255 / 0.12)"
      />
      <rect
        x="30"
        y="18"
        width="88"
        height="56"
        rx="6"
        fill="#1a1a1a"
        stroke="rgb(255 255 255 / 0.18)"
      />
      <rect x="40" y="30" width="40" height="5" rx="2.5" fill="rgb(255 255 255 / 0.3)" />
      <rect x="40" y="41" width="60" height="3" rx="1.5" fill="rgb(255 255 255 / 0.14)" />
      <rect x="40" y="48" width="52" height="3" rx="1.5" fill="rgb(255 255 255 / 0.14)" />
      <circle cx="108" cy="22" r="9" fill="var(--color-accent-blue)" />
      <circle cx="108" cy="22" r="3" fill="white" />
    </svg>
  );
}
