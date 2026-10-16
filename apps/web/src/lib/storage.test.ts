import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubBrokenStorage, stubStorage } from '@/test/storage';
import { createStoredStore, readJson, readString, writeJson, writeString } from './storage';

afterEach(() => vi.unstubAllGlobals());

const asNumber = (value: unknown) => {
  if (typeof value !== 'number') throw new Error('not a number');
  return value;
};

describe('readString / writeString', () => {
  it('round-trips and removes on null', () => {
    const { values } = stubStorage();
    writeString('k', 'v');
    expect(values.get('k')).toBe('v');
    expect(readString('k')).toBe('v');
    writeString('k', null);
    expect(values.has('k')).toBe(false);
    expect(readString('k')).toBeNull();
  });

  it('uses sessionStorage when asked', () => {
    const session = stubStorage({ s: '1' }, 'sessionStorage');
    expect(readString('s', 'session')).toBe('1');
    writeString('t', '2', 'session');
    expect(session.values.get('t')).toBe('2');
  });

  it('never throws when storage is unavailable', () => {
    stubBrokenStorage();
    expect(readString('k')).toBeNull();
    expect(() => writeString('k', 'v')).not.toThrow();
    expect(() => writeString('k', null)).not.toThrow();
  });
});

describe('readJson / writeJson', () => {
  it('parses and validates the stored JSON', () => {
    const { values } = stubStorage();
    writeJson('n', 3);
    expect(values.get('n')).toBe('3');
    expect(readJson('n', asNumber, 0)).toBe(3);
  });

  it('falls back for missing, corrupt or rejected values', () => {
    stubStorage({ corrupt: '{', text: '"x"' });
    expect(readJson('missing', asNumber, 7)).toBe(7);
    expect(readJson('corrupt', asNumber, 7)).toBe(7);
    expect(readJson('text', asNumber, 7)).toBe(7);
  });

  it('falls back and never throws without storage', () => {
    stubBrokenStorage();
    expect(readJson('n', asNumber, 1)).toBe(1);
    expect(() => writeJson('n', 2)).not.toThrow();
  });
});

describe('createStoredStore', () => {
  const store = (crossTab = false) =>
    createStoredStore({ key: 'store', parse: asNumber, fallback: 0, crossTab });

  it('loads lazily, once', () => {
    const { getItem } = stubStorage({ store: '5' });
    const counter = store();
    expect(getItem).not.toHaveBeenCalled();
    expect(counter.getSnapshot()).toBe(5);
    expect(counter.getSnapshot()).toBe(5);
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it('persists, notifies and unsubscribes', () => {
    const { values } = stubStorage();
    const counter = store();
    const listener = vi.fn();
    const unsubscribe = counter.subscribe(listener);
    counter.set(2);
    expect(counter.getSnapshot()).toBe(2);
    expect(values.get('store')).toBe('2');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    counter.set(3);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the value in memory when storage fails', () => {
    stubBrokenStorage();
    const counter = store();
    expect(counter.getSnapshot()).toBe(0);
    counter.set(4);
    expect(counter.getSnapshot()).toBe(4);
  });

  it('follows other tabs only with crossTab', () => {
    const local = stubStorage({ store: '1' });
    const plain = store();
    const synced = store(true);
    const onPlain = vi.fn();
    const onSynced = vi.fn();
    plain.subscribe(onPlain);
    const unsubscribe = synced.subscribe(onSynced);
    expect(plain.getSnapshot()).toBe(1);
    expect(synced.getSnapshot()).toBe(1);

    local.values.set('store', '9');
    local.dispatchStorage('other');
    expect(onSynced).not.toHaveBeenCalled();
    local.dispatchStorage('store');
    expect(onSynced).toHaveBeenCalledTimes(1);
    expect(synced.getSnapshot()).toBe(9);
    expect(onPlain).not.toHaveBeenCalled();
    expect(plain.getSnapshot()).toBe(1);

    unsubscribe();
    expect(local.listeners.get('storage')?.size ?? 0).toBe(0);
  });
});
