/**
 * A spoken comment's recording: its pieces of speech (16 kHz PCM) encoded in the browser as
 * Opus in WebM – AAC in MP4 where the browser has no Opus encoder (Safari) – the formats the
 * server keeps for voice comments. `null` where the browser encodes neither (no WebCodecs):
 * the comment then keeps its text alone.
 */
export async function encodeClip(
  samples: Float32Array,
  sampleRate = 16_000,
): Promise<{ blob: Blob; mimeType: string } | null> {
  if (typeof AudioEncoder === 'undefined') return null;
  const {
    AudioSample,
    AudioSampleSource,
    BufferTarget,
    canEncodeAudio,
    Mp4OutputFormat,
    Output,
    QUALITY_LOW,
    WebMOutputFormat,
  } = await import('mediabunny');
  const opus = await canEncodeAudio('opus', { numberOfChannels: 1, sampleRate: 48_000 });
  const aac = !opus && (await canEncodeAudio('aac', { numberOfChannels: 1, sampleRate: 48_000 }));
  if (!opus && !aac) return null;
  const output = new Output({
    format: opus ? new WebMOutputFormat() : new Mp4OutputFormat(),
    target: new BufferTarget(),
  });
  const source = new AudioSampleSource({
    codec: opus ? 'opus' : 'aac',
    quality: QUALITY_LOW,
    // Encoders take 48 kHz everywhere; Opus would not take 16 kHz in every browser.
    transform: { sampleRate: 48_000, numberOfChannels: 1 },
  });
  output.addAudioTrack(source);
  await output.start();
  const sample = new AudioSample({
    data: samples,
    format: 'f32',
    numberOfChannels: 1,
    sampleRate,
    timestamp: 0,
  });
  await source.add(sample);
  sample.close();
  await output.finalize();
  const buffer = output.target.buffer;
  if (!buffer) return null;
  const mimeType = opus ? 'audio/webm' : 'audio/mp4';
  return { blob: new Blob([buffer], { type: mimeType }), mimeType };
}
