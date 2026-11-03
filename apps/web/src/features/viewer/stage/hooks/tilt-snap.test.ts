import { describe, expect, it } from 'vitest';
import { tiltArmed, tiltBy, tiltPerPx } from './useRectEdit';

/** The rate the cases below are worked out at. */
const RATE = 0.4;

describe('tiltBy', () => {
  it('snaps to straight, tilts by the box size and goes over the edge when it flips', () => {
    // 0.4° per pixel: 8 px right and 6 px up is 3° and 2° – close to straight.
    expect(tiltBy({ x: 0, y: 0 }, 8, -6, true, RATE)).toEqual({ x: 0, y: 0 });
    // Back from a tilt to close by straight: straight.
    expect(tiltBy({ x: 30, y: 0 }, 0, 70, true, RATE)).toEqual({ x: 0, y: 0 });
    // Each axis snaps flat on its own, and tilts beyond.
    expect(tiltBy({ x: 0, y: 0 }, 100, -5, true, RATE)).toEqual({ x: 0, y: 40 });
    expect(tiltBy({ x: 0, y: 0 }, 100, -50, true, RATE)).toEqual({ x: 20, y: 40 });
    // A drag starting straight does not snap until it was out once. Just begun: a small tilt shows at once.
    expect(tiltBy({ x: 0, y: 0 }, 5, 0, false, RATE)).toEqual({ x: 0, y: 2 });
    expect(tiltArmed(false, { x: 0, y: 0 }, 5, 0, RATE)).toBe(false);
    // Out of straight once (40°): from then on it snaps back to straight.
    expect(tiltArmed(false, { x: 0, y: 0 }, 100, 0, RATE)).toBe(true);
    expect(tiltBy({ x: 0, y: 0 }, 5, 0, true, RATE)).toEqual({ x: 0, y: 0 });
    // A large box tilts calmer than a small one, within bounds.
    // 600 × 800 px: centre to corner is 500 px – 0.13° per pixel, no slower than 0.15.
    expect(tiltPerPx(600, 800)).toBeCloseTo(0.15);
    expect(tiltPerPx(240, 320)).toBeCloseTo(0.325);
    // Tiny: no faster than 0.4° per pixel.
    expect(tiltPerPx(40, 30)).toBeCloseTo(0.4);

    // Flipping goes over the edge: never edge-on, straight again at half a turn.
    // 200 px right: 80° – no steeper than 70°, flipping or not.
    expect(tiltBy({ x: 0, y: 0 }, 200, 0, true, RATE)).toEqual({ x: 0, y: 70 });
    expect(tiltBy({ x: 0, y: 0 }, 250, 0, true, RATE)).toEqual({ x: 0, y: 70 });
    // Flipping, 100° shows its back at 110° (−70° mirrored) …
    expect(tiltBy({ x: 0, y: 0 }, 250, 0, true, RATE, true)).toEqual({ x: 0, y: 110 });
    // … and close by half a turn it is straight, mirrored.
    expect(tiltBy({ x: 0, y: 0 }, 440, 0, true, RATE, true)).toEqual({ x: 0, y: 180 });
    expect(tiltBy({ x: 0, y: 0 }, 0, 250, true, RATE, true)).toEqual({ x: -110, y: 0 });
  });
});
