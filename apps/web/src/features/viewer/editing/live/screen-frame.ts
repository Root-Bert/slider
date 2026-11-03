/*
 * The others' carets on a text box (the live editor) are drawn in the box's own pixels, so they
 * turn and zoom with it. The browser tells where text lies only on screen – as boxes around it,
 * turned with it –, so these map such boxes back.
 */

/** How far apart the points are that tell where the box's pixels are on screen. */
export const PROBE = 100;

/**
 * Where the box's own pixels lie on screen: its corner, and the screen step of one pixel to the
 * right (`u`) and down (`v`) – scaled by the zoom, turned with the box.
 */
export interface ScreenFrame {
  origin: { x: number; y: number };
  u: { x: number; y: number };
  v: { x: number; y: number };
}

export function screenFrame(probes: readonly (Element | null)[]): ScreenFrame | null {
  const [corner, right, down] = probes.map((probe) => probe?.getBoundingClientRect());
  if (!corner || !right || !down) return null;
  const frame = {
    origin: { x: corner.left, y: corner.top },
    u: { x: (right.left - corner.left) / PROBE, y: (right.top - corner.top) / PROBE },
    v: { x: (down.left - corner.left) / PROBE, y: (down.top - corner.top) / PROBE },
  };
  return frame.u.x * frame.v.y - frame.u.y * frame.v.x === 0 ? null : frame;
}

/**
 * A box the browser gives on screen – around the text's box, turned with it – in the box's own
 * pixels. Its centre maps back as it is; its size follows from the turn (`lineHeight`: what a
 * box of the text is high, where a turn near 45° does not tell). `caret`: a line without width.
 */
export function toLocal(
  frame: ScreenFrame,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  { caret = false, lineHeight = 0 }: { caret?: boolean; lineHeight?: number } = {},
): { x: number; y: number; w: number; h: number } {
  const { origin, u, v } = frame;
  const det = u.x * v.y - u.y * v.x;
  const cx = rect.left + rect.width / 2 - origin.x;
  const cy = rect.top + rect.height / 2 - origin.y;
  const x = (cx * v.y - cy * v.x) / det;
  const y = (u.x * cy - u.y * cx) / det;
  const scale = Math.hypot(u.x, u.y);
  const cos = Math.abs(u.x) / scale;
  const sin = Math.abs(u.y) / scale;
  const across = rect.width / scale;
  const down = rect.height / scale;
  let w: number;
  let h: number;
  if (caret) {
    w = 0;
    h = Math.hypot(across, down);
  } else if (Math.abs(cos * cos - sin * sin) > 0.3) {
    // across = w·cos + h·sin, down = w·sin + h·cos.
    const d = cos * cos - sin * sin;
    w = (cos * across - sin * down) / d;
    h = (cos * down - sin * across) / d;
  } else {
    h = lineHeight;
    w = cos >= sin ? (across - h * sin) / cos : (down - h * cos) / sin;
  }
  w = Math.max(0, w);
  h = Math.max(0, h);
  return { x: x - w / 2, y: y - h / 2, w, h };
}
