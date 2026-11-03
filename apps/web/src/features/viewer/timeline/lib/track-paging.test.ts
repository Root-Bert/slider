import { describe, expect, it } from 'vitest';
import { isWheelNotch, pageStep, rubberBand, springAt, unrubber } from './track-paging';

describe('track paging', () => {
  it('pages like a phone: rubber past the ends, a spring that lands, flicks and half-way go on', () => {
    // Rubber: gives way less and less, never a whole band; unrubber undoes it.
    expect(rubberBand(100, 400)).toBeCloseTo(48.4, 1);
    expect(rubberBand(-4000, 400)).toBeGreaterThan(-400);
    expect(unrubber(rubberBand(150, 400), 400)).toBeCloseTo(150, 6);

    // The spring lands within ~400 ms from a whole page, overshooting a pixel at most – also
    // flung on at a fast flick's speed.
    for (const [x0, v0] of [
      [-400, 0],
      [-360, 4],
      [250, -2],
    ] as const) {
      let over = 0;
      let landed = Infinity;
      for (let t = 0; t <= 800; t += 4) {
        const { x, v } = springAt(t, x0, v0);
        over = Math.max(over, Math.sign(x0) === Math.sign(x) ? 0 : Math.abs(x));
        if (Math.abs(x) < 0.5 && Math.abs(v) < 0.05) landed = Math.min(landed, t);
      }
      expect(over).toBeLessThan(1);
      expect(landed).toBeLessThan(400);
    }
    // It starts where it is and as fast as the release.
    expect(springAt(0, -300, 1.5)).toEqual({ x: -300, v: expect.closeTo(1.5, 6) });

    // Release: slow and short springs back, past half (coasted) or flicked goes on, a flick
    // against the swipe goes back.
    expect(pageStep(-30, -0.1, 400)).toBe(0);
    expect(pageStep(-180, -0.2, 400)).toBe(1);
    expect(pageStep(30, 0.6, 400)).toBe(-1);
    expect(pageStep(150, -0.6, 400)).toBe(0);
    expect(pageStep(3, 0.6, 400)).toBe(0);

    // A mouse notch vs a trackpad's pixels.
    expect(isWheelNotch({ deltaY: 3, deltaMode: 1 }, false)).toBe(true);
    expect(isWheelNotch({ deltaY: 4, deltaMode: 0, wheelDeltaY: -120 }, false)).toBe(true);
    expect(isWheelNotch({ deltaY: 40, deltaMode: 0, wheelDeltaY: -120 }, true)).toBe(false);
    expect(isWheelNotch({ deltaY: 12, deltaMode: 0, wheelDeltaY: -36 }, true)).toBe(false);
    expect(isWheelNotch({ deltaY: 100, deltaMode: 0 }, true)).toBe(true);
    expect(isWheelNotch({ deltaY: 100, deltaMode: 0 }, false)).toBe(false);
  });
});
