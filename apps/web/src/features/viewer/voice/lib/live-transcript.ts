import type { VoiceLive } from '@slider/shared';

/*
 * The words as they are spoken: the microphone's frames (16 kHz, the same the pause detector
 * hears) streamed to the service's realtime model – Mistral's, over its WebSocket, opened with a
 * short-lived token the server gets for the workspace's `live` key. Only shown: what is said still
 * goes through the pieces (`voice`). Without a key, or when the stream fails for good, it stays
 * quiet and the caption falls back to the pieces' text.
 */

/**
 * How long the service waits for more speech before it writes a word – less is faster, less sure.
 * Measured (2026-10-31, German): 480 ms → first word ~1.1 s; 240 → ~0.8 s, as accurate; 80 gets
 * words wrong. Below that the service itself (~0.4 s) is the floor.
 */
const TARGET_DELAY_MS = 240;
/** Words came this recently: more of them may still be on their way (a piece just ended). */
const SETTLE_MS = 250;
/** Frames sent together: each (32 ms) at once – every batched frame is that much later. */
const FRAMES_PER_MESSAGE = 1;
/** Sound kept while (re)connecting, at most – what was said meanwhile is written down after. */
const MAX_BACKLOG_SAMPLES = 16_000 * 4;
/** Connections that fail one after another before it gives up for this session. */
const MAX_FAILURES = 3;

type Event =
  | { type: 'session.created' }
  | { type: 'transcription.text.delta'; text: string }
  | { type: 'transcription.done' }
  | { type: 'error'; error?: { message?: unknown } }
  | { type: string };

export class LiveTranscript {
  private socket: WebSocket | null = null;
  private ready = false;
  private connecting = false;
  private stopped = false;
  private failures = 0;
  /** No new connection before this (after a failed one). */
  private retryAt = 0;
  private pending: Int16Array[] = [];
  private pendingSamples = 0;
  private batch: Int16Array[] = [];
  private text = '';
  private lastWordsAt = 0;

  constructor(
    /** A token for a new connection – `null`: no `live` key, nothing to stream to. */
    private readonly connect: () => Promise<VoiceLive>,
    /** All that was heard so far (its end the newest words). */
    private readonly onText: (text: string) => void,
    /** Gave up (no key, refused, out of reach): the caption goes back to the pieces. */
    private readonly onUnavailable: () => void,
  ) {}

  /** All heard so far – a piece ending now marks its place by this text's length. */
  get heard(): string {
    return this.text;
  }

  /**
   * How long to wait for words still on their way before a piece that just ended takes its live
   * words – none when the stream has been quiet a moment (it mostly is: a piece ends after a pause).
   */
  settlingMs(): number {
    const quiet = performance.now() - this.lastWordsAt;
    return quiet >= SETTLE_MS ? 0 : SETTLE_MS - quiet;
  }

  /** Starts the first connection; frames pushed meanwhile wait for it. */
  start(): void {
    void this.open();
  }

  /** One frame of the microphone (16 kHz mono, -1…1). */
  push(frame: Float32Array): void {
    if (this.stopped) return;
    this.batch.push(toPcm16(frame));
    if (this.batch.length < FRAMES_PER_MESSAGE) return;
    const chunk = concat(this.batch);
    this.batch = [];
    if (this.ready && this.socket?.readyState === WebSocket.OPEN) {
      this.send(chunk);
      return;
    }
    this.pending.push(chunk);
    this.pendingSamples += chunk.length;
    while (this.pendingSamples > MAX_BACKLOG_SAMPLES && this.pending.length > 1) {
      this.pendingSamples -= this.pending.shift()!.length;
    }
    // Closed meanwhile: opened again as soon as there is something to hear.
    if (!this.socket && !this.connecting && performance.now() >= this.retryAt) void this.open();
  }

  /** A pause by hand: what was said so far is written down at once. */
  flush(): void {
    if (this.batch.length > 0 && this.ready) this.send(concat(this.batch));
    this.batch = [];
    this.message({ type: 'input_audio.flush' });
  }

  /** The end: the rest is written down, then the connection closes. */
  stop(): void {
    if (this.stopped) return;
    this.flush();
    this.stopped = true;
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    if (!socket) return;
    this.message({ type: 'input_audio.end' }, socket);
    // The last words come back within a moment; then it goes.
    window.setTimeout(() => socket.close(), 1_500);
  }

  private async open(): Promise<void> {
    if (this.stopped || this.connecting) return;
    this.connecting = true;
    let live: VoiceLive;
    try {
      live = await this.connect();
    } catch {
      live = null;
    }
    this.connecting = false;
    if (this.stopped) return;
    if (!live) {
      this.giveUp();
      return;
    }
    let socket: WebSocket;
    try {
      // The browser cannot set headers on a WebSocket: the token goes as its subprotocol.
      socket = new WebSocket(live.url, ['realtime', live.token]);
    } catch {
      this.failed();
      return;
    }
    this.socket = socket;
    this.ready = false;
    socket.onmessage = (message) => {
      if (this.socket !== socket || typeof message.data !== 'string') return;
      let event: Event;
      try {
        event = JSON.parse(message.data) as Event;
      } catch {
        return;
      }
      this.handle(socket, event, live.terms);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      const worked = this.ready;
      this.socket = null;
      this.ready = false;
      // A working one closed under it (the service's limit, a long quiet): the next frame opens
      // a new one. One that never worked counts as failed.
      if (!this.stopped && !worked) this.failed();
    };
  }

  private handle(socket: WebSocket, event: Event, terms: string[]) {
    if (event.type === 'session.created') {
      this.message(
        {
          type: 'session.update',
          session: {
            audio_format: { encoding: 'pcm_s16le', sample_rate: 16_000 },
            target_streaming_delay_ms: TARGET_DELAY_MS,
            ...(terms.length > 0 ? { context_bias: terms } : {}),
          },
        },
        socket,
      );
      this.ready = true;
      this.failures = 0;
      for (const chunk of this.pending) this.send(chunk);
      this.pending = [];
      this.pendingSamples = 0;
    } else if (event.type === 'transcription.text.delta' && 'text' in event) {
      // Kept whole: the pieces mark places in it (an hour of speech is some 50 000 characters).
      this.text += event.text;
      this.lastWordsAt = performance.now();
      this.onText(this.text);
    } else if (event.type === 'error') {
      // Counts as failed: a service that keeps refusing is given up on.
      this.ready = false;
      socket.close();
    }
  }

  private failed() {
    this.failures += 1;
    if (this.failures >= MAX_FAILURES) this.giveUp();
    else this.retryAt = performance.now() + 1_000 * this.failures;
  }

  private giveUp() {
    this.stopped = true;
    this.pending = [];
    this.batch = [];
    this.onUnavailable();
  }

  private send(chunk: Int16Array) {
    this.message({ type: 'input_audio.append', audio: base64(chunk) });
  }

  private message(payload: unknown, socket = this.socket) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }
}

function toPcm16(frame: Float32Array): Int16Array {
  const pcm = new Int16Array(frame.length);
  for (let index = 0; index < frame.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, frame[index]!));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm;
}

function concat(chunks: Int16Array[]): Int16Array {
  const out = new Int16Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Little-endian bytes (as every browser's typed arrays are), base64. */
function base64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}
