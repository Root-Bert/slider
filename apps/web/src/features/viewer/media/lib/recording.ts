import { MAX_MEDIA_PEAKS, type MediaKind } from '@slider/shared';

/*
 * Recording settings for voice and video comments (BER-116). Everything is compressed on the
 * device while recording – the server stores the bytes as they are – so the bitrates here decide
 * how much of the workspace's storage a recording costs.
 */

/**
 * Formats in order of preference. Opus is made for speech: 24 kbit/s mono sounds clear and costs
 * ~180 KB per minute. Video is MP4 (H.264/AAC) wherever the browser records it: Safari records
 * WebM nowadays but cannot play it back, and a recording must play for every viewer, not only
 * in the browser that made it. WebM is the fallback for browsers without MP4 recording (Firefox).
 */
export const RECORDER_FORMATS: Record<MediaKind, readonly string[]> = {
  audio: [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
  ],
  video: [
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
  ],
};

/** Bits per second. 720p at 1.5 Mbit/s + audio ≈ 11 MB per minute. */
export const RECORDER_BITRATES: Record<MediaKind, MediaRecorderOptions> = {
  audio: { audioBitsPerSecond: 24_000 },
  video: { videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 64_000 },
};

export const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** A face in a comment card: 720p at 30 fps looks sharp without huge files. */
export const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30, max: 30 },
  facingMode: 'user',
};

/** Where a video comment's picture comes from: the camera, the shared screen, or both. */
export type VideoSource = 'camera' | 'screen' | 'both';

/** Screens carry text: 1080p at 24 fps reads crisp, and 2.5 Mbit/s ≈ 19 MB per minute. */
export const SCREEN_MAX_SIZE = { width: 1920, height: 1080 } as const;
export const SCREEN_FRAME_RATE = 24;
export const SCREEN_BITRATES: MediaRecorderOptions = {
  videoBitsPerSecond: 2_500_000,
  audioBitsPerSecond: 64_000,
};

export const SCREEN_CONSTRAINTS: DisplayMediaStreamOptions = {
  video: {
    width: { ideal: SCREEN_MAX_SIZE.width },
    height: { ideal: SCREEN_MAX_SIZE.height },
    frameRate: { ideal: SCREEN_FRAME_RATE, max: 30 },
  },
  // The voice comes from the microphone; tab audio would only double it.
  audio: false,
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

/** Whether the recorder can run at all in this browser (needs a secure context). */
export const canRecord = () =>
  typeof window !== 'undefined' &&
  typeof MediaRecorder !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia;

/** Whether this browser can share a screen (not on phones and tablets). */
export const canShareScreen = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

export const MEDIA_LABELS: Record<MediaKind, { noun: string; short: string }> = {
  audio: { noun: 'Sprachkommentar', short: 'Audio' },
  video: { noun: 'Videokommentar', short: 'Video' },
};
