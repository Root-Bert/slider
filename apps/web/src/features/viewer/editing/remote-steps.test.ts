import { NO_EFFECTS, type EditableElement, type SlideOperation } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { rebased, restacked, settledAt, withRemoteStep } from './remote-steps';

const box = (id: string, x = 0.1): EditableElement => ({
  id,
  kind: 'shape',
  name: id,
  role: null,
  credit: null,
  bbox: { x, y: 0.1, w: 0.2, h: 0.2 },
  rotation: 0,
  look: { fill: '#ff0000', fills: [], fillAspect: null, stroke: null, effects: NO_EFFECTS },
  tilt: null,
  flip: null,
  paragraphs: null,
  movable: true,
  resizable: true,
  live: null,
});

describe('someone else’s steps', () => {
  it('show at once under the own edits on their way – both properties survive, the own on top', () => {
    const drawn = new Map([
      ['a', box('a')],
      ['b', box('b', 0.5)],
    ]);
    const context = {
      element: (id: string) => drawn.get(id),
      slideOfElement: (id: string) => (drawn.has(id) ? 's1' : undefined),
      slideOfPage: () => 's1',
      pageSize: { width: 25.4, height: 14.29 },
    };
    // Someone recolours a and moves b (step 7).
    const theirs: SlideOperation[] = [
      { type: 'setShapeStyle', elementId: 'a', fill: '#00ff00' },
      { type: 'setBox', elementId: 'b', box: { x: 0.6, y: 0.1, w: 0.2, h: 0.2 } },
    ];
    const { next, touched } = withRemoteStep(
      new Map(),
      { seq: 7, operations: theirs, clientEditId: null },
      context,
    );
    expect(touched).toEqual(['a', 'b']);
    expect(next.get('a')?.element?.look?.fill).toBe('#00ff00');
    expect(next.get('b')?.element?.bbox.x).toBe(0.6);

    // Here a was moved meanwhile, not yet confirmed: replayed over theirs, it keeps both – the
    // move of its own, their colour.
    const own: SlideOperation[] = [
      { type: 'setBox', elementId: 'a', box: { x: 0.3, y: 0.1, w: 0.2, h: 0.2 } },
    ];
    const mine = rebased(next.get('a')!.element, 'a', own);
    expect(mine?.bbox.x).toBe(0.3);
    expect(mine?.look?.fill).toBe('#00ff00');
    // The same property here too: the own stays on top until the server settles the order.
    const mineB = rebased(next.get('b')!.element, 'b', [
      { type: 'setBox', elementId: 'b', box: { x: 0.2, y: 0.1, w: 0.2, h: 0.2 } },
    ]);
    expect(mineB?.bbox.x).toBe(0.2);
    // In a group (entered): theirs on an element of it changes the group, the own over it too.
    const group = { ...box('g'), kind: 'group' as const, children: [box('c1'), box('c2', 0.5)] };
    const inGroup = withRemoteStep(
      new Map(),
      {
        seq: 8,
        operations: [{ type: 'setShapeStyle', elementId: 'c1', fill: '#00ff00' }],
        clientEditId: null,
      },
      {
        ...context,
        element: (id: string) => (id === 'g' ? group : undefined),
        slideOfElement: () => 's1',
        topOf: (id: string) => (id === 'c1' || id === 'c2' ? 'g' : id),
      },
    );
    expect(inGroup.touched).toEqual(['g']);
    const theirsInGroup = inGroup.next.get('g')!.element!;
    expect(theirsInGroup.children?.[0]?.look?.fill).toBe('#00ff00');
    const ownInGroup = rebased(theirsInGroup, 'g', [
      { type: 'setBox', elementId: 'c2', box: { x: 0.7, y: 0.1, w: 0.2, h: 0.2 } },
    ]);
    expect(ownInGroup?.children?.map((child) => child.bbox.x)).toEqual([0.1, 0.7]);
    expect(ownInGroup?.children?.[0]?.look?.fill).toBe('#00ff00');
    // One added here is not rebased (it has no base on the server yet).
    expect(
      rebased(null, 'n', [
        {
          type: 'addElement',
          pageId: 'p1',
          elementId: 'n',
          kind: 'rect',
          box: { x: 0, y: 0, w: 0.1, h: 0.1 },
          fill: null,
          stroke: null,
          paragraphs: [],
        },
      ]),
    ).toBeUndefined();

    // A delete of theirs leaves null; an add of theirs is there at once.
    const after = withRemoteStep(
      next,
      {
        seq: 8,
        clientEditId: 'other-tab',
        operations: [
          { type: 'deleteElement', elementId: 'b' },
          {
            type: 'addElement',
            pageId: 'p1',
            elementId: 'c',
            kind: 'rect',
            box: { x: 0.7, y: 0.7, w: 0.1, h: 0.1 },
            fill: '#0000ff',
            stroke: null,
            paragraphs: [],
          },
        ],
      },
      context,
    ).next;
    expect(after.get('b')?.element).toBeNull();
    expect(after.get('c')?.element?.bbox.x).toBe(0.7);

    // The edit state at step 7 has the first step: only step 8's changes stay; at 8 none.
    expect([...settledAt(after, 7).keys()].sort()).toEqual(['b', 'c']);
    expect(settledAt(after, 8).size).toBe(0);
    const untouched = settledAt(after, 6);
    expect(untouched).toBe(after);

    // Stacking moves on their way, in order: `to` counts from the bottom without the element.
    const stack = [box('x'), box('y'), box('z')];
    expect(
      restacked(stack, [
        { type: 'moveElement', elementId: 'z', to: 0 },
        { type: 'moveElement', elementId: 'x', to: 2 },
        { type: 'moveElement', elementId: 'gone', to: 0 },
      ]).map((element) => element.id),
    ).toEqual(['z', 'y', 'x']);
  });
});
