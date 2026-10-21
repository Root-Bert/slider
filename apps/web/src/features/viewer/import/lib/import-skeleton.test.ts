import { describe, expect, it } from 'vitest';
import {
  APPEAR_STAGGER,
  appearDelay,
  DEAL_STAGGER,
  importPicture,
  LAND_MS,
  slotState,
  tourDwell,
  tourPicture,
  tourPrintAt,
} from './import-skeleton';

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

  it('counts the visible slides once they are known – the progress counts the hidden ones too', () => {
    const picture = importPicture(
      { status: 'running', step: 'rendering', progress: { done: 0, total: 6 } },
      5,
    );
    expect(picture.count).toBe(5);
  });

  it('has every slide rendered while the comments import', () => {
    const picture = importPicture({ status: 'running', step: 'comments', progress: null }, 4);
    expect(picture).toMatchObject({ count: 4, rendered: 4, current: -1, comments: true });
  });
});

describe('tourPicture', () => {
  // The renderer reports nothing for most of the import: the tour goes its own way.
  const rendering = importPicture(
    { status: 'running', step: 'rendering', progress: { done: 0, total: 4 } },
    4,
  );

  it('shows the toured slides printed and the next one at work', () => {
    const picture = tourPicture(rendering, 2, false);
    expect(picture).toMatchObject({ count: 4, rendered: 2, current: 2 });
    expect([1, 2, 3].map((i) => slotState(i, picture))).toEqual(['rendered', 'current', 'pending']);
  });

  it('has nothing at work once the tour is through', () => {
    expect(tourPicture(rendering, 9, false)).toMatchObject({ rendered: 4, current: -1 });
  });

  it('starts nothing new once the import is done – the rest stays as it is', () => {
    const ready = importPicture({ status: 'ready' }, 4);
    expect(tourPicture(ready, 2, true)).toMatchObject({ count: 4, rendered: 2, current: -1 });
  });

  it('leaves ghosts and failures alone', () => {
    const counting = importPicture({ status: 'running', step: 'parsing', progress: null }, 0);
    expect(tourPicture(counting, 0, false)).toBe(counting);
    const failed = importPicture({ status: 'failed', error: 'x' }, 4);
    expect(tourPicture(failed, 1, false)).toBe(failed);
  });
});

describe('tourDwell', () => {
  it('lingers on short decks and hurries a little on long ones, within bounds', () => {
    expect(tourDwell(1)).toBe(3300);
    expect(tourDwell(5)).toBe(3300);
    expect(tourDwell(10)).toBe(1650);
    expect(tourDwell(200)).toBe(1500);
  });
});

describe('tourPrintAt', () => {
  it('gives the first slide as much time as the others, counted from when the stage showed', () => {
    // Counted quickly: slide 1 has worked since 0 and prints one dwell later, like all others.
    expect(tourPrintAt(0, 0, 1000, 2700)).toBe(2700);
    expect(tourPrintAt(1, 0, 1000, 2700) - tourPrintAt(0, 0, 1000, 2700)).toBe(2700);
  });

  it('moves on no earlier than the second slide has landed', () => {
    const landed = 5000 + DEAL_STAGGER + LAND_MS;
    expect(tourPrintAt(0, 0, 5000, 2700)).toBe(landed);
    expect(tourPrintAt(2, 0, 5000, 2700)).toBe(landed + 2 * 2700);
  });
});

describe('appearDelay', () => {
  it('lets the slides appear one after another up to the 20th – all further ones with it', () => {
    expect([0, 1, 2].map(appearDelay)).toEqual([0, APPEAR_STAGGER, 2 * APPEAR_STAGGER]);
    expect(appearDelay(19)).toBe(19 * APPEAR_STAGGER);
    expect(appearDelay(20)).toBe(appearDelay(19));
    expect(appearDelay(80)).toBe(appearDelay(19));
  });
});
