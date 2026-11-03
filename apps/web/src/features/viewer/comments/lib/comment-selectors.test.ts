import { describe, expect, it } from 'vitest';
import { gapKey, nextThread, threadsInDeckOrder, type Thread } from './comment-selectors';

const thread = (id: string) => ({ id }) as Thread;

describe('threads in deck order', () => {
  it('lists slide by slide with the gap after each, and steps through them round', () => {
    const slides = [{ id: 's1' }, { id: 's2' }];
    const bySlide = new Map([
      ['s1', [thread('a'), thread('b')]],
      ['s2', [thread('d')]],
    ]);
    const byGap = new Map([
      [gapKey('s1', 's2'), [thread('c')]],
      [gapKey('s2', null), [thread('e')]],
    ]);
    expect(threadsInDeckOrder(slides, bySlide, byGap).map((t) => t.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);

    const ordered = [thread('a'), thread('b'), thread('c')];
    expect(nextThread(ordered, 'a')?.id).toBe('b');
    expect(nextThread(ordered, 'c')?.id).toBe('a');
    // Without a listed current thread it starts at the first.
    expect(nextThread(ordered, null)?.id).toBe('a');
    expect(nextThread(ordered, 'x')?.id).toBe('a');
    expect(nextThread([], null)).toBeNull();
  });
});
