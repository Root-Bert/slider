/** Height of a section's label row plus its gap (`h-8`, `gap-2`), and the gap between sections. */
const LABEL = 40;
const GAP = 24;
/** The notes keep at least this much height when they go under the slides. */
const NOTES_MIN = 180;

/**
 * How the presenter view fills its room: `side` – the current slide at most two thirds wide, the
 * next slide and the notes beside it; `below` – the current slide and the next one side by side,
 * the notes under both; whichever leaves less empty room next to the slides. `narrow`: stacked.
 * `current`: the current slide's width in px.
 */
export function presenterRoom(
  width: number,
  height: number,
  aspect: number,
): { kind: 'side' | 'below' | 'narrow'; current: number } {
  if (width < 720 || height <= 0) return { kind: 'narrow', current: width };
  const side = Math.min((width - GAP) * (2 / 3), (height - LABEL) * aspect);
  const sideEmpty = (height - LABEL - side / aspect) * side;
  const below = Math.max(
    0,
    Math.min((width - GAP) * 0.62, (height - LABEL - GAP - LABEL - NOTES_MIN) * aspect),
  );
  const next = width - GAP - below;
  const belowEmpty = Math.max(0, below / aspect - next / aspect) * next;
  return sideEmpty <= belowEmpty
    ? { kind: 'side', current: Math.floor(side) }
    : { kind: 'below', current: Math.floor(below) };
}
