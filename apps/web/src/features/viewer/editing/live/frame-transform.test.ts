import { describe, expect, it } from 'vitest';
import { frameTransform, turnedCss } from './css';

const bbox = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };

describe('frameTransform', () => {
  it('turns and mirrors a picture by what the element changed since it was drawn', () => {
    expect(frameTransform({ bbox, rotation: 30 }, { bbox, rotation: 30 })).toBeUndefined();
    expect(frameTransform({ bbox, rotation: 10, flip: null }, { bbox, rotation: 40 })).toBe(
      'rotate(30deg)',
    );
    // Mirrored in the element's own directions, turned as it was and is.
    expect(
      frameTransform(
        { bbox, rotation: 30, flip: { x: false, y: false } },
        { bbox, rotation: 30, flip: { x: true, y: false } },
      ),
    ).toBe('rotate(30deg) scale(-1, 1) rotate(-30deg)');
    // Turned and pulled longer: stretched along its own sides (turned back, stretched, turned on)
    // around its centre, not along the slide's – the picture stays in place, its box unstretched.
    const picture = { x: 0, y: 0.15, w: 0.4, h: 0.1 };
    const longer = { ...bbox, y: 0, h: 0.4 };
    const turned = turnedCss(picture, { bbox, rotation: 90 }, { bbox: longer, rotation: 90 });
    expect(turned).toMatchObject({
      left: '0%',
      top: '15%',
      width: '40%',
      height: '10%',
      transform: 'rotate(90deg) scale(1, 2) rotate(-90deg)',
    });
    expect(String(turned.transformOrigin)).toMatch(/^50% 50(\.0+\d*)?%$/);
    // Unturned: the box itself stretched, as before.
    expect(turnedCss(bbox, { bbox, rotation: 0 }, { bbox: longer, rotation: 0 })).toMatchObject({
      top: '0%',
      height: '40%',
    });
  });
});
