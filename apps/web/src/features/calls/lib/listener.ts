import type { VoiceLive } from '@slider/shared';
import { encodeWav, LiveTranscript, type LiveSignal } from '@/features/viewer';
import { audioContext } from './sounds';

/** The live writing hears 16 kHz, in frames of 32 ms. */
const RATE = 16_000;
const FRAME = 512;
/** Louder than this (RMS, 0–1) is speaking. */
const LOUD = 0.02;
/**
 * Over the agent's voice one's own must be louder than this – what the echo cancelling leaves
 * of the agent is quieter – and this long, to talk over it (the agent stops in every tab).
 */
const OVER_LOUD = 0.05;
const OVER_MS = 160;
/** Words heard this shortly before one talked over the agent are one's own (they come late). */
const OVER_KEEP_MS = 800;
/**
 * This long quiet after speaking ends a turn – where the live writing does not say it itself
 * (its turn detection, `turn`), which is faster and knows a pause in a sentence from its end.
 */
const TURN_PAUSE_MS = 500;
/** With the service's turn detection, the own pause only catches a turn it missed. */
const MISSED_TURN_MS = 1_500;
/**
 * Its last words often come after the service said the turn ended (measured: 30–60 ms, in the
 * browser later): cut once the turn's words end a sentence (. ? ! – the service writes them), or
 * once the service says the flush is written down (~450 ms), at the latest after this.
 */
const MAX_WAIT_MS = 1_200;
/** A turn that goes on and on is handed over at its next breath anyway. */
const LONG_TURN_MS = 30_000;
const SHORT_PAUSE_MS = 350;
/** Without live words, what came just before the voice got loud is kept with the turn. */
const PRE_ROLL = RATE * 0.4;

/**
 * Writes down what this tab's person says in a call – the call's own microphone track, brought
 * to 16 kHz and streamed to the live writing (`LiveTranscript`, the workspace's `live` key) – and
 * hands it over turn by turn: a turn ends after a pause. Without live words (no `live` key, the
 * service away) each turn goes as a recording instead (`onAudio`), written down on the server.
 * Muted, nothing is sent. Nobody else is written down here: each tab writes its own person.
 */
export class CallListener {
  private readonly live: LiveTranscript;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: ScriptProcessorNode | null = null;
  private silent: GainNode | null = null;
  private track: MediaStreamTrack | null = null;
  /** The agent is being read out here: its voice is not one's turn, unless one talks over it. */
  private agentSpeaking = false;
  private talkedOver = false;
  /** How long one has been loud over the agent's voice. */
  private overFor = 0;
  /** How much was heard when, the last moment – to keep one's first words when talking over. */
  private heardAt: [number, number][] = [];
  /** How much of the heard text was handed over already. */
  private sent = 0;
  private speaking = false;
  private loudAt = 0;
  private turnFrom = 0;
  private cutting = 0;
  /** The live writing says where turns end (its turn detection works). */
  private turns = false;
  /** A cut waits for the live writing to say a flush is written down. */
  private waitingDone = false;
  private carry = new Float32Array(0);
  /** No live words: turns go as recordings. */
  private recording = false;
  /** The turn being spoken (recordings), and what came just before it. */
  private turn: Float32Array[] = [];
  private before: Float32Array[] = [];

  constructor(
    connect: () => Promise<VoiceLive>,
    private readonly onTurn: (text: string) => void,
    private readonly onAudio: (wav: Uint8Array<ArrayBuffer>) => void,
    /** One talked over the agent's answer. */
    private readonly onOver: () => void,
  ) {
    // The text is taken at each cut (`heard`), not as it comes.
    this.live = new LiveTranscript(
      connect,
      () => {},
      () => {
        this.recording = true;
      },
      (signal) => this.signal(signal),
    );
  }

  /** Listens to this track (the call's microphone; a new one after it was turned on again). */
  use(track: MediaStreamTrack | null) {
    if (track === this.track) return;
    this.unhook();
    this.track = track;
    const context = audioContext();
    if (!track || !context) return;
    if (!this.context) this.live.start();
    this.context = context;
    this.source = context.createMediaStreamSource(new MediaStream([track]));
    // ScriptProcessor: deprecated, but needs no module file (CSP) and runs everywhere. 2048
    // samples (~43 ms): talking over the agent is noticed that much sooner.
    this.node = context.createScriptProcessor(2048, 1, 1);
    this.silent = context.createGain();
    this.silent.gain.value = 0;
    this.node.onaudioprocess = (event) => this.frames(event.inputBuffer.getChannelData(0));
    this.source.connect(this.node);
    this.node.connect(this.silent);
    this.silent.connect(context.destination);
  }

  /**
   * The agent is read out here (or stopped): one keeps being heard – to talk over it – but what
   * comes through of its voice is not written down as one's words.
   */
  hearAgent(speaking: boolean) {
    if (speaking === this.agentSpeaking) return;
    this.agentSpeaking = speaking;
    this.overFor = 0;
    if (!speaking && !this.talkedOver) this.forget();
    this.talkedOver = false;
  }

  /** What was heard so far is not one's turn (the agent's voice, as far as it came through). */
  private forget() {
    window.clearTimeout(this.cutting);
    this.waitingDone = false;
    this.speaking = false;
    this.turn = [];
    this.sent = this.live.heard.length;
  }

