import { describe, expect, it } from 'vitest';
import { downsamplePeaks, formatBytes, formatDuration, pickRecorderFormat } from './recording';

describe('pickRecorderFormat', () => {
  it('prefers WebM/Opus and VP9, falls back to MP4 for Safari', () => {
    expect(pickRecorderFormat('audio', () => true)).toBe('audio/webm;codecs=opus');
    expect(pickRecorderFormat('video', () => true)).toBe('video/webm;codecs=vp9,opus');
    const safari = (type: string) => type.startsWith('audio/mp4') || type.startsWith('video/mp4');
    expect(pickRecorderFormat('audio', safari)).toBe('audio/mp4;codecs=mp4a.40.2');
    expect(pickRecorderFormat('video', safari)).toBe('video/mp4;codecs=avc1,mp4a.40.2');
    expect(pickRecorderFormat('audio', () => false)).toBeNull();
  });
});

describe('downsamplePeaks', () => {
  it('keeps the loudest level per bar and normalises to 1', () => {
    expect(downsamplePeaks([0.1, 0.2, 0.4, 0.1], 2)).toEqual([0.5, 1]);
    expect(downsamplePeaks([0.2, 0.1], 64)).toEqual([1, 0.5]);
    expect(downsamplePeaks([], 8)).toEqual([]);
    expect(downsamplePeaks([0, 0, 0], 2)).toEqual([0, 0]);
  });

  it('never returns more than the requested bars', () => {
    expect(
      downsamplePeaks(
        Array.from({ length: 1000 }, (_, i) => i),
        64,
      ),
    ).toHaveLength(64);
  });
});

describe('formatting', () => {
  it('formats durations and sizes', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(83_400)).toBe('1:23');
    expect(formatDuration(300_000)).toBe('5:00');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1_536_000)).toBe('1,5 MB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 GB');
  });
});
