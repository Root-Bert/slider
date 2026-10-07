import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeTrackGeometry, slideHeightAt } from './timeline-layout';
import {
  clampZoom,
  DEFAULT_ZOOM,
  loadStoredZoom,
  pinchZoom,
  stepZoom,
  storeZoom,
  wheelZoom,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STORAGE_KEY,
} from './zoom';

const geo = computeTrackGeometry({
  aspectRatios: Array.from({ length: 12 }, () => 16 / 9),
  viewportW: 1440,
  viewportH: 1024,
  controlsH: 64,
  narrow: false,
});

describe('zoom scale', () => {
  it('clamps to 0..1', () => {
    expect(clampZoom(10)).toBe(ZOOM_MAX);
    expect(clampZoom(-1)).toBe(ZOOM_MIN);
  });

  it('reaches the minimum in four steps out and comes back in four steps in', () => {
    let zoom = ZOOM_MAX;
    for (let i = 0; i < 4; i++) zoom = stepZoom(zoom, -1);
    expect(zoom).toBe(ZOOM_MIN);
    expect(stepZoom(zoom, -1)).toBe(ZOOM_MIN);
    for (let i = 0; i < 4; i++) zoom = stepZoom(zoom, 1);
    expect(zoom).toBe(ZOOM_MAX);
  });

  it('zooms the slide height on wheel, capped per event', () => {
    expect(wheelZoom(0.8, 100, 0, geo)).toBeLessThan(0.8);
    expect(wheelZoom(0.6, -100, 0, geo)).toBeGreaterThan(0.6);
    // 3 lines = 48px – same as 48 pixels.
    expect(wheelZoom(0.8, 3, 1, geo)).toBeCloseTo(wheelZoom(0.8, 48, 0, geo), 9);
    expect(wheelZoom(0.8, 1000, 0, geo)).toBeCloseTo(wheelZoom(0.8, 50, 0, geo), 9);
    const h = slideHeightAt(0.5, geo);
    expect(slideHeightAt(wheelZoom(0.5, -50, 0, geo), geo)).toBeCloseTo(h * Math.exp(0.25), 6);
  });

  it('scales the height with a Safari pinch', () => {
    const h = slideHeightAt(0.5, geo);
    expect(slideHeightAt(pinchZoom(0.5, 1.5, geo), geo)).toBeCloseTo(h * 1.5, 6);
    expect(pinchZoom(0.5, 100, geo)).toBe(1);
  });
});

describe('stored zoom', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubStorage = (initial: Record<string, string> = {}) => {
    const values = new Map(Object.entries(initial));
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    return values;
  };

  it('round-trips through localStorage', () => {
    const values = stubStorage();
    storeZoom(0.75);
    expect(values.get(ZOOM_STORAGE_KEY)).toBe('0.7500');
    expect(loadStoredZoom()).toBe(0.75);
  });

  it('falls back to the middle for missing or garbage values and clamps the rest', () => {
    stubStorage();
    expect(loadStoredZoom()).toBe(DEFAULT_ZOOM);
    stubStorage({ [ZOOM_STORAGE_KEY]: 'x' });
    expect(loadStoredZoom()).toBe(DEFAULT_ZOOM);
    stubStorage({ [ZOOM_STORAGE_KEY]: '' });
    expect(loadStoredZoom()).toBe(DEFAULT_ZOOM);
    stubStorage({ [ZOOM_STORAGE_KEY]: '7' });
    expect(loadStoredZoom()).toBe(ZOOM_MAX);
  });

  it('survives storage that throws (private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(loadStoredZoom()).toBe(DEFAULT_ZOOM);
    expect(() => storeZoom(0.7)).not.toThrow();
  });
});
