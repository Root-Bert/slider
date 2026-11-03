import { describe, expect, it } from 'vitest';
import { placeBelowOrAbove } from './geometry';

const viewport = { width: 1000, height: 800 };
const popover = { width: 300, height: 200 };

describe('placeBelowOrAbove', () => {
  it('goes under the target centred on it, over it without room, and stays in the viewport', () => {
    const below = placeBelowOrAbove(
      { left: 400, top: 100, right: 600, bottom: 300 },
      popover,
      viewport,
    );
    expect(below).toEqual({ left: 350, top: 316, side: 'below' });
    const above = placeBelowOrAbove(
      { left: 400, top: 400, right: 600, bottom: 700 },
      popover,
      viewport,
    );
    expect(above).toEqual({ left: 350, top: 184, side: 'above' });
    const at = placeBelowOrAbove({ left: 0, top: 100, right: 100, bottom: 200 }, popover, viewport);
    expect(at.left).toBe(12);
  });
});
