import type { MicVAD } from '@ricky0123/vad-web';
import { AUDIO_CONSTRAINTS } from '../../media/lib/recording';

/** Where the pause detector's files are served (`vadAssets` in `vite.config.ts`). */
export const VAD_BASE = '/vad/';

export interface Microphone {
  /** Listens again after `pause`. */
  resume: () => Promise<void>;
  /** Stops listening – the microphone is released. */
  pause: () => Promise<void>;
  destroy: () => Promise<void>;
}

type FrameListener = (frame: Float32Array, probability: number) => void;

/** A pause detector loaded and waiting – the microphone not yet open. */
interface Prepared {
  vad: MicVAD;
  /** Who hears its frames, once it listens. */
  onFrame: FrameListener | null;
  /** The microphone asked for already (at the click), taken by its first start. */
  stream: Promise<MediaStream> | null;
}

const askMicrophone = () => navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });

function release(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

let prepared: Promise<Prepared> | null = null;

/**
 * Loads the pause detector ahead (its code, onnxruntime's WebAssembly – some 14 MB – and Silero's
 * model), so that listening starts at once: done in the background while speaking is possible.
 * Loading it at the click took seconds before the microphone was even asked for.
 */
export function prepareMicrophone(): Promise<Prepared> {
  if (prepared) return prepared;
  const loading = (async () => {
    const { MicVAD } = await import('@ricky0123/vad-web');
    const entry: Prepared = { vad: null as unknown as MicVAD, onFrame: null, stream: null };
    entry.vad = await MicVAD.new({
      model: 'v5',
      baseAssetPath: VAD_BASE,
      onnxWASMBasePath: VAD_BASE,
      // One thread: several need cross-origin isolation, which the app does not ask for.
      ortConfig: (ort) => {
        ort.env.wasm.numThreads = 1;
        ort.env.logLevel = 'error';
      },
      getStream: () => {
        const stream = entry.stream ?? askMicrophone();
        entry.stream = null;
        return stream;
      },
      pauseStream: async (stream) => release(stream),
      resumeStream: askMicrophone,
      onFrameProcessed: (probabilities, frame) => entry.onFrame?.(frame, probabilities.isSpeech),
      startOnLoad: false,
    });
    return entry;
  })();
  prepared = loading;
  // A failed load is tried again next time.
  loading.catch(() => {
    if (prepared === loading) prepared = null;
  });
  return loading;
}

/**
 * The microphone with Silero's speech probability per frame (16 kHz, 512 samples): the frames
 * go to `onFrame`, the cutting into pieces is ours (`Segmenter`). Silero runs in the browser
 * (onnxruntime, WebAssembly) – nothing leaves the device before a piece is cut.
 *
 * The microphone is asked for at once, side by side with the detector still loading (when it was
 * not prepared ahead).
 */
export async function openMicrophone(onFrame: FrameListener): Promise<Microphone> {
  const stream = askMicrophone();
  const loading = prepareMicrophone();
  let entry: Prepared;
  try {
    [entry] = await Promise.all([loading, stream]);
  } catch (failure) {
    void stream.then(release, () => undefined);
    throw failure;
  }
  // Taken: the next listening prepares its own (onnxruntime stays loaded – that one is quick).
  if (prepared === loading) prepared = null;
  entry.stream = stream;
  entry.onFrame = onFrame;
  const { vad } = entry;
  try {
    await vad.start();
  } catch (failure) {
    void stream.then(release, () => undefined);
    throw failure;
  }
  return {
    resume: () => vad.start(),
    pause: () => vad.pause(),
    destroy: async () => {
      entry.onFrame = null;
      await vad.destroy();
    },
  };
}
