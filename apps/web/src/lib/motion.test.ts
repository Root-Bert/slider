import { afterEach, describe, expect, it, vi } from 'vitest';
import { motionMs, prefersReducedMotion } from './motion';

const stubReducedMotion = (matches: boolean) =>
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' && matches,
      addEventListener() {},
      removeEventListener() {},
    }),
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('motionMs', () => {
  it('passes durations through without a DOM', () => {
    expect(prefersReducedMotion()).toBe(false);
    expect(motionMs(300)).toBe(300);
  });

  it('passes durations through when motion is allowed', () => {
    stubReducedMotion(false);
    expect(motionMs(200)).toBe(200);
  });

  it('is 0 under reduced motion', () => {
    stubReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(motionMs(200)).toBe(0);
  });
});
