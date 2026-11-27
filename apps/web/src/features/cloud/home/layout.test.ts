import { describe, expect, it } from 'vitest';
import {
  addWidget as addTo,
  arrange,
  changeWidget,
  CLOUD_BOARD,
  defaultLayout,
  nearestWidth,
  newWidget as newOf,
  parseLayout as parseFor,
  pinWidgets,
  placeWidget,
  removeWidget,
  ROW_STEPS,
  settleWidgets,
  spanOf,
  type HomeLayout,
  type Widget,
} from './layout';

// „Zuletzt“'s board.
const DEFAULT_LAYOUT = defaultLayout(CLOUD_BOARD);
const parseLayout = (value: unknown) => parseFor(CLOUD_BOARD, value);
const newWidget = (type: string, id?: string) => newOf(CLOUD_BOARD, type, id);
const addWidget = (layout: HomeLayout, widget: Widget, cell?: { x: number; y: number }) =>
  addTo(CLOUD_BOARD, layout, widget, cell);

describe('home layout', () => {
  it('keeps what is stored sound, moves and adds widgets, and fits them to the columns', () => {
    // Nothing (or garbage) stored: today's page.
    expect(parseLayout(null)).toBe(DEFAULT_LAYOUT);
    expect(DEFAULT_LAYOUT.map((widget) => widget.type)).toEqual([
      'forYou',
      'continue',
      'since',
      'unread',
      'todos',
      'events',
      'changed',
      'activity',
    ]);
    // Unknown kinds go, a second of a kind goes, wrong fields take their defaults, notes may be
    // several and keep their words.
    const parsed = parseLayout([
      { id: 'a', type: 'todos', w: 5, h: 99, look: 'neon', title: 'x' },
      { id: 'b', type: 'todos' },
      { id: 'c', type: 'weather' },
      { id: 'd', type: 'note', text: 'Milch' },
      { id: 'e', type: 'note', h: 'auto', look: 'line', title: false },
      { id: 'd', type: 'note' },
      { id: 'f', type: 'events', w: 8, x: 7, y: 2 },
      { id: 'g', type: 'changed', x: 1 },
      'nonsense',
    ]);
    expect(parsed).toEqual([
      { id: 'a', type: 'todos', w: 6, h: 12, look: 'none', title: true },
      { id: 'd', type: 'note', w: 3, h: 3, look: 'fill', title: true, text: 'Milch' },
      { id: 'e', type: 'note', w: 3, h: 'auto', look: 'line', title: false, text: '' },
      // A cell kept on the field (x moved in as far as the width needs); half a cell is none.
      { id: 'f', type: 'events', w: 8, h: 'auto', look: 'none', title: true, x: 4, y: 2 },
      { id: 'g', type: 'changed', w: 8, h: 7, look: 'none', title: true },
    ]);
    const three = parsed.slice(0, 3);
    // The order field and „Für dich“ say themselves what they are: no heading at first.
    expect(newWidget('order').title).toBe(false);

    const ids = (list: readonly { id: string }[]) => list.map((widget) => widget.id);
    // Never placed: packed in order from the top, the first free place each (the grid's dense
    // packing) – a 6 and two 3s side by side, heights in steps.
    const steps = (widget: Widget) => (widget.h === 'auto' ? 10 : widget.h * ROW_STEPS);
    const spots = arrange(three, steps, 12);
    expect([...spots.values()]).toEqual([
      { col: 0, span: 6, top: 0, steps: 216 },
      { col: 6, span: 3, top: 0, steps: 54 },
      { col: 9, span: 3, top: 0, steps: 10 },
    ]);
    // Pinned where they stand, then one put freely: its row and column, rows and cells left empty
    // stay empty; another in its way goes below it (and back once it is gone again).
    const pinned = pinWidgets(three, spots, 12);
    expect(pinned.map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [6, 0],
      [9, 0],
    ]);
    expect(pinWidgets(pinned, spots, 12)).toBe(pinned);
    const free = placeWidget(pinned, 'e', 6, 5);
    expect(ids(free)).toEqual(['a', 'd', 'e']);
    expect(arrange(free, steps, 12).get('e')).toEqual({ col: 6, span: 3, top: 90, steps: 10 });
    const onTop = placeWidget(pinned, 'e', 4, 0);
    expect(ids(onTop)).toEqual(['e', 'a', 'd']);
    expect(arrange(onTop, steps, 12).get('a')?.top).toBe(10);
    // Put on another: while it is held what lies there yields below it, and stays there once
    // let go (pushed a row on, then down to its end).
    const over = placeWidget(pinned, 'e', 0, 2);
    expect(arrange(over, steps, 12).get('e')?.top).toBe(216);
    expect(arrange(over, steps, 12, 'e').get('a')?.top).toBe(46);
    const settled = settleWidgets(over, steps, 12, 'e');
    expect(settled.find((w) => w.id === 'a')).toMatchObject({ y: 2 });
    expect([
      arrange(settled, steps, 12).get('e')?.top,
      arrange(settled, steps, 12).get('a')?.top,
    ]).toEqual([36, 46]);
    // A stack as high as its content, pinned: the lower one's row starts inside the one above
    // (30 steps over a row of 18). Changed in place it pushes nothing, and dropped there – just
    // under the one above – it goes snug below it.
    const stack: HomeLayout = [
      { ...newWidget('forYou', 'X'), x: 0, y: 0 },
      { ...newWidget('continue', 'Y'), x: 0, y: 1 },
    ];
    const tall = (widget: Widget) => (widget.id === 'X' ? 30 : 10);
    expect(arrange(stack, tall, 12, 'Y').get('Y')?.top).toBe(30);
    expect(arrange(stack, tall, 12, 'Y').get('X')?.top).toBe(0);
    expect(settleWidgets(stack, tall, 12, 'Y')).toBe(stack);
    // Off the field it stays on it; wider, it moves left as far as it must; on six columns its
    // column halves, on one it is a stack.
    expect(placeWidget(pinned, 'a', 11, -3).find((w) => w.id === 'a')).toMatchObject({
      x: 6,
      y: 0,
    });
    expect(changeWidget(free, 'e', { w: 12 }).find((w) => w.id === 'e')).toMatchObject({ x: 0 });
    expect(arrange(free, steps, 6).get('d')).toMatchObject({ col: 3, span: 3 });
    expect([...arrange(pinned, steps, 1).values()].map((spot) => spot.top)).toEqual([0, 216, 270]);
    expect(placeWidget(pinned, 'missing', 0, 0)).toBe(pinned);
    // One of a kind is not added twice; a note is, at the cell it is dropped on.
    expect(addWidget(three, newWidget('todos', 'z'))).toBe(three);
    const dropped = addWidget(pinned, newWidget('note', 'n'), { x: 3, y: 1 });
    expect(ids(dropped)).toEqual(['a', 'd', 'e', 'n']);
    expect(dropped.at(-1)).toMatchObject({ x: 3, y: 1 });
    expect(ids(removeWidget(three, 'd'))).toEqual(['a', 'e']);
    // The order field alone or „Für dich“ with it on top – never both: one takes the other's place
    // (its cell too), and a page kept with both keeps „Für dich“.
    const withOrder = addWidget(pinned, newWidget('order', 'o'), { x: 0, y: 9 });
    expect(addWidget(withOrder, newWidget('forYou', 'f')).at(-1)).toMatchObject({
      id: 'f',
      x: 0,
      y: 9,
    });
    expect(
      ids(
        parseLayout([
          { id: 'o', type: 'order' },
          { id: 'f', type: 'forYou' },
        ]),
      ),
    ).toEqual(['f']);

    // Twelve columns wide, six on a tablet (up to half stays half), one on a phone.
    expect([spanOf(4, 12), spanOf(4, 6), spanOf(8, 6), spanOf(12, 1)]).toEqual([4, 3, 6, 1]);
    // A dragged edge snaps to the nearest width there is.
    expect([nearestWidth(1), nearestWidth(5.2), nearestWidth(7.4), nearestWidth(30)]).toEqual([
      3, 6, 8, 12,
    ]);
    // No wider than the field to its right.
    expect(nearestWidth(12, 8)).toBe(8);
  });
});
