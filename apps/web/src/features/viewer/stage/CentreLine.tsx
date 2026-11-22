/**
 * A slide zoomed out moved along the middle of its frame: the frame's centre line that way in
 * `color`, as the lines a dragged element is caught on (`CaughtLines`). `x`: centred left to
 * right – the upright line; `y`: the level one.
 */
export function CentreLine({ way, color }: { way: 'x' | 'y'; color: string }) {
  return (
    <span
      aria-hidden
      data-centre-line={way}
      className={
        way === 'x'
          ? 'pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2'
          : 'pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2'
      }
      style={{ background: color }}
    />
  );
}
