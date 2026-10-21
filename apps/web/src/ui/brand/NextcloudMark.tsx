/** The three Nextcloud rings. */
export function NextcloudMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <g fill="none" stroke="#0082c9" strokeWidth="2.2">
        <circle cx="12" cy="12" r="4.4" />
        <circle cx="3.7" cy="12" r="2.3" />
        <circle cx="20.3" cy="12" r="2.3" />
      </g>
    </svg>
  );
}
