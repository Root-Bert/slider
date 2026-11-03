/**
 * Three fanned-out slides, the front one a layout – title bar and two dashed placeholders: the
 * reviews' empty-state look, for slide masters.
 */
export function MasterSpecimens() {
  return (
    <svg width="148" height="96" viewBox="0 0 148 96" fill="none" aria-hidden>
      <rect
        x="6"
        y="30"
        width="84"
        height="50"
        rx="6"
        transform="rotate(-10 6 30)"
        fill="var(--color-glass-solid)"
        stroke="var(--color-surface-3)"
      />
      <rect
        x="58"
        y="14"
        width="84"
        height="50"
        rx="6"
        transform="rotate(8 58 14)"
        fill="var(--color-glass-solid)"
        stroke="var(--color-surface-3)"
      />
      <rect
        x="30"
        y="20"
        width="88"
        height="56"
        rx="6"
        fill="var(--color-placeholder)"
        stroke="var(--color-hairline-strong)"
      />
      <rect x="40" y="29" width="44" height="6" rx="3" fill="var(--color-fg-faint)" />
      <rect x="40" y="39" width="28" height="3" rx="1.5" fill="var(--color-selected)" />
      <rect
        x="40.5"
        y="47.5"
        width="32"
        height="20"
        rx="3"
        stroke="var(--color-fg-faint)"
        strokeDasharray="3 2"
      />
      <rect
        x="76.5"
        y="47.5"
        width="32"
        height="20"
        rx="3"
        stroke="var(--color-fg-faint)"
        strokeDasharray="3 2"
      />
      <rect x="44" y="53" width="18" height="2.5" rx="1.25" fill="var(--color-selected)" />
      <rect x="44" y="59" width="22" height="2.5" rx="1.25" fill="var(--color-selected)" />
      <rect x="80" y="53" width="20" height="2.5" rx="1.25" fill="var(--color-selected)" />
      <rect x="80" y="59" width="15" height="2.5" rx="1.25" fill="var(--color-selected)" />
    </svg>
  );
}
