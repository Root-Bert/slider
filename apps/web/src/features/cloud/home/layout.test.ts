import { describe, expect, it } from 'vitest';
import {
  addWidget,
  DEFAULT_LAYOUT,
  moveWidget,
  nearestWidth,
  newWidget,
  parseLayout,
  removeWidget,
  spanOf,
} from './layout';

describe('home layout', () => {
  it('keeps what is stored sound, moves and adds widgets, and fits them to the columns', () => {
    // Nothing (or garbage) stored: today's page.
    expect(parseLayout(null)).toBe(DEFAULT_LAYOUT);
    expect(DEFAULT_LAYOUT.map((widget) => widget.type)).toEqual([
      'order',
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
      'nonsense',
    ]);
    expect(parsed).toEqual([
      { id: 'a', type: 'todos', w: 6, h: 12, look: 'none', title: true },
      { id: 'd', type: 'note', w: 3, h: 3, look: 'fill', title: true, text: 'Milch' },
      { id: 'e', type: 'note', w: 3, h: 'auto', look: 'line', title: false, text: '' },
    ]);
    // The order field and „Für dich“ say themselves what they are: no heading at first.
    expect(newWidget('order').title).toBe(false);

    // Moving is putting it elsewhere in the list; beyond the ends it stops there.
    const ids = (list: readonly { id: string }[]) => list.map((widget) => widget.id);
    expect(ids(moveWidget(parsed, 'a', 2))).toEqual(['d', 'e', 'a']);
    expect(ids(moveWidget(parsed, 'e', -4))).toEqual(['e', 'a', 'd']);
    expect(moveWidget(parsed, 'missing', 0)).toBe(parsed);
    // One of a kind is not added twice; a note is, where it is dropped.
    expect(addWidget(parsed, newWidget('todos', 'z'))).toBe(parsed);
    expect(ids(addWidget(parsed, newWidget('note', 'n'), 1))).toEqual(['a', 'n', 'd', 'e']);
    expect(ids(removeWidget(parsed, 'd'))).toEqual(['a', 'e']);

    // Twelve columns wide, six on a tablet (up to half stays half), one on a phone.
    expect([spanOf(4, 12), spanOf(4, 6), spanOf(8, 6), spanOf(12, 1)]).toEqual([4, 3, 6, 1]);
    // A dragged edge snaps to the nearest width there is.
    expect([nearestWidth(1), nearestWidth(5.2), nearestWidth(7.4), nearestWidth(30)]).toEqual([
      3, 6, 8, 12,
    ]);
  });
});
