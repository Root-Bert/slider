import {
  findElement,
  parentOf,
  type AddElementOperation,
  type EditableElement,
  type EditSlide,
  type GroupElementsOperation,
  type SlideOperation,
} from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { addedElement, applyToElement, enteredIn, groupedElement } from './live/model';
import {
  changedSince,
  freshIds,
  inverseOf,
  RESTORED,
  renamed,
  snapshotOf,
  touchedElements,
  without,
  type UndoContext,
} from './undo-ops';

const PAGE = { width: 25.4, height: 14.29 };
const box = (id: string, x: number): EditableElement =>
  addedElement(
    {
      type: 'addElement',
      pageId: 'p1',
      elementId: id,
      kind: 'rect',
      box: { x, y: 0.1, w: 0.2, h: 0.2 },
      fill: '#ff0000',
      stroke: null,
      paragraphs: [],
    } satisfies AddElementOperation,
    PAGE,
  );

/** A slide with `elements` (bottom first), its ops applied as the editor shows them. */
function world(elements: EditableElement[], slide: Partial<EditSlide> = {}) {
  let shown = new Map(elements.map((element) => [element.id, element as EditableElement | null]));
  const order = elements.map((element) => element.id);
  const slides = [
    { pageId: 'p0', index: 0, hidden: false, elements: [] },
    { pageId: 'p1', index: 1, hidden: false, notes: 'alt', elements, ...slide },
  ] as unknown as EditSlide[];
  const context = (): UndoContext => ({
    element: (id) => shown.get(id),
    pageOf: (id) => (order.includes(id) ? 'p1' : undefined),
    elementsOn: () => order.map((id) => shown.get(id)).filter((e): e is EditableElement => !!e),
    slides,
    slidePending: () => false,
  });
  const apply = (operations: readonly SlideOperation[]) => {
    const next = new Map(shown);
    for (const operation of operations) {
      if (operation.type === 'copyElement') {
        const source = next.get(operation.elementId) ?? null;
        next.set(operation.newElementId, source && { ...source, id: operation.newElementId });
        order.push(operation.newElementId);
      } else if ('elementId' in operation) {
        const element = next.get(operation.elementId);
        if (element) next.set(operation.elementId, applyToElement(element, operation));
      }
    }
    shown = next;
  };
  return { context, apply, element: (id: string) => shown.get(id) };
}

