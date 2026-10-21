import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThrottled } from './useThrottled';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useThrottled (BER-167)', () => {
  it('follows a moving value along the way, and ends on its last state', () => {
    const { result, rerender } = renderHook(({ value }) => useThrottled(value, 100), {
      initialProps: { value: 0 },
    });
    // Moving every 20ms: renewed about every 100ms, not only at the end.
    const seen = new Set<number>();
    for (let value = 1; value <= 15; value++) {
      rerender({ value });
      act(() => vi.advanceTimersByTime(20));
      seen.add(result.current);
    }
    expect(seen.size).toBeGreaterThan(2);
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe(15);
  });
});
