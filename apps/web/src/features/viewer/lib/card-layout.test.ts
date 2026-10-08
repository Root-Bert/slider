import { describe, expect, it } from 'vitest';
import { bandCapacity, brickLayout, planBands } from './card-layout';

describe('brickLayout', () => {
  it('staggers seven cards into two rows like Figma B1', () => {
    const { cards, height } = brickLayout([90, 90, 90, 160, 90, 90, 90], 1408);
    // First row: cards 0, 2, 4, 6, 280px wide with 96px gutters.
    expect(cards.filter((_, i) => i % 2 === 0).map((card) => card.left)).toEqual([
      0, 376, 752, 1128,
    ]);
    expect(cards[0]!.width).toBe(280);
    // Second-row cards enter (left + 26) in the middle of the gutter before them.
    expect(cards.filter((_, i) => i % 2 === 1).map((card) => card.left + 26)).toEqual([
      280 + 48,
      656 + 48,
      1032 + 48,
    ]);
    // Below the taller of the two first-row cards they overlap: card 3 sits under card 2 and 4.
    expect(cards[1]!.top).toBe(138);
    expect(cards[3]!.top).toBe(138);
    expect(height).toBe(138 + 160);
  });

  it('narrows the gutters before the cards', () => {
    const { cards } = brickLayout([90, 90, 90, 90, 90, 90, 90], 1376);
    expect(cards[0]!.width).toBe(280);
    expect(cards[2]!.left).toBeCloseTo(280 + 85.33, 1);
    expect(brickLayout([90, 90, 90, 90, 90, 90, 90], 1216).cards[0]!.width).toBe(244);
  });

  it('keeps every second-row entry clear of the first-row cards', () => {
    const { cards } = brickLayout([80, 80, 80, 80, 80, 80, 80], 1216);
    const firstRow = cards.filter((_, i) => i % 2 === 0);
    for (const card of cards.filter((_, i) => i % 2 === 1)) {
      const entry = card.left + 26;
      for (const above of firstRow)
        expect(entry < above.left || entry > above.left + above.width).toBe(true);
    }
  });

  it('continues in a new band when a row is full', () => {
    const { cards } = brickLayout([100, 100, 100, 100, 100], 600);
    // 600px fit two 220px+ cards per row: band 1 = cards 0–2, band 2 starts below.
    expect(cards.map((card) => card.top)).toEqual([0, 148, 0, 296, 444]);
    expect(cards[3]!.left).toBe(0);
  });

  it('uses the full width for a single narrow column', () => {
    const { cards } = brickLayout([50, 50], 240);
    expect(cards.map((card) => [card.left, card.top, card.width])).toEqual([
      [0, 0, 240],
      [0, 98, 240],
    ]);
  });
});

describe('planBands', () => {
  it('keeps the clockwise order when everything fits into one band', () => {
    expect(planBands(7, 3, bandCapacity(1408))).toEqual({
      order: [0, 1, 2, 3, 4, 5, 6],
      margin: [null, null, null, null, null, null, null],
      bandGap: 48,
    });
  });

  it('moves the outermost lines of the clockwise order into the lower band', () => {
    // Five cards per band: the first band takes the middle, the left-exiting line 0 and the
    // outermost right line 6 go below, line 0 down the left margin, line 6 down the right one.
    const plan = planBands(7, 1, 5);
    expect(plan.order).toEqual([1, 2, 3, 4, 5, 0, 6]);
    expect(plan.margin).toEqual([null, null, null, null, null, 'left', 'right']);
  });

  it('prefers the left margin for lines that leave the slide to the left', () => {
    expect(planBands(7, 3, 5).order).toEqual([2, 3, 4, 5, 6, 0, 1]);
  });

  it('gives the deepest band the outermost lines and makes room for their turns', () => {
    // 12 cards, 6 leaving left, 4 per band: lines 0–5 run down the left margin, 10 and 11 down
    // the right one; the deepest band takes the outermost of both.
    const plan = planBands(12, 6, 4);
    expect(plan.order).toEqual([6, 7, 8, 9, 3, 4, 5, 10, 0, 1, 2, 11]);
    expect(plan.margin.slice(4)).toEqual([
      'left',
      'left',
      'left',
      'right',
      'left',
      'left',
      'left',
      'right',
    ]);
    // Three lines turn in above each lower band: 12 + 2 × 10 + 20.
    expect(plan.bandGap).toBe(52);
  });
});
