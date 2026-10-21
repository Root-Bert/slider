import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubBrokenStorage, stubStorage } from '@/test/storage';
import { author } from './test-fixtures';

const KEY = 'slider.colorOverrides.v1';

// The store is module-level: every test loads a fresh copy.
const load = () => import('./color-overrides');

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('colour overrides store', () => {
  it('keeps only reviewer accents from storage', async () => {
    stubStorage({ [KEY]: JSON.stringify({ a: 'red', b: 'pink', c: 'powerpoint', d: 3 }) });
    const { colorOverridesStore } = await load();
    expect(colorOverridesStore.getSnapshot()).toEqual({ a: 'red' });
  });

  it.each(['{', '[]', 'null', '"red"'])('starts empty for %s', async (stored) => {
    stubStorage({ [KEY]: stored });
    const { colorOverridesStore } = await load();
    expect(colorOverridesStore.getSnapshot()).toEqual({});
  });

  it('sets and drops an override, persisting and notifying', async () => {
    const { values } = stubStorage();
    const { colorOverridesStore, setColorOverride } = await load();
    const listener = vi.fn();
    colorOverridesStore.subscribe(listener);
    setColorOverride('a', 'green');
    expect(JSON.parse(values.get(KEY)!)).toEqual({ a: 'green' });
    expect(listener).toHaveBeenCalledTimes(1);
    setColorOverride('b', 'cyan');
    setColorOverride('a', null);
    expect(JSON.parse(values.get(KEY)!)).toEqual({ b: 'cyan' });
    expect(colorOverridesStore.getSnapshot()).toEqual({ b: 'cyan' });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('keeps the overrides in memory when storage fails', async () => {
    stubBrokenStorage();
    const { colorOverridesStore, setColorOverride } = await load();
    setColorOverride('a', 'violet');
    expect(colorOverridesStore.getSnapshot()).toEqual({ a: 'violet' });
  });
});

describe('withColorOverride', () => {
  it('recolours people the viewer picked a colour for', async () => {
    const { withColorOverride } = await load();
    expect(withColorOverride(author('a', { color: 'blue' }), { a: 'red' }).color).toBe('red');
  });

  it('returns the same author without a (different) override', async () => {
    const { withColorOverride } = await load();
    const person = author('a', { color: 'blue' });
    expect(withColorOverride(person, {})).toBe(person);
    expect(withColorOverride(person, { a: 'blue' })).toBe(person);
  });

  it('leaves PowerPoint authors orange', async () => {
    const { withColorOverride } = await load();
    const external = author('pptx:anna', { type: 'external', color: 'powerpoint' });
    expect(withColorOverride(external, { 'pptx:anna': 'red' })).toBe(external);
  });
});
