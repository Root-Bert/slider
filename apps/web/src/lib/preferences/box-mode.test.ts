import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubBrokenStorage, stubStorage } from '@/test/storage';
import { loadStoredBoxMode, storeBoxMode } from './box-mode';

const KEY = 'slider.boxMode';

afterEach(() => vi.unstubAllGlobals());

describe('box mode preference', () => {
  it('is on unless stored as off', () => {
    stubStorage();
    expect(loadStoredBoxMode()).toBe(true);
    stubStorage({ [KEY]: 'on' });
    expect(loadStoredBoxMode()).toBe(true);
    stubStorage({ [KEY]: 'whatever' });
    expect(loadStoredBoxMode()).toBe(true);
    stubStorage({ [KEY]: 'off' });
    expect(loadStoredBoxMode()).toBe(false);
  });

  it('stores on/off', () => {
    const { values } = stubStorage();
    storeBoxMode(false);
    expect(values.get(KEY)).toBe('off');
    expect(loadStoredBoxMode()).toBe(false);
    storeBoxMode(true);
    expect(values.get(KEY)).toBe('on');
  });

  it('is on and never throws without storage', () => {
    stubBrokenStorage();
    expect(loadStoredBoxMode()).toBe(true);
    expect(() => storeBoxMode(false)).not.toThrow();
  });
});
