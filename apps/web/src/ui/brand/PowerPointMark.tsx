/** The PowerPoint "P" badge, used for decks and comments imported from a PPTX. */
export function PowerPointMark({ size = 24 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-badge bg-powerpoint font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      aria-label="PowerPoint"
    >
      P
    </span>
  );
}
