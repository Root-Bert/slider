import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_CHOREOGRAPHIES, pickChoreography } from './choreography';

describe('pickChoreography', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('picks any of them, from the whole range of random numbers', () => {
    expect(pickChoreography(() => 0)).toBe(IMPORT_CHOREOGRAPHIES[0]);
    // The first one is the last one played now: the rest are left.
    expect(pickChoreography(() => 0)).toBe(IMPORT_CHOREOGRAPHIES[1]);
    expect(pickChoreography(() => 0.9999)).toBe(IMPORT_CHOREOGRAPHIES.at(-1));
  });

  it('never plays the same one twice in a row', () => {
    let last = pickChoreography();
    for (let run = 0; run < 50; run++) {
      const next = pickChoreography();
      expect(next).not.toBe(last);
      last = next;
    }
  });

  it('still picks one when storage is blocked', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('sessionStorage', { getItem: blocked, setItem: blocked });
    expect(IMPORT_CHOREOGRAPHIES).toContain(pickChoreography(() => 0.5));
  });
});
