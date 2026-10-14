import { describe, expect, it } from 'vitest';
import { importPicture, slotState } from './import-skeleton';

describe('importPicture', () => {
  it('shows ghosts until the slides are counted', () => {
    const picture = importPicture({ status: 'running', step: 'parsing', progress: null }, 0);
    expect(picture.count).toBeNull();
    expect(slotState(0, picture)).toBe('ghost');
  });

  it('fills slides in as they render and marks the one in progress', () => {
    const picture = importPicture(
      { status: 'running', step: 'rendering', progress: { done: 2, total: 5 } },
      0,
    );
    expect(picture).toMatchObject({ count: 5, rendered: 2, current: 2 });
    expect([0, 1, 2, 3].map((i) => slotState(i, picture))).toEqual([
      'rendered',
      'rendered',
      'current',
      'pending',
    ]);
  });

  it('has every slide rendered while the comments import', () => {
    const picture = importPicture({ status: 'running', step: 'comments', progress: null }, 4);
    expect(picture).toMatchObject({ count: 4, rendered: 4, current: -1, comments: true });
  });
});
