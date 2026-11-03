/*
 * Cuts the microphone's sound into pieces of speech at the person's pauses, from Silero's
 * speech probability per frame (as the VAD's own algorithm does, plus a longest piece: one
 * who speaks on without a pause is cut at the quietest moment of the last seconds).
 */

export interface SegmenterOptions {
  sampleRate: number;
  /** Samples per frame (Silero v5: 512 at 16 kHz – 32 ms). */
  frameSamples: number;
  /** A frame at or over this counts as speech… */
  positive: number;
  /** …under this as silence (in between: neither). */
  negative: number;
  /** Silence this long ends a piece. */
  redemptionMs: number;
  /** Kept before the first speech, so its first syllable is not cut. */
  preSpeechPadMs: number;
  /** Kept of the silence after the last speech. */
  postSpeechPadMs: number;
  /** Less speech than this is no piece (a cough, a click). */
  minSpeechMs: number;
  /** A piece is cut at the latest here. */
  maxSegmentMs: number;
}

export const DEFAULT_SEGMENTER: SegmenterOptions = {
  sampleRate: 16_000,
  frameSamples: 512,
  positive: 0.5,
  negative: 0.35,
  redemptionMs: 650,
  preSpeechPadMs: 320,
  postSpeechPadMs: 200,
  minSpeechMs: 300,
  maxSegmentMs: 25_000,
};

export interface SpeechPiece {
  /** 16 kHz mono, -1…1. */
  audio: Float32Array;
  /** When it began and ended, on the clock `push` was given. */
  startMs: number;
  endMs: number;
}

interface Frame {
  samples: Float32Array;
  probability: number;
  atMs: number;
}

/** Where a too long piece is cut: among its last seconds. */
const CUT_SEARCH_MS = 4_000;

export class Segmenter {
  private readonly msPerFrame: number;
  private readonly padFrames: number;
  private readonly redemptionFrames: number;
  private readonly postPadFrames: number;
  private readonly minSpeechFrames: number;
  private readonly maxFrames: number;
  /** The last frames while silent – the pad before a piece. */
  private before: Frame[] = [];
  /** The piece being heard, or `null` while silent. */
  private piece: Frame[] | null = null;
  private speechFrames = 0;
  private silentRun = 0;

  constructor(
    private readonly onPiece: (piece: SpeechPiece) => void,
    private readonly onSpeaking: (speaking: boolean) => void = () => {},
    options: Partial<SegmenterOptions> = {},
  ) {
    const o = { ...DEFAULT_SEGMENTER, ...options };
    this.msPerFrame = (o.frameSamples / o.sampleRate) * 1000;
    const frames = (ms: number) => Math.max(1, Math.round(ms / this.msPerFrame));
    this.padFrames = frames(o.preSpeechPadMs);
    this.redemptionFrames = frames(o.redemptionMs);
    this.postPadFrames = frames(o.postSpeechPadMs);
    this.minSpeechFrames = frames(o.minSpeechMs);
    this.maxFrames = frames(o.maxSegmentMs);
    this.positive = o.positive;
    this.negative = o.negative;
  }

  private readonly positive: number;
  private readonly negative: number;

  /** Whether a piece is being heard. */
  get speaking(): boolean {
    return this.piece !== null && this.speechFrames > 0;
  }

  /** One frame and Silero's probability that it is speech; `atMs`: when it ended. */
  push(samples: Float32Array, probability: number, atMs: number): void {
    const frame: Frame = { samples: samples.slice(), probability, atMs };
    if (!this.piece) {
      if (probability >= this.positive) {
        this.piece = [...this.before, frame];
        this.before = [];
        this.speechFrames = 1;
        this.silentRun = 0;
        this.onSpeaking(true);
      } else {
        this.before.push(frame);
        if (this.before.length > this.padFrames) this.before.shift();
      }
      return;
    }
    this.piece.push(frame);
    if (probability >= this.positive) {
      this.speechFrames += 1;
      this.silentRun = 0;
    } else if (probability < this.negative) {
      this.silentRun += 1;
    }
    if (this.silentRun >= this.redemptionFrames) {
      this.end();
      return;
    }
    if (this.piece.length >= this.maxFrames) this.cut();
  }

  /** The piece being heard ends now (a pause by hand, the end). */
  flush(): void {
    if (this.piece) this.end();
    this.before = [];
  }

  private end() {
    const piece = this.piece!;
    // The silence after the last speech, but a little of it.
    const keep = Math.min(piece.length, piece.length - this.silentRun + this.postPadFrames);
    const frames = piece.slice(0, keep);
    const speech = this.speechFrames;
    this.piece = null;
    this.speechFrames = 0;
    this.silentRun = 0;
    // What followed is the pad of the next piece.
    this.before = piece.slice(keep).slice(-this.padFrames);
    this.onSpeaking(false);
    if (speech >= this.minSpeechFrames) this.emit(frames);
  }

  /** Too long: cut at the quietest frame of the last seconds, the rest goes on. */
  private cut() {
    const piece = this.piece!;
    const search = Math.min(piece.length - 1, Math.round(CUT_SEARCH_MS / this.msPerFrame));
    let at = piece.length - 1;
    for (let index = piece.length - 1; index >= piece.length - search; index -= 1) {
      if (piece[index]!.probability < piece[at]!.probability) at = index;
    }
    const head = piece.slice(0, at + 1);
    const rest = piece.slice(at + 1);
    this.piece = rest;
    this.speechFrames = rest.filter((frame) => frame.probability >= this.positive).length || 1;
    this.silentRun = 0;
    this.emit(head);
  }

  private emit(frames: Frame[]) {
    if (frames.length === 0) return;
    const length = frames.reduce((total, frame) => total + frame.samples.length, 0);
    const audio = new Float32Array(length);
    let offset = 0;
    for (const frame of frames) {
      audio.set(frame.samples, offset);
      offset += frame.samples.length;
    }
    this.onPiece({
      audio,
      startMs: Math.max(0, frames[0]!.atMs - this.msPerFrame),
      endMs: frames.at(-1)!.atMs,
    });
  }
}
