/** Two fanned-out specimen cards with an "Aa" – the reviews' empty-state look, for fonts. */
export function FontSpecimens() {
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
      <text x="40" y="55" fontSize="28" fontWeight="600" fill="var(--color-fg-faint)">
        Aa
      </text>
      <rect x="82" y="36" width="28" height="3" rx="1.5" fill="var(--color-selected)" />
      <rect x="82" y="43" width="22" height="3" rx="1.5" fill="var(--color-selected)" />
      <rect x="82" y="50" width="25" height="3" rx="1.5" fill="var(--color-selected)" />
    </svg>
  );
}
