/** Person with a key – the common passkey symbol, drawn in `currentColor`. */
export function PasskeyMark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `shrink-0 ${className}` : 'shrink-0'}
    >
      <circle cx="9" cy="7.5" r="3.5" />
      <path d="M2.5 19.5v-1.2c0-2.9 2.6-4.8 6.5-4.8 1.2 0 2.3.2 3.2.5" />
      <circle cx="17.5" cy="11.5" r="2.5" />
      <path d="M17.5 14v6.5l1.5-1.2M17.5 17.5H19" />
    </svg>
  );
}
