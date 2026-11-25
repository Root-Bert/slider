/*
 * What the AI reads of a video put on a message: the server sees no video (no video tools), so
 * the browser takes stills and the sound from it (Mediabunny over WebCodecs) and hands them over
 * once it is up (`POST /attachments/:id/digest`). Nothing of it is shown to anyone.
 */

/** Stills of one video: one about every ten seconds, three to eight. */
const STILLS_MIN = 3;
const STILLS_MAX = 8;
/** As wide as a picture the models read well without costing much. */
const STILL_WIDTH = 768;
/** Speech to text takes about 25 MB: 12 minutes of 16 kHz mono WAV. */
const SPEECH_MAX_S = 12 * 60;

/**
 * The recording's sound alone, as 16 kHz mono WAV – what speech recognition reads (a minute is
 * about 2 MB). No encoder needed: WAV is plain samples. `upTo`: only its first seconds.
 */
export async function speechOf(blob: Blob, signal?: AbortSignal, upTo?: number): Promise<Blob> {
  const { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Output, WavOutputFormat } =
    await import('mediabunny');
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const output = new Output({ format: new WavOutputFormat(), target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      video: { discard: true },
      audio: { numberOfChannels: 1, sampleRate: 16_000 },
      ...(upTo ? { trim: { start: 0, end: upTo } } : {}),
    });
    if (!conversion.isValid) throw new Error('Die Aufnahme hat keinen Ton.');
    const cancel = () => void conversion.cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      await conversion.execute();
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
    signal?.throwIfAborted();
    const buffer = output.target.buffer;
    if (!buffer) throw new Error('Die Aufnahme hat keinen Ton.');
    return new Blob([buffer], { type: 'audio/wav' });
  } finally {
    input.dispose();
  }
}

const jpeg = (canvas: HTMLCanvasElement | OffscreenCanvas) =>
  'convertToBlob' in canvas
    ? canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 })
    : new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.7));

/**
 * A video's stills (JPEG, with their times), its length and its sound, as the digest's form.
 * `null` where this browser cannot look into it (no decoder, a format it does not read). The
 * sound left out where there is none.
 */
export async function videoDigestForm(file: Blob, signal?: AbortSignal): Promise<FormData | null> {
  if (typeof VideoDecoder === 'undefined') return null;
  const { ALL_FORMATS, BlobSource, CanvasSink, Input } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const form = new FormData();
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video || !(await video.canDecode())) return null;
    const duration = await input.computeDuration();
    form.append('duration', String(duration));
    const count = Math.min(STILLS_MAX, Math.max(STILLS_MIN, Math.round(duration / 10)));
    const times = Array.from({ length: count }, (_, index) => ((index + 0.5) / count) * duration);
    const sink = new CanvasSink(video, {
      width: Math.min(STILL_WIDTH, video.displayWidth),
      poolSize: 1,
    });
    const at: number[] = [];
    let index = 0;
    for await (const still of sink.canvasesAtTimestamps(times)) {
      signal?.throwIfAborted();
      const time = times[index++] ?? 0;
      if (!still) continue;
      const bytes = await jpeg(still.canvas);
      if (!bytes) continue;
      form.append('still', bytes, `bild-${at.length + 1}.jpg`);
      at.push(Math.round(time * 10) / 10);
    }
    form.append('at', JSON.stringify(at));
  } finally {
    input.dispose();
  }
  const speech = await speechOf(file, signal, SPEECH_MAX_S).catch((error: unknown) => {
    if (signal?.aborted) throw error;
    return null;
  });
  if (speech) form.append('speech', speech, 'ton.wav');
  return form;
}
