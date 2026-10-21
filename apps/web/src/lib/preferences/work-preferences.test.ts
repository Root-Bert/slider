import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubBrokenStorage, stubStorage } from '@/test/storage';
import {
  DEFAULT_WORK_PREFERENCES,
  loadWorkPreferences,
  storeWorkPreferences,
  type WorkPreferences,
} from './work-preferences';

const KEY = 'slider.workPreferences.v1';

afterEach(() => vi.unstubAllGlobals());

describe('work preferences', () => {
  it('start with the defaults', () => {
    stubStorage();
    expect(loadWorkPreferences()).toEqual(DEFAULT_WORK_PREFERENCES);
    expect(DEFAULT_WORK_PREFERENCES).toEqual({
      showGuides: false,
      showHiddenSlides: false,
      showChanges: false,
      statusFilter: 'open',
      hideMinimap: false,
    });
  });

  it('round-trip through storage', () => {
    const { values } = stubStorage();
    const preferences: WorkPreferences = {
      showGuides: true,
      showHiddenSlides: true,
      showChanges: true,
      statusFilter: 'done',
      hideMinimap: true,
    };
    storeWorkPreferences(preferences);
    expect(JSON.parse(values.get(KEY)!)).toEqual(preferences);
    expect(loadWorkPreferences()).toEqual(preferences);
  });

  it('fall back per field for missing or invalid values', () => {
    stubStorage({
      [KEY]: JSON.stringify({ showGuides: true, showChanges: 'no', statusFilter: 'bogus' }),
    });
    expect(loadWorkPreferences()).toEqual({ ...DEFAULT_WORK_PREFERENCES, showGuides: true });
  });

  it.each(['3', 'null', '"x"', '{'])('fall back to the defaults for %s', (stored) => {
    stubStorage({ [KEY]: stored });
    expect(loadWorkPreferences()).toEqual(DEFAULT_WORK_PREFERENCES);
  });

  it('survive storage that throws', () => {
    stubBrokenStorage();
    expect(loadWorkPreferences()).toEqual(DEFAULT_WORK_PREFERENCES);
    expect(() => storeWorkPreferences(DEFAULT_WORK_PREFERENCES)).not.toThrow();
  });
});
