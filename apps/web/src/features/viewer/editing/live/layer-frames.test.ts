import { describe, expect, it } from 'vitest';
import type { SlideLayers } from '@slider/shared';
import { layerFrames } from './layer-frames';

describe('raster geometry across rendering surfaces', () => {
  it('retains the original frame after a move or rotation, and gives older pictures none of a new step', () => {
    const pictures: SlideLayers = { seq: 1, background: '/background', layers: [] };
    const bbox = { x: 0.1, y: 0.2, w: 0.3, h: 0.2 };
    const state = {
      seq: 1,
      slides: [{ slideId: 'slide', elements: [{ id: 'element', bbox, rotation: 10, flip: null }] }],
    };
    const original = layerFrames(pictures, state, 'slide');
    expect(original?.get('element')?.bbox.x).toBe(0.1);
    const changed = {
      seq: 2,
      slides: [
        {
          slideId: 'slide',
          elements: [{ id: 'element', bbox: { ...bbox, x: 0.7 }, rotation: 60, flip: null }],
        },
      ],
    };
    expect(layerFrames(pictures, changed, 'slide')).toBe(original);
    expect(layerFrames(pictures, changed, 'slide')?.get('element')?.rotation).toBe(10);
    bbox.x = 0.8;
    expect(original?.get('element')?.bbox.x).toBe(0.1);
    expect(layerFrames({ ...pictures }, { seq: 3, slides: [] }, 'other')).toBeUndefined();
    // Drawn at a step the state has moved past (the answer came late): placed from where it was
    // drawn, not from where the element is now.
    const late = layerFrames({ seq: 2, background: '/late', layers: [] }, state, 'slide');
    expect(late?.get('element')?.bbox.x).toBe(0.7);
    expect(late?.get('element')?.rotation).toBe(60);
    // A step never seen: no frames (rather than the element's current ones).
    expect(layerFrames({ seq: 9, background: '/b', layers: [] }, state, 'slide')).toBeUndefined();
  });
});
