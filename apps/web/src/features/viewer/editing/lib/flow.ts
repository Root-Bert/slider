import type { EditableElement, ElementFlow, Rect, SlideOperation } from '@slider/shared';
import { applyToElement, groupedElement } from '../live/model';
import { shownRect, unionRect } from './group-layout';

/** What laying out a flow needs of the editor (`flowed`). */
export interface FlowContext {
  /** An element as shown now – one in a group too (`undefined`/`null`: none). */
  element: (elementId: string) => EditableElement | null | undefined;
  /** The group an element lies directly in, as shown now. */
  groupOf: (elementId: string) => EditableElement | undefined;
  /** The height a text growing with its text shows at (measured), if known. */
  heightOf: (elementId: string) => number | null;
  /** The slides' size in cm. */
  pageSize: { width: number; height: number };
}

/**
 * Where each of a flow's elements goes (its upright box as it shows, of the slide): in their
 * order on the slide along the flow (by their middles, across as the tie-break), one after the
 * other from the start of the area they flow in – `gap` cm apart, or spread over its whole length
 * (`auto`) –, lined up across at its start, middle or end. That area is the flow's own frame, else
 * `anchor` (the group as it was before the edit, so it does not creep), else the box round them.
 * Only those that move, by how much.
 */
export function flowMoves(
  members: readonly { id: string; rect: Rect }[],
  flow: ElementFlow,
  pageSize: { width: number; height: number },
  anchor?: Rect,
): Map<string, { dx: number; dy: number }> {
  const moves = new Map<string, { dx: number; dy: number }>();
  const area = flow.frame ?? anchor ?? unionRect(members.map((member) => member.rect));
  if (!area || members.length === 0) return moves;
  const row = flow.direction === 'row';
  const along = row ? 'x' : 'y';
  const across = row ? 'y' : 'x';
  const length = row ? 'w' : 'h';
  const breadth = row ? 'h' : 'w';
  const middle = (rect: Rect, key: 'x' | 'y', size: 'w' | 'h') => rect[key] + rect[size] / 2;
  const ordered = [...members].sort(
    (a, b) =>
      middle(a.rect, along, length) - middle(b.rect, along, length) ||
      middle(a.rect, across, breadth) - middle(b.rect, across, breadth),
  );
  const filled = ordered.reduce((sum, member) => sum + member.rect[length], 0);
  const gap =
    flow.gap === 'auto'
      ? ordered.length > 1
        ? Math.max(0, (area[length] - filled) / (ordered.length - 1))
        : 0
      : flow.gap / (row ? pageSize.width : pageSize.height);
  let at = area[along];
  for (const { id, rect } of ordered) {
    const to =
      flow.align === 'start'
        ? area[across]
        : flow.align === 'end'
          ? area[across] + area[breadth] - rect[breadth]
          : area[across] + (area[breadth] - rect[breadth]) / 2;
    const dAlong = at - rect[along];
    const dAcross = to - rect[across];
    at += rect[length] + gap;
    if (Math.abs(dAlong) < 1e-6 && Math.abs(dAcross) < 1e-6) continue;
    moves.set(id, row ? { dx: dAlong, dy: dAcross } : { dx: dAcross, dy: dAlong });
  }
  return moves;
}

/**
 * An edit with the flows it touches laid out again (Figma's auto layout): a flow switched on or
 * changed (`setFlow`), one of its elements moved, sized, typed into, deleted, or the flow group's
 * own box set – sized (or already in a frame of its own), that becomes its frame (`setFlow`).
 * The `setBox`es that put each element in its place follow in the same edit, so ⌘Z, the outbox
 * and the others take them as one step. The rest of the edit as it was.
 */
