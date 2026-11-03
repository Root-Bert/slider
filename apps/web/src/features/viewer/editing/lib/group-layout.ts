import { turnedCorners, type Rect, type TurnedBox } from '@slider/shared';
import { grownToLines, type SnapLines } from '../../stage/lib/rect-edit';

/** Where elements picked together line up: on the box round all of them. */
export type GroupAlign = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** An element as it shows on the slide – turned, tilted – by its id. */
export interface GroupMember extends TurnedBox {
  id: string;
}

/** The upright box an element fills as it shows (turned, tilted), of the slide. */
export function shownRect(member: TurnedBox, aspect: number): Rect {
  const corners = turnedCorners(member, aspect);
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** The box round all of them. */
export function unionRect(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.w));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.h));
  return { x, y, w: right - x, h: bottom - y };
}

/** Whether `inner` lies wholly in `outer` – a frame drawn picks what it encloses, as PowerPoint. */
export const encloses = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

/** How far each element moves (of the slide) – only those that move. */
export type GroupMoves = Map<string, { dx: number; dy: number }>;

/** The whole slide: what one element alone lines up on. */
export const SLIDE_RECT: Rect = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Lined up on one side (or the middle) of `to` – by default the box round all of them (one alone:
 * pass the slide, `SLIDE_RECT`) –, as they show.
 */
export function alignMoves(
  members: readonly GroupMember[],
  how: GroupAlign,
  aspect: number,
  to?: Rect,
): GroupMoves {
  const shown = members.map((member) => ({ id: member.id, rect: shownRect(member, aspect) }));
  const all = to ?? unionRect(shown.map((item) => item.rect));
  const moves: GroupMoves = new Map();
  if (!all) return moves;
  for (const { id, rect } of shown) {
    let dx = 0;
    let dy = 0;
    if (how === 'left') dx = all.x - rect.x;
    else if (how === 'center') dx = all.x + all.w / 2 - (rect.x + rect.w / 2);
    else if (how === 'right') dx = all.x + all.w - (rect.x + rect.w);
    else if (how === 'top') dy = all.y - rect.y;
    else if (how === 'middle') dy = all.y + all.h / 2 - (rect.y + rect.h / 2);
    else dy = all.y + all.h - (rect.y + rect.h);
    if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) moves.set(id, { dx, dy });
  }
  return moves;
}

/**
 * The same space between each and the next, across (`x`) or down (`y`): the first and the last
 * stay, the others are spread between them in their order. Fewer than three: nothing to spread.
 */
export function distributeMoves(
  members: readonly GroupMember[],
  axis: 'x' | 'y',
  aspect: number,
): GroupMoves {
  const moves: GroupMoves = new Map();
  if (members.length < 3) return moves;
  const start = axis === 'x' ? 'x' : 'y';
  const size = axis === 'x' ? 'w' : 'h';
  const shown = members
    .map((member) => ({ id: member.id, rect: shownRect(member, aspect) }))
    .sort((a, b) => a.rect[start] + a.rect[size] / 2 - (b.rect[start] + b.rect[size] / 2));
  const first = shown[0]!.rect;
  const last = shown[shown.length - 1]!.rect;
  const span = last[start] + last[size] - first[start];
  const filled = shown.reduce((sum, item) => sum + item.rect[size], 0);
  const gap = (span - filled) / (shown.length - 1);
  let at = first[start];
  for (const { id, rect } of shown) {
    const d = at - rect[start];
    if (Math.abs(d) > 1e-6) moves.set(id, axis === 'x' ? { dx: d, dy: 0 } : { dx: 0, dy: d });
    at += rect[size] + gap;
  }
  return moves;
}

/**
 * Grown across (`x`) or down (`y`) to the next lines (`grownToLines`): one alone its own box, several
 * picked together the box round them – each stretched with it, in its place there. Only upright,
 * flat ones (as they are caught at lines); `null`: turned or tilted, or nothing to grow.
 */
