/*
 * A recorded video cut in the browser: the parts kept are decoded and encoded again into one MP4
 * (WebCodecs, through Mediabunny) – what was cut never leaves the device, and the server needs no
 * video tools. A recording's own keyframes are too far apart to cut at without encoding again.
 */

/** A part of a recording, in seconds. */
export interface TimeRange {
  start: number;
  end: number;
}

/** Shorter than this, a part is no part (a cut's edge, a stray frame). */
const MIN_PART_S = 0.05;

/** Cutting can work here at all: the browser encodes video and audio itself (WebCodecs). */
export const canCutVideo = () =>
  typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';

/**
 * The parts left of `[0, duration]` once `cuts` are taken out – in order, none overlapping. Cuts
 * may overlap, touch or reach past the ends.
 */
export function keptParts(duration: number, cuts: readonly TimeRange[]): TimeRange[] {
  const sorted = [...cuts]
    .map((cut) => ({ start: Math.max(0, cut.start), end: Math.min(duration, cut.end) }))
    .filter((cut) => cut.end > cut.start)
    .sort((a, b) => a.start - b.start);
  const kept: TimeRange[] = [];
  let at = 0;
  for (const cut of sorted) {
    if (cut.start - at >= MIN_PART_S) kept.push({ start: at, end: cut.start });
    at = Math.max(at, cut.end);
  }
  if (duration - at >= MIN_PART_S) kept.push({ start: at, end: duration });
  return kept;
}

/** Cuts merged where they overlap or touch – what the timeline shows and the editor keeps. */
export function mergedCuts(cuts: readonly TimeRange[]): TimeRange[] {
  const sorted = [...cuts].filter((cut) => cut.end > cut.start).sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const cut of sorted) {
    const last = merged.at(-1);
    if (last && cut.start <= last.end + MIN_PART_S) last.end = Math.max(last.end, cut.end);
    else merged.push({ ...cut });
  }
  return merged;
}

/** How long the parts are together, in seconds. */
export const partsLength = (parts: readonly TimeRange[]) =>
  parts.reduce((sum, part) => sum + part.end - part.start, 0);

/**
 * The recording with only `keep` left, as MP4 – H.264/AAC where the browser encodes them, else
 * what it does encode (VP9/VP8, Opus). `onProgress` gets 0…1. Throws a German sentence where the
 * browser cannot.
 */
export async function cutVideo(
  blob: Blob,
  keep: readonly TimeRange[],
  { onProgress, signal }: { onProgress?: (share: number) => void; signal?: AbortSignal } = {},
): Promise<Blob> {
  if (!canCutVideo()) throw new Error('Schneiden geht in diesem Browser nicht.');
  const {
    ALL_FORMATS,
    AudioSampleSink,
    AudioSampleSource,
    BlobSource,
    BufferTarget,
    getFirstEncodableAudioCodec,
    getFirstEncodableVideoCodec,
    Input,
    Mp4OutputFormat,
    Output,
    QUALITY_MEDIUM,
    VideoSampleSink,
    VideoSampleSource,
  } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('Die Aufnahme hat kein Bild.');
    const audio = await input.getPrimaryAudioTrack();
    const format = new Mp4OutputFormat({ fastStart: 'in-memory' });
    const width = video.displayWidth;
    const height = video.displayHeight;
    const total = partsLength(keep);
    const duration = await input.computeDuration();
    // About the recording's own rate: a screen's text stays as sharp as it was.
    const bitrate = Math.round(
      Math.min(5_000_000, Math.max(1_000_000, ((blob.size * 8) / Math.max(1, duration)) * 1.2)),
    );
    const videoCodec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), {
      width,
      height,
      bitrate,
    });
    if (!videoCodec) throw new Error('Schneiden geht in diesem Browser nicht.');
    const audioCodec = audio
      ? await getFirstEncodableAudioCodec(format.getSupportedAudioCodecs(), {
          numberOfChannels: audio.numberOfChannels,
          sampleRate: audio.sampleRate,
        })
      : null;
    if (audio && !audioCodec) throw new Error('Schneiden geht in diesem Browser nicht.');

    const output = new Output({ format, target: new BufferTarget() });
    const videoSource = new VideoSampleSource({
      codec: videoCodec,
      bitrate,
      // A shared window resized while recording: the picture fits, the size stays.
      sizeChangeBehavior: 'contain',
    });
    output.addVideoTrack(videoSource, { rotation: video.rotation });
    const audioSource =
      audio && audioCodec
        ? new AudioSampleSource({ codec: audioCodec, bitrate: QUALITY_MEDIUM })
        : null;
    if (audioSource) output.addAudioTrack(audioSource);
    await output.start();

    const pictures = async () => {
      const sink = new VideoSampleSink(video);
      let offset = 0;
      let last = -1;
      for (const part of keep) {
        for await (const sample of sink.samples(part.start, part.end)) {
          // Closed also when cancelled or refused – an open frame holds the decoder.
          try {
            signal?.throwIfAborted();
            // The frame showing at a part's start began before it: it starts with the part.
            const at = Math.max(offset + Math.max(0, sample.timestamp - part.start), last + 0.001);
            last = at;
            sample.setTimestamp(at);
            await videoSource.add(sample);
            if (total > 0) onProgress?.(Math.min(1, (at + sample.duration) / total));
          } finally {
            sample.close();
          }
        }
        offset += part.end - part.start;
      }
      videoSource.close();
    };
    const sound = async () => {
      if (!audio || !audioSource) return;
      const sink = new AudioSampleSink(audio);
      let offset = 0;
      let end = 0;
      for (const part of keep) {
        for await (const sample of sink.samples(part.start, part.end)) {
          try {
            signal?.throwIfAborted();
            const at = Math.max(offset + Math.max(0, sample.timestamp - part.start), end);
            end = at + sample.duration;
            sample.setTimestamp(at);
            await audioSource.add(sample);
          } finally {
            sample.close();
          }
        }
        offset += part.end - part.start;
      }
      audioSource.close();
    };
    try {
      await Promise.all([pictures(), sound()]);
      await output.finalize();
    } catch (error) {
      await output.cancel().catch(() => undefined);
      throw error;
    }
    const buffer = output.target.buffer;
    if (!buffer) throw new Error('Die Aufnahme ließ sich nicht schneiden.');
    return new Blob([buffer], { type: 'video/mp4' });
  } finally {
    input.dispose();
  }
}
