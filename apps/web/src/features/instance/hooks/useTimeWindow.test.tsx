import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimeWindow } from './useTimeWindow';

const DAY = 86_400_000;
// 14:20 – a 31-day window ends at the next midnight.
const now = new Date(2026, 9, 21, 14, 20).getTime();
const midnight = new Date(2026, 9, 22).getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

describe('useTimeWindow (BER-167)', () => {
  it('follows the time until moved, on whole stretches, between the history and now', () => {
    const { result } = renderHook(() => useTimeWindow(midnight - 100 * DAY));
    expect(result.current).toMatchObject({ live: true, end: midnight, interval: '31d' });
    expect(result.current.from).toBe(midnight - 31 * DAY);

    act(() => result.current.moveTo(midnight - 2.4 * DAY));
    expect(result.current).toMatchObject({ live: false, end: midnight - 2 * DAY });
    // Not before the history: the window's start stays on its first day.
    act(() => result.current.moveTo(midnight - 500 * DAY));
    expect(result.current.end).toBe(midnight - 69 * DAY);
    // Past now: it follows the time again.
    act(() => result.current.moveTo(midnight + 5 * DAY));
    expect(result.current.live).toBe(true);
  });

  it('gathers sideways scrolling into whole stretches', () => {
    const { result } = renderHook(() => useTimeWindow(midnight - 100 * DAY));
    act(() => result.current.pan(-0.6 * DAY));
    expect(result.current.live).toBe(true);
    act(() => result.current.pan(-0.6 * DAY));
    expect(result.current.end).toBe(midnight - DAY);
  });

  it('a new width keeps a moved end, on its own stretches', () => {
    const { result } = renderHook(() => useTimeWindow(midnight - 100 * DAY));
    act(() => result.current.moveTo(midnight - 3 * DAY));
    act(() => result.current.chooseInterval('1d'));
    expect(result.current).toMatchObject({ interval: '1d', end: midnight - 3 * DAY });
    act(() => result.current.follow());
    // Hourly: now rounded up to the next full hour.
    expect(result.current.end).toBe(new Date(2026, 9, 21, 15).getTime());
  });
});