export function flowed(
  given: readonly SlideOperation[],
  context: FlowContext,
  aspect: number,
): SlideOperation[] {
  // A flow group's box: the area it flows in (Figma's fixed size) once sized; only moved and
  // without one, it moves with its parts as any group.
  const operations = given.map((operation): SlideOperation => {
    if (operation.type !== 'setBox') return operation;
    const group = context.element(operation.elementId);
    if (!group?.flow || !group.children) return operation;
    const { box } = operation;
    // Changed by more than the file's rounding (1/100 mm): its corners were dragged.
    const sized = Math.abs(box.w - group.bbox.w) > 1e-3 || Math.abs(box.h - group.bbox.h) > 1e-3;
    if (!sized && !group.flow.frame) return operation;
    return { type: 'setFlow', elementId: group.id, flow: { ...group.flow, frame: box } };
  });
  // A group made in the same edit (⇧A: those picked grouped with a flow at once).
  const madeIn = (all: readonly SlideOperation[], id: string) => {
    const made = all.find(
      (operation) => operation.type === 'groupElements' && operation.newElementId === id,
    );
    if (made?.type !== 'groupElements') return undefined;
    const members = made.elementIds.flatMap((elementId) => context.element(elementId) ?? []);
    return members.length > 0 ? groupedElement(made, members, aspect) : undefined;
  };
  const groups = new Map<string, EditableElement>();
  for (const operation of operations) {
    if (!('elementId' in operation)) continue;
    if (operation.type === 'setFlow') {
      const group = context.element(operation.elementId) ?? madeIn(operations, operation.elementId);
      if (group?.children) groups.set(group.id, group);
      continue;
    }
    const group = context.groupOf(operation.elementId);
    if (group?.flow) groups.set(group.id, group);
  }
  if (groups.size === 0) return operations;
  const extra: SlideOperation[] = [];
  for (const before of groups.values()) {
    let group: EditableElement | null = before;
    for (const operation of operations) {
      if (!group) break;
      group = applyToElement(group, operation, aspect);
    }
    if (!group?.flow || !group.children) continue;
    // As they show – a text grown with its text by its measured height –, before and after.
    const shownOf = (children: readonly EditableElement[]) =>
      children.map((child) => {
        const measured = child.live?.autoGrow ? context.heightOf(child.id) : null;
        const bbox =
          measured !== null && measured > child.bbox.h
            ? { ...child.bbox, h: measured }
            : child.bbox;
        return { id: child.id, rect: shownRect({ ...child, bbox }, aspect) };
      });
    const members = shownOf(group.children);
    const anchor = unionRect(shownOf(before.children ?? []).map((member) => member.rect));
    const moves = flowMoves(members, group.flow, context.pageSize, anchor ?? before.bbox);
    for (const child of group.children) {
      const move = moves.get(child.id);
      if (!move) continue;
      const { bbox } = child;
      extra.push({
        type: 'setBox',
        elementId: child.id,
        box: { ...bbox, x: bbox.x + move.dx, y: bbox.y + move.dy },
      });
    }
  }
  return [...operations, ...extra];
}

/**
 * The flow those elements already nearly stand in (Figma's ⇧A): a row when they spread more
 * across than down, the space between neighbours their mean gap (in cm, a tenth, none below 0),
 * lined up at the start.
 */
export function inferredFlow(
  rects: readonly Rect[],
  pageSize: { width: number; height: number },
  /** This way, whichever way they spread. */
  direction?: ElementFlow['direction'],
): ElementFlow {
  const middles = (key: 'x' | 'y', size: 'w' | 'h', cm: number) =>
    rects.map((rect) => (rect[key] + rect[size] / 2) * cm);
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
  const row = direction
    ? direction === 'row'
    : spread(middles('x', 'w', pageSize.width)) >= spread(middles('y', 'h', pageSize.height));
  const along = row ? 'x' : 'y';
  const length = row ? 'w' : 'h';
  const cm = row ? pageSize.width : pageSize.height;
  const ordered = [...rects].sort((a, b) => a[along] + a[length] / 2 - (b[along] + b[length] / 2));
  const gaps = ordered
    .slice(1)
    .map((rect, index) => (rect[along] - (ordered[index]![along] + ordered[index]![length])) * cm);
  const mean = gaps.length > 0 ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : 0;
  return {
    direction: row ? 'row' : 'column',
    gap: Math.min(100, Math.max(0, Math.round(mean * 10) / 10)),
    align: 'start',
  };
}
