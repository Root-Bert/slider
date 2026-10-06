import { describe, expect, it } from 'vitest';
import { formatBytes, formatRelativeTime, pluralize } from './format';

describe('formatRelativeTime', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it.each([
    [10_000, 'jetzt'],
    [5 * 60_000, 'vor 5 Min.'],
    [2 * 3_600_000, 'vor 2 Std.'],
    [30 * 3_600_000, 'gestern'],
    [3 * 86_400_000, 'vor 3 Tagen'],
    [8 * 86_400_000, 'vor 1 Woche'],
  ])('formats %i ms ago as "%s"', (ms, expected) => {
    expect(formatRelativeTime(ago(ms), now)).toBe(expected);
  });

  it('falls back to a short date for older timestamps', () => {
    expect(formatRelativeTime('2026-09-12T10:00:00Z', now)).toBe('12. Sept.');
  });
});

describe('pluralize / formatBytes', () => {
  it('picks singular or plural', () => {
    expect(pluralize(1, 'Folie', 'Folien')).toBe('1 Folie');
    expect(pluralize(12, 'Folie', 'Folien')).toBe('12 Folien');
  });

  it('formats file sizes in German notation', () => {
    expect(formatBytes(12.4 * 1024 * 1024)).toBe('12,4 MB');
    expect(formatBytes(300)).toBe('1 KB');
  });
});