  /** Hands over what is left and closes – the call ends or the tab leaves it. */
  finish() {
    window.clearTimeout(this.cutting);
    this.live.flush();
    this.cut();
    this.live.stop();
    this.unhook();
    this.track = null;
  }

  private unhook() {
    if (this.node) this.node.onaudioprocess = null;
    this.source?.disconnect();
    this.node?.disconnect();
    this.silent?.disconnect();
    this.source = null;
    this.node = null;
    this.silent = null;
  }

  private frames(input: Float32Array) {
    if (!this.track?.enabled || !this.context) return;
    const samples = resample(input, this.context.sampleRate);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const now = performance.now();
    const level = Math.sqrt(sum / Math.max(1, samples.length));
    let loud = level > LOUD;
    if (this.agentSpeaking && !this.talkedOver) {
      // A short dip (a consonant, a comma) does not start it over.
      const ms = (samples.length / RATE) * 1000;
      this.overFor = level > OVER_LOUD ? this.overFor + ms : Math.max(0, this.overFor - ms / 4);
      this.heardAt.push([now, this.live.heard.length]);
      while (this.heardAt.length > 1 && now - this.heardAt[0]![0] > OVER_KEEP_MS)
        this.heardAt.shift();
      if (this.overFor >= OVER_MS) {
        this.forget();
        // What came of one's own first words meanwhile stays (the agent's voice, a moment before).
        this.sent = this.heardAt[0]?.[1] ?? this.sent;
        this.heardAt = [];
        this.talkedOver = true;
        this.onOver();
      } else loud = false;
    }
    if (loud) {
      if (!this.speaking) {
        this.turnFrom = now;
        this.turn = this.before;
        this.before = [];
      }
      this.speaking = true;
      this.loudAt = now;
    }
    if (this.recording) {
      if (this.speaking) this.turn.push(samples);
      else {
        this.before.push(samples);
        let kept = this.before.reduce((sum, part) => sum + part.length, 0);
        while (this.before.length > 1 && kept - this.before[0]!.length >= PRE_ROLL)
          kept -= this.before.shift()!.length;
      }
    }
    const joined = new Float32Array(this.carry.length + samples.length);
    joined.set(this.carry);
    joined.set(samples, this.carry.length);
    let at = 0;
    for (; at + FRAME <= joined.length; at += FRAME)
      this.live.push(joined.subarray(at, at + FRAME));
    this.carry = joined.slice(at);
    if (!this.speaking) return;
    const quiet = now - this.loudAt;
    const long = now - this.turnFrom > LONG_TURN_MS;
    const pause = this.turns && !this.recording ? MISSED_TURN_MS : TURN_PAUSE_MS;
    if (quiet >= pause || (long && quiet >= SHORT_PAUSE_MS)) {
      this.speaking = false;
      window.clearTimeout(this.cutting);
      if (this.recording) return this.cut();
      // The last words are still on their way: cut once the service says they are written.
      this.live.flush();
      this.waitingDone = true;
      this.cutting = window.setTimeout(() => this.cut(), MAX_WAIT_MS);
    }
  }

  /** The live writing says a turn ended, or that a flush is written down. */
  private signal(signal: LiveSignal) {
    if (this.recording) return;
    if (this.agentSpeaking && !this.talkedOver) return this.forget();
    if (signal === 'done') {
      if (!this.waitingDone) return;
      window.clearTimeout(this.cutting);
      this.cut();
      return;
    }
    this.turns = true;
    this.speaking = false;
    window.clearTimeout(this.cutting);
    this.live.flush();
    this.waitingDone = true;
    const ended = performance.now();
    const settle = () => {
      if (!this.waitingDone) return;
      const said = this.live.heard.slice(this.sent).trim();
      if (/[.?!…]["“”»«)]*$/.test(said) || performance.now() - ended >= MAX_WAIT_MS)
        return this.cut();
      this.cutting = window.setTimeout(settle, 40);
    };
    settle();
  }

  private cut() {
    this.waitingDone = false;
    if (this.recording) {
      const parts = this.turn;
      this.turn = [];
      const length = parts.reduce((sum, part) => sum + part.length, 0);
      // Shorter than half a second: a cough, a click – nothing said.
      if (length < RATE / 2) return;
      const samples = new Float32Array(length);
      let at = 0;
      for (const part of parts) {
        samples.set(part, at);
        at += part.length;
      }
      this.onAudio(encodeWav(samples, RATE));
      return;
    }
    const text = this.live.heard;
    const turn = text.slice(this.sent).replace(/\s+/g, ' ').trim();
    this.sent = text.length;
    if (turn) this.onTurn(turn);
  }
}

/** From the context's rate to 16 kHz – averaging what falls into each new sample. */
function resample(input: Float32Array, rate: number): Float32Array {
  if (rate === RATE) return input.slice();
  const ratio = rate / RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let index = 0; index < out.length; index += 1) {
    const from = Math.floor(index * ratio);
    const to = Math.min(input.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let at = from; at < to; at += 1) sum += input[at]!;
    out[index] = sum / Math.max(1, to - from);
  }
  return out;
}
