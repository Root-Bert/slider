import { audioContext } from './sounds';

/** Louder than this (RMS of the samples, 0–1) counts as speaking. */
const SPEAKING = 0.035;
/** How often the levels are read. */
const EVERY_MS = 150;
/** Speaking stays shown this long after the last loud moment – no flicker between words. */
const HOLD_MS = 450;

/**
 * Who of a call speaks right now: each voice (one's own and the others') is listened to, and
 * `onChange` gets the ids that were loud a moment ago.
 */
export class Levels {
  private readonly sources = new Map<
    string,
    { stream: MediaStream; node: MediaStreamAudioSourceNode; analyser: AnalyserNode }
  >();
  private readonly loudAt = new Map<string, number>();
  private speaking = new Set<string>();
  private timer = 0;
  private readonly buffer = new Float32Array(512);

  constructor(private readonly onChange: (speaking: ReadonlySet<string>) => void) {}

  /** The voices to listen to, by id; a missing one is no longer heard. */
  set(voices: ReadonlyMap<string, MediaStream | null>) {
    const ctx = audioContext();
    if (!ctx) return;
    for (const [id, source] of this.sources) {
      if (voices.get(id) === source.stream) continue;
      source.node.disconnect();
      this.sources.delete(id);
    }
    for (const [id, stream] of voices) {
      if (!stream || this.sources.has(id) || stream.getAudioTracks().length === 0) continue;
      try {
        const node = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        node.connect(analyser);
        this.sources.set(id, { stream, node, analyser });
      } catch {
        // A stream without sound yet: asked again with the next change.
      }
    }
    if (this.sources.size > 0 && !this.timer)
      this.timer = window.setInterval(() => this.read(), EVERY_MS);
  }

  close() {
    window.clearInterval(this.timer);
    this.timer = 0;
    for (const source of this.sources.values()) source.node.disconnect();
    this.sources.clear();
  }

  private read() {
    const now = performance.now();
    for (const [id, { analyser }] of this.sources) {
      analyser.getFloatTimeDomainData(this.buffer);
      let sum = 0;
      for (const sample of this.buffer) sum += sample * sample;
      if (Math.sqrt(sum / this.buffer.length) > SPEAKING) this.loudAt.set(id, now);
    }
    const next = new Set(
      [...this.loudAt]
        .filter(([id, at]) => this.sources.has(id) && now - at < HOLD_MS)
        .map(([id]) => id),
    );
    if (next.size === this.speaking.size && [...next].every((id) => this.speaking.has(id))) return;
    this.speaking = next;
    this.onChange(next);
  }
}
