/*
 * The agent's voice in a call: its own (Mistral's Voxtral, made on the server sentence by
 * sentence and streamed as WAV) where the workspace speaks with Mistral, else the system's
 * speech (`speechSynthesis`, German). Each part's audio is fetched the moment it is announced
 * and played through Web Audio as it arrives, right after the part before – no gap between
 * sentences. One answer at a time; a new one waits.
 */

/** A part resolves this long before its last sound: the next one is scheduled without a gap. */
const LEAD_S = 0.15;

let context: AudioContext | null = null;
/** When what is scheduled in `context` ends, on its clock. */
let until = 0;
const sources = new Set<AudioBufferSourceNode>();
/** Counts `hush`es – what was hushed is not spoken after all. */
let hushes = 0;

const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

/**
 * Readies the voice while the person clicks (starting or joining a call): browsers let a page
 * play sound only after a gesture.
 */
export function wakeVoice() {
  if (typeof AudioContext === 'undefined') return;
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume().catch(() => {});
}

/** Begins loading a part's audio at once; `speak` plays it when its turn comes. */
export function fetchVoice(url: string): Promise<Response | null> {
  return fetch(url, { credentials: 'include' }).then(
    (response) => (response.ok && response.body ? response : null),
    () => null,
  );
}

/** The best German voice the system has – an enhanced or premium one where installed. */
function germanVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((voice) => /^de\b/i.test(voice.lang));
  const rank = (voice: SpeechSynthesisVoice) =>
    (/premium|enhanced|natural|neural/i.test(voice.name) ? 2 : 0) + (voice.localService ? 1 : 0);
  return voices.sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

/**
 * Reads `text` out – from `audio` (its own voice, see {@link fetchVoice}) where given, else or
 * when that fails by the system; resolves once it was said (or is about to end).
 */
export async function speak(
  text: string,
  audio: Promise<Response | null> | null = null,
): Promise<void> {
  const before = hushes;
  if (audio) {
    const response = await audio;
    if (hushes !== before) return;
    if (response && (await play(response, before))) return;
  }
  if (hushes !== before) return;
  return system(text);
}

/** Where a WAV's samples begin and at what rate; `more`: its header is not complete yet. */
function wavHeader(bytes: Uint8Array): { rate: number; data: number } | 'more' | null {
  if (bytes.length < 12) return 'more';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let rate = 24000;
  for (let at = 12; ;) {
    if (at + 8 > bytes.length) return 'more';
    const size = view.getUint32(at + 4, true);
    if (tag(at) === 'data') return { rate, data: at + 8 };
    if (tag(at) === 'fmt ') {
      if (at + 16 > bytes.length) return 'more';
      rate = view.getUint32(at + 12, true);
    }
    at += 8 + size + (size % 2);
  }
}

/** Plays 16-bit mono samples right after what is scheduled. */
function schedule(audio: AudioContext, bytes: Uint8Array, rate: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const buffer = audio.createBuffer(1, bytes.length / 2, rate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < channel.length; i += 1) channel[i] = view.getInt16(i * 2, true) / 32768;
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  const at = Math.max(until, audio.currentTime + 0.02);
  source.start(at);
  until = at + buffer.duration;
  sources.add(source);
  source.onended = () => sources.delete(source);
}

/**
 * Plays a part's WAV as it arrives; `false` when nothing of it could be played (the system
 * speaks instead).
 */
async function play(response: Response, before: number): Promise<boolean> {
  if (!context || !response.body) return false;
  const audio = context;
  if (audio.state !== 'running') await audio.resume().catch(() => {});
  if (audio.state !== 'running' || hushes !== before) return false;
  const reader = response.body.getReader();
  let rate = 0;
  let carry = new Uint8Array(0);
  let played = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (hushes !== before) {
        void reader.cancel();
        return true;
      }
      if (done) break;
      let bytes = carry.length ? new Uint8Array([...carry, ...value]) : value;
      if (!rate) {
        const header = wavHeader(bytes);
        if (header === 'more') {
          carry = bytes;
          continue;
        }
        if (!header) return played;
        rate = header.rate;
        bytes = bytes.subarray(header.data);
      }
      const whole = bytes.length - (bytes.length % 2);
      carry = bytes.slice(whole);
      if (whole > 0) {
        schedule(audio, bytes.subarray(0, whole), rate);
        played = true;
      }
    }
  } catch {
    // The stream broke off: said as far as it came.
  }
  while (played && hushes === before && audio.currentTime < until - LEAD_S) {
    await new Promise((resolve) =>
      window.setTimeout(resolve, Math.min(100, (until - LEAD_S - audio.currentTime) * 1000)),
    );
  }
  return played;
}

function system(text: string): Promise<void> {
  if (!supported() || !text.trim()) return Promise.resolve();
  return new Promise((resolve) => {
    // Some browsers never say they are done (Chrome without voices, a page in the background):
    // after about as long as reading it takes, it counts as said.
    const timer = window.setTimeout(() => done(), 3000 + text.length * 90);
    const done = () => {
      window.clearTimeout(timer);
      resolve();
    };
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'de-DE';
    const voice = germanVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 1.05;
    utterance.onend = done;
    utterance.onerror = done;
    window.speechSynthesis.speak(utterance);
  });
}

/** Stops what is being read out (the call ended, someone talks over it). */
export function hush() {
  hushes += 1;
  for (const source of sources) source.stop();
  sources.clear();
  until = 0;
  if (supported()) window.speechSynthesis.cancel();
}
