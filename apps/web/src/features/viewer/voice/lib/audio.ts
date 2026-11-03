import { MAX_MEDIA_PEAKS } from '@slider/shared';
import { downsamplePeaks } from '../../media/lib/recording';

/** A piece of speech as the server takes it: 16-bit PCM WAV, mono. */
export function encodeWav(samples: Float32Array, sampleRate = 16_000): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1)
      view.setUint8(offset + index, value.charCodeAt(index));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]!));
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return bytes;
}

/** Several pieces one after another, with a short silence between them. */
export function joinPieces(pieces: readonly Float32Array[], gapSamples = 4_000): Float32Array {
  const length =
    pieces.reduce((total, piece) => total + piece.length, 0) +
    Math.max(0, pieces.length - 1) * gapSamples;
  const audio = new Float32Array(length);
  let offset = 0;
  for (const [index, piece] of pieces.entries()) {
    if (index > 0) offset += gapSamples;
    audio.set(piece, offset);
    offset += piece.length;
  }
  return audio;
}

/** The waveform's bars: the loudest level of each stretch. */
export function peaksOf(samples: Float32Array, bars = MAX_MEDIA_PEAKS): number[] {
  const levels: number[] = [];
  const step = Math.max(1, Math.floor(samples.length / (bars * 4)));
  for (let start = 0; start < samples.length; start += step) {
    let loudest = 0;
    const end = Math.min(samples.length, start + step);
    for (let index = start; index < end; index += 1)
      loudest = Math.max(loudest, Math.abs(samples[index]!));
    levels.push(loudest);
  }
  return downsamplePeaks(levels, bars);
}

/** Root mean square of a frame, 0…1 – the level meter. */
export function levelOf(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.min(1, Math.sqrt(sum / Math.max(1, samples.length)) * 4);
}
