import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClickGuard } from './click-guard';

afterEach(() => {
  vi.useRealTimers();
});

describe('createClickGuard', () => {
  it('swallows only the click right after a drag', () => {
    const guard = createClickGuard();
    expect(guard.consume()).toBe(false);
    guard.armAfterDrag();
    expect(guard.consume()).toBe(true);
    // Enter on a thumbnail afterwards selects it.
    expect(guard.consume()).toBe(false);
  });

  it('disarms itself when no click follows the drag (it landed on the row)', () => {
    vi.useFakeTimers();
    const guard = createClickGuard();
    guard.armAfterDrag();
    vi.runAllTimers();
    // A keyboard click (Enter / Space) on a thumbnail or the deleted-slides entry, much later.
    expect(guard.consume()).toBe(false);
  });

  it('a new press starts over', () => {
    const guard = createClickGuard(() => {});
    guard.armAfterDrag();
    guard.reset();
    expect(guard.consume()).toBe(false);
  });
});
