import { describe, expect, it } from 'vitest';
import { importPollInterval, type ImportStall } from './decks';

describe('importPollInterval', () => {
  it('polls fast while imports move and stops without one', () => {
    const stall: { current: ImportStall } = { current: null };
    expect(importPollInterval(stall, 'a', 1000, 0)).toBe(1000);
    expect(importPollInterval(stall, 'b', 1000, 100_000)).toBe(1000);
    // Moved at 100 s: still fast two minutes after the start.
    expect(importPollInterval(stall, 'b', 1000, 200_000)).toBe(1000);
    expect(importPollInterval(stall, null, 1000, 210_000)).toBe(false);
    expect(stall.current).toBeNull();
  });

  it('backs off to 10 s once the imports have not moved for two minutes (stuck worker)', () => {
    const stall: { current: ImportStall } = { current: null };
    expect(importPollInterval(stall, 'a', 2000, 0)).toBe(2000);
    expect(importPollInterval(stall, 'a', 2000, 121_000)).toBe(10_000);
    // Progress again: fast again.
    expect(importPollInterval(stall, 'b', 2000, 122_000)).toBe(2000);
  });
});
