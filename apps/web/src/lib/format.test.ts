import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  formatFileSize,
  formatRelativeTime,
  formatShortDate,
  pluralize,
} from './format';

describe('formatRelativeTime', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it.each([
    [10_000, 'jetzt'],
    [59_999, 'jetzt'],
    [60_000, 'vor 1 Min.'],
    [5 * 60_000, 'vor 5 Min.'],
    [3_600_000, 'vor 1 Std.'],
    [2 * 3_600_000, 'vor 2 Std.'],
    [30 * 3_600_000, 'gestern'],
    [48 * 3_600_000, 'vor 2 Tagen'],
    [3 * 86_400_000, 'vor 3 Tagen'],
    [8 * 86_400_000, 'vor 1 Woche'],
  ])('formats %i ms ago as "%s"', (ms, expected) => {
    expect(formatRelativeTime(ago(ms), now)).toBe(expected);
  });

  it('says "jetzt" for timestamps in the future', () => {
    expect(formatRelativeTime(ago(-5 * 60_000), now)).toBe('jetzt');
  });

  it('falls back to a short date for older timestamps', () => {
    expect(formatRelativeTime('2026-09-12T10:00:00Z', now)).toBe('12. Sept.');
    expect(formatRelativeTime(ago(14 * 86_400_000), now)).toBe('22. Sept.');
  });

  it('adds the year for earlier years', () => {
    expect(formatRelativeTime('2025-09-12T10:00:00Z', now)).toBe('12. Sept. 2025');
  });
});

describe('absolute dates', () => {
  it('formats a short date without the year', () => {
    expect(formatShortDate('2026-10-03T12:00:00Z')).toBe('3. Okt.');
  });

  it('formats date and time for tooltips', () => {
    expect(formatDateTime('2026-10-06T12:00:00Z')).toMatch(/^06\.10\.2026, \d{2}:\d{2}$/);
  });
});

describe('pluralize', () => {
  it('picks singular or plural', () => {
    expect(pluralize(1, 'Folie', 'Folien')).toBe('1 Folie');
    expect(pluralize(12, 'Folie', 'Folien')).toBe('12 Folien');
    expect(pluralize(0, 'Folie', 'Folien')).toBe('0 Folien');
  });
});

describe('formatBytes (uploads)', () => {
  it('formats file sizes in German notation, at least 1 KB', () => {
    expect(formatBytes(12.4 * 1024 * 1024)).toBe('12,4 MB');
    expect(formatBytes(300)).toBe('1 KB');
    expect(formatBytes(0)).toBe('1 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(1536 * 1024)).toBe('1,5 MB');
  });
});

describe('formatFileSize (recordings, storage)', () => {
  it('goes from bytes to GB, one decimal below 10', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1_536_000)).toBe('1,5 MB');
    expect(formatFileSize(5 * 1024 ** 3)).toBe('5 GB');
    expect(formatFileSize(20 * 1024)).toBe('20 KB');
  });
});

describe('formatDuration', () => {
  it('formats a media clock', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(42_000)).toBe('0:42');
    expect(formatDuration(61_500)).toBe('1:01');
    expect(formatDuration(83_400)).toBe('1:23');
    expect(formatDuration(300_000)).toBe('5:00');
    expect(formatDuration(-1)).toBe('0:00');
  });
});