export function growBoxes(
  members: readonly GroupMember[],
  axis: 'x' | 'y',
  lines: SnapLines,
): Map<string, Rect> | null {
  if (members.some((member) => (member.rotation ?? 0) !== 0 || member.tilt)) return null;
  const all = unionRect(members.map((member) => member.bbox));
  const grown = all && grownToLines(all, axis, lines);
  if (!all || !grown) return null;
  const start = axis === 'x' ? 'x' : 'y';
  const size = axis === 'x' ? 'w' : 'h';
  const scale = all[size] > 0 ? grown[size] / all[size] : 1;
  return new Map(
    members.map(({ id, bbox }) => [
      id,
      {
        ...bbox,
        [start]: grown[start] + (bbox[start] - all[start]) * scale,
        [size]: bbox[size] * scale,
      },
    ]),
  );
}

/** An element's box (before it is turned) and its turn, as a transform of those picked leaves it. */
export interface GroupFrame {
  rect: Rect;
  rotation: number;
}

/** An element picked together with others, and what a transform of them may change of it. */
export interface GroupMemberFrame extends GroupMember {
  /** Its size changes with theirs (`false`: a group of the file – only its place follows). */
  sizes: boolean;
  /** It turns with them (`false`: a group of the file – only its place goes round). */
  turns: boolean;
}

const turnedVector = (x: number, y: number, degrees: number) => {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
};

/**
 * Those picked together scaled with the box round them, `from` → `to` (as Figma): each one's
 * centre keeps its place in the box, its size goes with the box's along its own (turned) sides –
 * one that does not size (`sizes: false`) keeps its size, only its centre follows.
 */
export function scaledFrames(
  members: readonly GroupMemberFrame[],
  from: Rect,
  to: Rect,
): Map<string, GroupFrame> {
  const sx = from.w > 0 ? to.w / from.w : 1;
  const sy = from.h > 0 ? to.h / from.h : 1;
  const frames = new Map<string, GroupFrame>();
  for (const member of members) {
    const { bbox } = member;
    const rotation = member.rotation ?? 0;
    const cx = to.x + (bbox.x + bbox.w / 2 - from.x) * sx;
    const cy = to.y + (bbox.y + bbox.h / 2 - from.y) * sy;
    let { w, h } = bbox;
    if (member.sizes) {
      // Along its own sides, in true proportions: a quarter turned, its width goes with the height.
      const angle = (rotation * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      w = bbox.w * Math.hypot(sx * cos, sy * sin);
      h = bbox.h * Math.hypot(sx * sin, sy * cos);
    }
    frames.set(member.id, { rect: { x: cx - w / 2, y: cy - h / 2, w, h }, rotation });
  }
  return frames;
}

/**
 * Those picked together turned by `degrees` (clockwise) round the centre of the box round them
 * (`around`): each one's centre goes round it, its own turn grows by as much – one that does not
 * turn (`turns: false`) only goes round.
 */
export function turnedFrames(
  members: readonly GroupMemberFrame[],
  around: Rect,
  degrees: number,
  aspect: number,
): Map<string, GroupFrame> {
  const ox = (around.x + around.w / 2) * aspect;
  const oy = around.y + around.h / 2;
  const frames = new Map<string, GroupFrame>();
  for (const member of members) {
    const { bbox } = member;
    const rotation = member.rotation ?? 0;
    const offset = turnedVector(
      (bbox.x + bbox.w / 2) * aspect - ox,
      bbox.y + bbox.h / 2 - oy,
      degrees,
    );
    const cx = (ox + offset.x) / aspect;
    const cy = oy + offset.y;
    const turn = member.turns
      ? Math.round(((((rotation + degrees) % 360) + 360) % 360) * 10) / 10
      : rotation;
    frames.set(member.id, {
      rect: { x: cx - bbox.w / 2, y: cy - bbox.h / 2, w: bbox.w, h: bbox.h },
      rotation: turn % 360,
    });
  }
  return frames;
}
