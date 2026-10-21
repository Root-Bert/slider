import { describe, expect, it } from 'vitest';
import {
  alignEnd,
  bucketSpan,
  countTicks,
  formatCount,
  snapEnd,
  stretchName,
  windowSpan,
} from './period';

const bucket = (start: Date) => ({
  start: start.toISOString(),
  users: 0,
  workspaces: 0,
  decks: 0,
});

describe('dashboard window (BER-167)', () => {
  it('count axes end on a round number at or above the highest value', () => {
    expect(countTicks(0)).toEqual([0, 1]);
    expect(countTicks(7)).toEqual([0, 5, 10]);
    expect(countTicks(13)).toEqual([0, 10, 20]);
    expect(countTicks(240)).toEqual([0, 200, 400]);
  });

  it('ends a window on the clock: the next full hour, quarter day or midnight', () => {
    const at = new Date(2026, 9, 21, 14, 20).getTime();
    expect(new Date(alignEnd(at, '1d'))).toEqual(new Date(2026, 9, 21, 15));
    expect(new Date(alignEnd(at, '7d'))).toEqual(new Date(2026, 9, 21, 18));
    expect(new Date(alignEnd(at, '31d'))).toEqual(new Date(2026, 9, 22));
    expect(new Date(alignEnd(at, '1y'))).toEqual(new Date(2026, 9, 22));
    // Already on the clock: stays.
    const midnight = new Date(2026, 9, 22).getTime();
    expect(alignEnd(midnight, '31d')).toBe(midnight);
  });

  it("moves a window by whole stretches, between the history's start and now", () => {
    const now = 1_000 * 3_600_000;
    const hour = 3_600_000;
    expect(snapEnd(now - 2.4 * hour, now, hour, now - 100 * hour)).toBe(now - 2 * hour);
    expect(snapEnd(now - 500 * hour, now, hour, now - 100 * hour)).toBe(now - 100 * hour);
    // Back at now (or past it): follows the time again.
    expect(snapEnd(now + 5 * hour, now, hour, 0)).toBeNull();
  });

  it('names what a point covers, by the length of its stretch', () => {
    expect(stretchName(1)).toBe('Stunde');
    expect(stretchName(6)).toBe('6 Stunden');
    expect(stretchName(24)).toBe('Tag');
    expect(stretchName(168)).toBe('Woche');
    expect(bucketSpan(bucket(new Date(2026, 9, 21, 14)), 1)).toBe('21. Okt., 14–15 Uhr');
    expect(bucketSpan(bucket(new Date(2026, 9, 21, 18)), 6)).toBe('21. Okt., 18–24 Uhr');
    expect(bucketSpan(bucket(new Date(2026, 9, 21)), 24)).toBe('21. Okt.');
    expect(bucketSpan(bucket(new Date(2026, 9, 1)), 168)).toBe('1. Okt. – 7. Okt.');
    expect(windowSpan(new Date(2026, 8, 21).getTime(), new Date(2026, 9, 22).getTime())).toBe(
      '21. Sept. – 21. Okt.',
    );
  });

  it('writes big counts short', () => {
    expect(formatCount(1284)).toBe('1.284');
    expect(formatCount(129_000)).toBe('129.000');
    expect(formatCount(1_290_000)).toMatch(/^1,3\sMio\.$/);
  });
});
