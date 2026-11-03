import { describe, expect, it } from 'vitest';
import { hitTestShapes, turnedBoxContains, turnedCorners } from '../src';

const box = { x: 0.3, y: 0.4, w: 0.4, h: 0.1 };

describe('turnedBoxContains', () => {
  it("is the plain rect without a turn and follows a turn: the flat box's ends are off, along the turn is on", () => {
    expect(turnedBoxContains({ bbox: box }, { x: 0.31, y: 0.41 })).toBe(true);
    expect(turnedBoxContains({ bbox: box }, { x: 0.5, y: 0.3 })).toBe(false);
    const turned = { bbox: box, rotation: 90 };
    // Turned upright: the flat box's ends are off it, above its centre is on it.
    expect(turnedBoxContains(turned, { x: 0.31, y: 0.45 })).toBe(false);
    expect(turnedBoxContains(turned, { x: 0.5, y: 0.25 })).toBe(true);
    // hitTestShapes finds a turned shape where it shows.
    const shape = { id: 'a', name: 'A', text: '', bbox: box, rotation: 90 };
    expect(hitTestShapes([shape], { x: 0.5, y: 0.25 })?.id).toBe('a');
    expect(hitTestShapes([shape], { x: 0.32, y: 0.45 })).toBeNull();
  });

  it('follows a tilt: the side tilted away shows smaller', () => {
    const corners = turnedCorners({ bbox: box, tilt: { x: 0, y: 40 } });
    const left = corners[3]!.y - corners[0]!.y;
    const right = corners[2]!.y - corners[1]!.y;
    expect(right).toBeLessThan(left);
  });
});
