import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampZoom,
  loadStoredZoom,
  sliderToZoom,
  stepZoom,
  storeZoom,
  wheelZoom,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STORAGE_KEY,
  zoomToSlider,
} from './zoom';

describe('zoom scale', () => {
  it('maps Desktop-7 to the left end and Desktop-1 to the right end', () => {
    expect(zoomToSlider(ZOOM_MIN)).toBe(0);
    expect(zoomToSlider(ZOOM_MAX)).toBe(1);
    expect(ZOOM_MIN * 552).toBeCloseTo(252);
  });

  it('round-trips between zoom and slider position', () => {
    for (const position of [0, 0.1, 0.37, 0.5, 0.99, 1]) {
      expect(zoomToSlider(sliderToZoom(position))).toBeCloseTo(position, 9);
    }
  });

  it('clamps to the Desktop-1 / Desktop-7 range', () => {
    expect(clampZoom(10)).toBe(ZOOM_MAX);
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(sliderToZoom(2)).toBe(ZOOM_MAX);
  });

  it('reaches the minimum in four steps out and comes back in four steps in', () => {
    let zoom = ZOOM_MAX;
    for (let i = 0; i < 4; i++) zoom = stepZoom(zoom, -1);
    expect(zoom).toBe(ZOOM_MIN);
    expect(stepZoom(zoom, -1)).toBe(ZOOM_MIN);
    for (let i = 0; i < 4; i++) zoom = stepZoom(zoom, 1);
    expect(zoom).toBe(ZOOM_MAX);
  });

  it('zooms out on wheel down and in on wheel up, capped per event', () => {
    expect(wheelZoom(0.8, 100, 0)).toBeLessThan(0.8);
    expect(wheelZoom(0.6, -100, 0)).toBeGreaterThan(0.6);
    // 3 lines = 48px – same as 48 pixels.
    expect(wheelZoom(0.8, 3, 1)).toBeCloseTo(wheelZoom(0.8, 48, 0), 9);
    expect(wheelZoom(0.8, 1000, 0)).toBeCloseTo(wheelZoom(0.8, 50, 0), 9);
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
    storeZoom(ZOOM_MIN);
    expect(values.get(ZOOM_STORAGE_KEY)).toBe('0.4565');
    expect(loadStoredZoom()).toBeCloseTo(ZOOM_MIN, 3);
  });

  it('falls back to the Desktop-1 zoom for missing, garbage or out-of-range values', () => {
    stubStorage();
    expect(loadStoredZoom()).toBe(ZOOM_MAX);
    stubStorage({ [ZOOM_STORAGE_KEY]: 'abc' });
    expect(loadStoredZoom()).toBe(ZOOM_MAX);
    stubStorage({ [ZOOM_STORAGE_KEY]: '0.01' });
    expect(loadStoredZoom()).toBe(ZOOM_MIN);
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
    expect(loadStoredZoom()).toBe(ZOOM_MAX);
    expect(() => storeZoom(0.7)).not.toThrow();
  });
});
