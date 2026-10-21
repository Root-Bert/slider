/** Google Slides' yellow slide with the white frame (brand colour, never recoloured). */
export function GoogleSlidesMark({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden>
      <path d="M3 1.5h6.5L13 5v9.5H3z" fill="#F4B400" />
      <path d="M9.5 1.5V5H13" fill="#FFFFFF" fillOpacity={0.6} />
      <rect
        x={5}
        y={7.5}
        width={6}
        height={4.5}
        rx={0.5}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={1.2}
      />
    </svg>
  );
}
