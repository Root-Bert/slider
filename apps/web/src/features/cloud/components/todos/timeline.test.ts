import { describe, expect, it } from 'vitest';
import type { Todo } from '@slider/shared';
import { heldUpBy, spanOf, startingTooEarly } from './timeline';

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
  });
});