describe('undo in the browser', () => {
  it('takes edits back from the elements as shown, and leaves what someone else changed', () => {
    const a = box('sla-0001', 0.1);
    const b = box('slb-0001', 0.5);
    const w = world([a, b], { transition: 'fade', ownBackground: false, backgroundFills: [] });

    // A move of two at once, a fill, then a delete: each way back restores what was.
    const move: SlideOperation[] = [
      { type: 'setBox', elementId: a.id, box: { ...a.bbox, x: 0.3 }, rotation: 30 },
      { type: 'setBox', elementId: b.id, box: { ...b.bbox, x: 0.7 } },
    ];
    const moveBack = inverseOf(move, w.context())!;
    expect(moveBack.operations).toEqual([
      { type: 'setBox', elementId: b.id, box: b.bbox },
      { type: 'setBox', elementId: a.id, box: a.bbox, rotation: 0 },
    ]);
    const touched = touchedElements(move);
    const before = snapshotOf(touched, w.element);
    w.apply(move);
    const after = snapshotOf(touched, w.element);
    expect(changedSince(after, w.element).size).toBe(0);
    expect(changedSince(before, w.element)).toEqual(new Set([a.id, b.id]));

    // A line: an end dragged (its box and way), turned with others, its heads – each back.
    {
      const line = addedElement(
        {
          type: 'addElement',
          pageId: 'p1',
          elementId: 'slline-0001',
          kind: 'line',
          box: { x: 0.1, y: 0.1, w: 0.4, h: 0.2 },
          flip: { x: true, y: false },
          heads: 'end',
          fill: null,
          stroke: { color: '#000000', width: 2 },
          paragraphs: [],
        },
        PAGE,
      );
      expect(line).toMatchObject({
        kind: 'line',
        paint: { outline: 'line' },
        line: { heads: 'end' },
      });
      const lw = world([line]);
      // Laid level, its end where the other was.
      const drag: SlideOperation[] = [
        {
          type: 'setBox',
          elementId: line.id,
          box: { x: 0.1, y: 0.1, w: 0.4, h: 0 },
          flip: { x: false, y: false },
        },
        { type: 'setShapeStyle', elementId: line.id, heads: 'both' },
      ];
      const back = inverseOf(drag, lw.context())!;
      expect(back.operations).toEqual([
        { type: 'setShapeStyle', elementId: line.id, heads: 'end' },
        { type: 'setBox', elementId: line.id, box: line.bbox, flip: { x: true, y: false } },
      ]);
      lw.apply(drag);
      expect(lw.element(line.id)).toMatchObject({ bbox: { h: 0 }, line: { heads: 'both' } });
      // Turned (with others picked together): its ends turn round its centre, it keeps no turn –
      // and the way back lays it as it ran.
      const turn: SlideOperation[] = [
        { type: 'setBox', elementId: line.id, box: lw.element(line.id)!.bbox, rotation: 90 },
      ];
      const unturn = inverseOf(turn, lw.context())!;
      lw.apply(turn);
      const turned = lw.element(line.id)!;
      expect(turned.rotation).toBe(0);
      expect(turned.bbox.w).toBeCloseTo(0, 6);
      lw.apply(unturn.operations);
      expect(lw.element(line.id)!.bbox).toMatchObject({ x: 0.1, w: expect.closeTo(0.4, 6) });
      expect(lw.element(line.id)!.flip).toEqual({ x: false, y: false });
    }

    // Two operations on one element in one edit: the second's way back sees the first applied.
    const twice = inverseOf(
      [
        {
          type: 'setShapeStyle',
          elementId: a.id,
          fills: [{ type: 'solid', color: '#00ff00', opacity: 1, visible: true }],
        },
        { type: 'setShapeStyle', elementId: a.id, stroke: { color: '#000000', width: 2 } },
      ],
      w.context(),
    )!;
    expect(twice.operations.map((operation) => Object.keys(operation).sort())).toEqual([
      ['elementId', 'stroke', 'type'],
      ['elementId', 'fills', 'type'],
    ]);

    // Deleted: brought back from the file under a new id, at its place in the stacking order.
    const del = inverseOf([{ type: 'deleteElement', elementId: a.id }], w.context())!;
    expect(del.operations).toEqual([
      {
        type: 'copyElement',
        elementId: a.id,
        pageId: 'p1',
        newElementId: RESTORED,
        box: w.element(a.id)!.bbox,
      },
      { type: 'moveElement', elementId: RESTORED, to: 0 },
    ]);
    expect(del.sources.get(a.id)?.id).toBe(a.id);
    const sent = freshIds(del.operations, () => 'slnew-0001');
    expect(
      sent.operations.map((operation) =>
        operation.type === 'copyElement'
          ? operation.newElementId
          : 'elementId' in operation
            ? operation.elementId
            : null,
      ),
    ).toEqual(['slnew-0001', 'slnew-0001']);
    expect(sent.renames).toEqual(new Map([[a.id, 'slnew-0001']]));
    expect(renamed([{ type: 'deleteElement', elementId: a.id }], sent.renames)).toEqual([
      { type: 'deleteElement', elementId: 'slnew-0001' },
    ]);
    // Someone else changed the element: its part is left out, the restored one rides with it.
    expect(without(del.operations, new Set([a.id]))).toEqual([]);
    expect(without(moveBack.operations, new Set([b.id]))).toEqual([moveBack.operations[1]]);

    // Grouped (b listed first): taken apart, each back at its place, bottom first; an ungroup has
    // no way back here (the server's).
    const group: SlideOperation = {
      type: 'groupElements',
      elementIds: [b.id, a.id],
      newElementId: 'slgroup-0001',
    };
    expect(inverseOf([group], w.context())!.operations).toEqual([
      { type: 'ungroupElements', elementId: 'slgroup-0001' },
      { type: 'moveElement', elementId: a.id, to: 0 },
      { type: 'moveElement', elementId: b.id, to: 1 },
    ]);
    expect(touchedElements([group])).toEqual(['slgroup-0001', b.id, a.id]);
    expect(inverseOf([{ type: 'ungroupElements', elementId: 'slgroup-0001' }], w.context())).toBe(
      null,
    );

    // In a group (entered, Figma): an element of it moved back by its id; one deleted brought
    // back into the group at its place there, restacked there.
    const grouped = groupedElement(group as GroupElementsOperation, [a, b], 16 / 9);
    const inside: UndoContext = {
      ...w.context(),
      element: (id) => findElement([grouped], id),
      groupOf: (id) => parentOf([grouped], id),
    };
    expect(
      inverseOf([{ type: 'setBox', elementId: a.id, box: { ...a.bbox, x: 0.6 } }], inside)!
        .operations,
    ).toEqual([{ type: 'setBox', elementId: a.id, box: a.bbox }]);
    expect(inverseOf([{ type: 'deleteElement', elementId: a.id }], inside)!.operations).toEqual([
      {
        type: 'copyElement',
        elementId: a.id,
        pageId: 'p1',
        newElementId: RESTORED,
        box: a.bbox,
        groupId: grouped.id,
      },
      { type: 'moveElement', elementId: RESTORED, to: 0 },
    ]);
    // Its group drawn so at once: the part moved, the box round the parts again; the group moved,
    // its parts with it; the last part deleted, no group.
    const movedPart = applyToElement(grouped, {
      type: 'setBox',
      elementId: b.id,
      box: { ...b.bbox, x: 0.7 },
    })!;
    expect(findElement([movedPart], b.id)?.bbox.x).toBe(0.7);
    expect(movedPart.bbox.x + movedPart.bbox.w).toBeCloseTo(0.9, 6);
    const shifted = applyToElement(grouped, {
      type: 'setBox',
      elementId: grouped.id,
      box: { ...grouped.bbox, y: grouped.bbox.y + 0.1 },
    })!;
    expect(shifted.children?.map((child) => child.bbox.y)).toEqual(
      [0.2, 0.2].map((y) => expect.closeTo(y, 6)),
    );
    const emptied = [a.id, b.id].reduce<EditableElement | null>(
      (group, elementId) => group && applyToElement(group, { type: 'deleteElement', elementId }),
      grouped,
    );
    expect(emptied).toBeNull();
    expect(enteredIn([grouped, box('slc-0001', 0.8)], grouped.id).map((item) => item.id)).toEqual([
      a.id,
      b.id,
      'slc-0001',
    ]);

    // Added things go again; a slide's own settings come back from the slide as it was.
    expect(
      inverseOf(
        [{ type: 'addSlide', like: 'p1', newPageId: 'slpage-01', after: 'p1' }],
        w.context(),
      )?.operations,
    ).toEqual([{ type: 'deleteSlide', pageId: 'slpage-01' }]);
    expect(
      inverseOf(
        [
          { type: 'setSlideTransition', pageId: 'p1', transition: 'none' },
          { type: 'setSlideNotes', pageId: 'p1', text: 'neu' },
          { type: 'moveSlide', pageId: 'p1', after: null },
          { type: 'setSlideBackground', pageId: 'p1', color: '#000000' },
        ],
        w.context(),
      )?.operations,
    ).toEqual([
      { type: 'setSlideBackground', pageId: 'p1', color: null },
      { type: 'moveSlide', pageId: 'p1', after: 'p0' },
      { type: 'setSlideNotes', pageId: 'p1', text: 'alt' },
      { type: 'setSlideTransition', pageId: 'p1', transition: 'fade' },
    ]);

    // Only the server has what these replaced: no way back here (the server takes the step back).
    expect(inverseOf([{ type: 'deleteSlide', pageId: 'p1' }], w.context())).toBeNull();
    expect(
      inverseOf([{ type: 'replaceImage', elementId: b.id, imageId: 'img' }], w.context()),
    ).toBeNull();
    expect(
      inverseOf([{ type: 'setTilt', elementId: b.id, tilt: null, picture: null }], w.context()),
    ).toBeNull();
    const pending = { ...w.context(), slidePending: () => true };
    expect(inverseOf([{ type: 'setSlideHidden', pageId: 'p1', hidden: true }], pending)).toBeNull();
  });
});
