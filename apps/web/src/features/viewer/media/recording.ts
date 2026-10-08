import { MAX_MEDIA_PEAKS, type MediaKind } from '@slider/shared';

/*
 * Recording settings for voice and video comments (BER-116). Everything is compressed on the
 * device while recording – the server stores the bytes as they are – so the bitrates here decide
 * how much of the 5 GB per account a recording costs.
 */

/**
 * Formats in order of preference. Opus is made for speech: 24 kbit/s mono sounds clear and costs
 * ~180 KB per minute. VP9 beats VP8 and H.264 at the same size; Safari only records MP4.
 */
export const RECORDER_FORMATS: Record<MediaKind, readonly string[]> = {
  audio: [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
  ],
  video: [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
  ],
};

/** Bits per second. 480p VP9 at 450 kbit/s + Opus ≈ 3.6 MB per minute. */
export const RECORDER_BITRATES: Record<MediaKind, MediaRecorderOptions> = {
  audio: { audioBitsPerSecond: 24_000 },
  video: { videoBitsPerSecond: 450_000, audioBitsPerSecond: 32_000 },
};

export const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** A face in a comment card needs no HD: 480p at 24 fps keeps files small. */
export const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 854 },
  height: { ideal: 480 },
  frameRate: { ideal: 24, max: 30 },
  facingMode: 'user',
};

/** The first format this browser can record, or `null` (then the browser picks). */
export function pickRecorderFormat(
  kind: MediaKind,
  isTypeSupported: (type: string) => boolean,
): string | null {
  return RECORDER_FORMATS[kind].find((type) => isTypeSupported(type)) ?? null;
}

/** Peak bars for the waveform: the loudest level per bucket, scaled so the loudest bar is 1. */
export function downsamplePeaks(levels: readonly number[], bars = MAX_MEDIA_PEAKS): number[] {
  if (levels.length === 0) return [];
  const count = Math.min(bars, levels.length);
  const result: number[] = [];
  for (let bar = 0; bar < count; bar += 1) {
    const from = Math.floor((bar * levels.length) / count);
    const to = Math.max(from + 1, Math.floor(((bar + 1) * levels.length) / count));
    result.push(Math.max(...levels.slice(from, to)));
  }
  const loudest = Math.max(...result);
  if (loudest <= 0) return result.map(() => 0);
  return result.map((peak) => Math.round((peak / loudest) * 100) / 100);
}

/** `83_000` → `1:23`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** `1_536_000` → `1,5 MB`. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toLocaleString('de-DE', { maximumFractionDigits: digits })} ${units[unit]}`;
}

/** Whether the recorder can run at all in this browser (needs a secure context). */
export const canRecord = () =>
  typeof window !== 'undefined' &&
  typeof MediaRecorder !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia;

export const MEDIA_LABELS: Record<MediaKind, { noun: string; short: string }> = {
  audio: { noun: 'Sprachkommentar', short: 'Audio' },
  video: { noun: 'Videokommentar', short: 'Video' },
};
