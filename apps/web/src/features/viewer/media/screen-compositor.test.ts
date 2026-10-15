import { describe, expect, it } from 'vitest';
import { bubbleRect, containRect, fitWithin } from './screen-compositor';

describe('screen compositor geometry', () => {
  it('scales a screen down to 720p in even pixels, never up', () => {
    expect(fitWithin({ width: 2880, height: 1800 })).toEqual({ width: 1152, height: 720 });
    expect(fitWithin({ width: 1001, height: 501 })).toEqual({ width: 1002, height: 502 });
    expect(fitWithin({ width: 0, height: 0 })).toEqual({ width: 1280, height: 720 });
  });

  it('letterboxes a window into the frame', () => {
    expect(containRect({ width: 800, height: 800 }, { width: 1280, height: 720 })).toEqual({
      x: 280,
      y: 0,
      width: 720,
      height: 720,
    });
  });

  it('puts the camera bubble in the bottom right corner', () => {
    const bubble = bubbleRect({ width: 1280, height: 720 });
    expect(bubble.width).toBe(bubble.height);
    expect(bubble.x + bubble.width).toBeLessThan(1280);
    expect(bubble.y + bubble.height).toBeLessThan(720);
    expect(bubble.x).toBeGreaterThan(640);
  });
});
