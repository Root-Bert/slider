/*
 * A slide's stacking order in the layers view: element ids bottom first, as the file has them
 * and as `moveElement` counts (`to`: the place from the bottom, without the element itself).
 */

/**
 * The order shown: one restacked here while the server has not answered yet (`pending`) – of
 * the elements still there, new ones on top – else the slide's own.
 */
export function shownOrder(
  current: readonly string[],
  pending: readonly string[] | null,
): string[] {
  if (!pending) return [...current];
  const there = new Set(current);
  const kept = pending.filter((id) => there.has(id));
  const known = new Set(kept);
  return [...kept, ...current.filter((id) => !known.has(id))];
}

/** How picked elements are restacked: one place up or down, to the top or the bottom, or into a slot. */
export type Restacking = 'up' | 'down' | 'top' | 'bottom' | { slot: number };

/**
 * The order with `ids` restacked – together, each keeping its place among the others: `up` and
 * `down` past the next element not picked, `top` and `bottom` all the way, a `slot` (0 to the
 * length: under the element there, the end on top) as one block. `null` when nothing moves.
 */
export function restacked(
  order: readonly string[],
  ids: readonly string[],
  how: Restacking,
): string[] | null {
  const picked = new Set(ids.filter((id) => order.includes(id)));
  if (picked.size === 0) return null;
  const next = [...order];
  const swap = (at: number) => {
    [next[at], next[at + 1]] = [next[at + 1] as string, next[at] as string];
  };
  const block = order.filter((id) => picked.has(id));
  const others = order.filter((id) => !picked.has(id));
  if (how === 'up') {
    for (let at = next.length - 2; at >= 0; at -= 1) {
      if (picked.has(next[at] as string) && !picked.has(next[at + 1] as string)) swap(at);
    }
  } else if (how === 'down') {
    for (let at = 1; at < next.length; at += 1) {
      if (picked.has(next[at] as string) && !picked.has(next[at - 1] as string)) swap(at - 1);
    }
  } else {
    const below =
      how === 'top'
        ? others.length
        : how === 'bottom'
          ? 0
          : order.slice(0, Math.max(0, how.slot)).filter((id) => !picked.has(id)).length;
    next.splice(0, next.length, ...others.slice(0, below), ...block, ...others.slice(below));
  }
  return next.every((id, at) => id === order[at]) ? null : next;
}

type MoveOperation = { type: 'moveElement'; elementId: string; to: number };

/**
 * The `moveElement`s that turn `order` into `next` (the same elements, those not in `ids` in the
 * same order), one after another – moving only `ids`: each to its place, lowest first; where one
 * would push another out of place, all go to the top first.
 */
export function moveOperations(
  order: readonly string[],
  next: readonly string[],
  ids: readonly string[],
): MoveOperation[] {
  const moving = next.filter((id) => ids.includes(id));
  const place = (start: readonly string[], targets: readonly [string, number][]) => {
    const now = [...start];
    const operations: MoveOperation[] = [];
    for (const [id, to] of targets) {
      if (now.indexOf(id) === to) continue;
      now.splice(now.indexOf(id), 1);
      now.splice(to, 0, id);
      operations.push({ type: 'moveElement', elementId: id, to });
    }
    return { now, operations };
  };
  const targets = moving.map((id) => [id, next.indexOf(id)] as [string, number]);
  const direct = place(order, targets);
  if (direct.now.every((id, at) => id === next[at])) return direct.operations;
  const top = place(
    order,
    moving.map((id) => [id, order.length - 1] as [string, number]),
  );
  return [...top.operations, ...place(top.now, targets).operations];
}
