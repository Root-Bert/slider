/** Each way's sides. */
const SIDES = { x: ['left', 'right'], y: ['top', 'bottom'] } as const;

/**
 * A slide zoomed out moved into the middle of its frame, caught: out of the middle of its sides
 * lights run along its frame's edge in `color` and fade, once (key it per catch). `x`: the left
 * and right side, `y`: the top and bottom, `xy`: all four.
 */
export function SnapPulse({ ways, color }: { ways: 'x' | 'y' | 'xy'; color: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
      style={{ ['--snap-color' as string]: color }}
    >
      {[...ways].flatMap((way) =>
        SIDES[way as 'x' | 'y'].map((side) => (
          <span key={side} className="snap-side" data-side={side} />
        )),
      )}
    </span>
  );
}
