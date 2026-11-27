import { describe, expect, it } from 'vitest';
import type { Todo } from '@slider/shared';
import { chevronsAlong, heldUpBy, linkRoute, spanOf, startingTooEarly } from './timeline';

type T = Pick<Todo, 'id' | 'status' | 'blockedBy' | 'startOn' | 'dueOn'>;
const todo = (
  id: string,
  startOn: string | null,
  dueOn: string | null,
  blockedBy: string[] = [],
  status: Todo['status'] = 'todo',
): T => ({ id, status, blockedBy, startOn, dueOn });

describe('timeline', () => {
  it('marks what waits on a to-do however far round, and red what starts on or before an open one it waits on is due', () => {
    const list = [
      todo('a', '2026-12-01', '2026-12-05'),
      todo('b', '2026-12-06', '2026-12-08', ['a']),
      todo('c', '2026-12-08', '2026-12-10', ['b']),
      todo('d', null, null, ['a']),
      todo('e', '2026-12-01', '2026-12-02', ['a'], 'done'),
      todo('f', '2026-12-01', '2026-12-02'),
    ];
    const byId = new Map(list.map((one) => [one.id, one]));
    const asIs = (id: string) => spanOf(byId.get(id)!);
    expect([...heldUpBy(list, 'a')].sort()).toEqual(['b', 'c', 'd', 'e']);
    expect(heldUpBy(list, 'c').size).toBe(0);
    // c starts the day b is due: too early; b after a, no dates, done – not.
    expect([...startingTooEarly(list, asIs).keys()]).toEqual(['c']);
    // a dragged a day on, onto b's start: b too; a done, b no longer.
    const moved = (id: string) =>
      id === 'a' ? (['2026-12-02', '2026-12-06'] as [string, string]) : asIs(id);
    expect([...startingTooEarly(list, moved).keys()].sort()).toEqual(['b', 'c']);
    const done = list.map((one) => (one.id === 'a' ? { ...one, status: 'done' as const } : one));
    expect([...startingTooEarly(done, moved).keys()]).toEqual(['c']);
    // Its line: out of the blocker's end, down, in from the left; right after it, in from above
    // where the stub stands; starting before its end, round between the two lines.
    const route = (left: number, right: number, y = 90) =>
      linkRoute({ y: 18, left: 0, right: 100 }, { y, left, right }, 36, 12).map(
        ({ x, y }) => `${x},${y}`,
      );
    expect(route(140, 200)).toEqual(['100,18', '110,18', '110,90', '140,90']);
    expect(route(104, 128)).toEqual(['100,18', '110,18', '110,78']);
    expect(route(104, 128, -54)).toEqual(['100,18', '110,18', '110,-42']);
    expect(route(40, 200)).toEqual(['100,18', '110,18', '110,36', '30,36', '30,90', '40,90']);
    // Its chevrons the way it runs, clear of corners and ends, counted from each run's start;
    // too short for any, one in the middle of its longest run.
    const marks = (points: { x: number; y: number }[]) =>
      chevronsAlong(points, 8, 20, 5).map(({ x, y, angle }) => `${x},${y},${angle}`);
    const bend = [
      { x: 0, y: 0 },
      { x: 0, y: 60 },
      { x: 70, y: 60 },
    ];
    expect(marks(bend)).toEqual(['0,5,90', '0,25,90', '0,45,90', '13,60,0', '33,60,0', '53,60,0']);
    expect(
      marks([
        { x: 0, y: 0 },
        { x: 0, y: 6 },
        { x: 4, y: 6 },
      ]),
    ).toEqual(['0,3,90']);
  });
});
