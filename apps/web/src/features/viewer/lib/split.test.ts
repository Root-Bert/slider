import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampSplit,
  dragSplit,
  loadStoredSplit,
  pinchSplit,
  SPLIT_KEY_STEP_PX,
  SPLIT_MAX,
  SPLIT_MIN,
  SPLIT_STORAGE_KEY,
  stepSplit,
  storeSplit,
  wheelSplit,
} from './split';
import { computeTrackGeometry, slideHeightAt } from './timeline-layout';

const geo = computeTrackGeometry({
  aspectRatios: Array.from({ length: 12 }, () => 16 / 9),
  viewportW: 1440,
  viewportH: 1024,
  controlsH: 150,
  narrow: false,
});

describe('split interaction', () => {
  it('clamps to 0..1', () => {
    expect(clampSplit(10)).toBe(SPLIT_MAX);
    expect(clampSplit(-1)).toBe(SPLIT_MIN);
  });

  it('follows the pointer pixel for pixel while dragging, clamped at the limits', () => {
    const start = slideHeightAt(null, geo);
    expect(slideHeightAt(dragSplit(start, 37, geo), geo)).toBeCloseTo(start + 37, 9);
    expect(slideHeightAt(dragSplit(start, -120, geo), geo)).toBeCloseTo(start - 120, 9);
    expect(dragSplit(start, 5000, geo)).toBe(SPLIT_MAX);
    expect(dragSplit(start, -5000, geo)).toBe(SPLIT_MIN);
  });

  it('steps by a fixed number of pixels from the default or a set split', () => {
    const h = slideHeightAt(null, geo);
    expect(slideHeightAt(stepSplit(null, 1, geo), geo)).toBeCloseTo(h + SPLIT_KEY_STEP_PX, 9);
    expect(slideHeightAt(stepSplit(null, -1, geo, 96), geo)).toBeCloseTo(h - 96, 9);
    expect(stepSplit(SPLIT_MIN, -1, geo)).toBe(SPLIT_MIN);
    expect(stepSplit(SPLIT_MAX, 1, geo)).toBe(SPLIT_MAX);
  });

  it('resizes the slides on wheel, capped per event', () => {
    expect(wheelSplit(0.8, 100, 0, geo)).toBeLessThan(0.8);
    expect(wheelSplit(0.6, -100, 0, geo)).toBeGreaterThan(0.6);
    // 3 lines = 48px – same as 48 pixels.
    expect(wheelSplit(0.8, 3, 1, geo)).toBeCloseTo(wheelSplit(0.8, 48, 0, geo), 9);
    expect(wheelSplit(0.8, 1000, 0, geo)).toBeCloseTo(wheelSplit(0.8, 50, 0, geo), 9);
    const h = slideHeightAt(0.3, geo);
    expect(slideHeightAt(wheelSplit(0.3, -50, 0, geo), geo)).toBeCloseTo(h * Math.exp(0.25), 6);
    // From the default too.
    expect(wheelSplit(null, -50, 0, geo)).toBeGreaterThan(wheelSplit(null, 50, 0, geo));
  });

  it('scales the height with a Safari pinch', () => {
    const h = slideHeightAt(0.3, geo);
    expect(slideHeightAt(pinchSplit(0.3, 1.5, geo), geo)).toBeCloseTo(h * 1.5, 6);
    expect(pinchSplit(0.3, 100, geo)).toBe(SPLIT_MAX);
    expect(pinchSplit(null, 0.01, geo)).toBe(SPLIT_MIN);
  });
});

describe('stored split', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubStorage = (initial: Record<string, string> = {}) => {
    const values = new Map(Object.entries(initial));
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    return values;
  };

  it('round-trips through localStorage and forgets a reset split', () => {
    const values = stubStorage();
    storeSplit(0.75);
    expect(values.get(SPLIT_STORAGE_KEY)).toBe('0.7500');
    expect(loadStoredSplit()).toBe(0.75);
    storeSplit(null);
    expect(values.has(SPLIT_STORAGE_KEY)).toBe(false);
    expect(loadStoredSplit()).toBeNull();
  });

  it('falls back to the default for missing or garbage values and clamps the rest', () => {
    stubStorage();
    expect(loadStoredSplit()).toBeNull();
    stubStorage({ [SPLIT_STORAGE_KEY]: 'x' });
    expect(loadStoredSplit()).toBeNull();
    stubStorage({ [SPLIT_STORAGE_KEY]: '' });
    expect(loadStoredSplit()).toBeNull();
    stubStorage({ [SPLIT_STORAGE_KEY]: '7' });
    expect(loadStoredSplit()).toBe(SPLIT_MAX);
  });

  it('survives storage that throws (private mode)', () => {
    const denied = () => {
      throw new Error('denied');
    };
    vi.stubGlobal('localStorage', { getItem: denied, setItem: denied, removeItem: denied });
    expect(loadStoredSplit()).toBeNull();
    expect(() => storeSplit(0.7)).not.toThrow();
    expect(() => storeSplit(null)).not.toThrow();
  });
});
