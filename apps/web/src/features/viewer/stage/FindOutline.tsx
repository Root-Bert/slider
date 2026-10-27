import { useFindHighlight } from '../state/stage-registry';

/** Room between the box and the ring, so the ring doesn't sit on the found text. */
const RING_GAP = 4;

/**
 * The box of the in-review search's current hit (BER-176) on this slide: a marker-yellow ring
 * in percent of the slide box, like the box outlines of box mode. Pops in for every new hit.
 * Never a pointer target.
 */
export function FindOutline({ slideId }: { slideId: string }) {
  const rect = useFindHighlight(slideId);
  if (!rect) return null;
  return (
    <div
      key={`${rect.x},${rect.y},${rect.w},${rect.h}`}
      aria-hidden
      data-find-outline
      className="pointer-events-none absolute animate-pop-in rounded-mark border-2 border-warning bg-warning/10 shadow-mark"
      style={{
        left: `calc(${rect.x * 100}% - ${RING_GAP}px)`,
        top: `calc(${rect.y * 100}% - ${RING_GAP}px)`,
        width: `calc(${rect.w * 100}% + ${2 * RING_GAP}px)`,
        height: `calc(${rect.h * 100}% + ${2 * RING_GAP}px)`,
      }}
    />
  );
}
