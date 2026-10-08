import {
  env,
  pipeline,
  Tensor,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
} from '@huggingface/transformers';
import type { TranscribeRequest, TranscribeResponse } from './transcription';

/*
 * Whisper in the browser (BER-116): the recording never leaves the device for transcription.
 * The model is downloaded once from the Hugging Face hub and kept in the browser's cache.
 */

env.allowLocalModels = false;

const MODEL = import.meta.env.VITE_WHISPER_MODEL || 'onnx-community/whisper-small';

let transcriber: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

/** WebGPU where available (much faster), otherwise WebAssembly with 8-bit weights. */
async function load(onProgress: (info: ProgressInfo) => void) {
  const progress_callback = onProgress;
  if (await hasWebGpu()) {
    try {
      return await pipeline('automatic-speech-recognition', MODEL, {
        device: 'webgpu',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        progress_callback,
      });
    } catch {
      // Some GPUs/drivers fail at session creation – WASM always works.
    }
  }
  return pipeline('automatic-speech-recognition', MODEL, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback,
  });
}

/**
 * Whisper's language identification: one decoder step after the start token, the most likely
 * language token wins. transformers.js skips this and assumes English – which makes Whisper
 * translate German speech instead of transcribing it.
 */
async function detectLanguage(
  asr: AutomaticSpeechRecognitionPipeline,
  audio: Float32Array,
): Promise<string | undefined> {
  const { input_features } = await asr.processor(audio.subarray(0, 30 * 16_000));
  const config = asr.model.generation_config as unknown as {
    decoder_start_token_id: number;
    lang_to_id?: Record<string, number>;
  };
  if (!config.lang_to_id) return undefined;
  const start = new Tensor(
    'int64',
    BigInt64Array.from([BigInt(config.decoder_start_token_id)]),
    [1, 1],
  );
  const { logits } = (await asr.model({ input_features, decoder_input_ids: start })) as {
    logits: Tensor;
  };
  const scores = logits.data as Float32Array;
  let best: string | undefined;
  let bestScore = -Infinity;
  for (const [token, id] of Object.entries(config.lang_to_id)) {
    if (scores[id]! > bestScore) {
      bestScore = scores[id]!;
      best = token.slice(2, -2); // `<|de|>` → `de`
    }
  }
  return best;
}

const post = (message: TranscribeResponse) => self.postMessage(message);

self.onmessage = async (event: MessageEvent<TranscribeRequest>) => {
  const { id, audio } = event.data;
  try {
    transcriber ??= load((info) => {
      // First use only: the model download (cached by the browser afterwards).
      if (info.status === 'progress_total')
        post({ id, type: 'loading', progress: info.progress / 100 });
    }).catch((error: unknown) => {
      transcriber = null;
      throw error;
    });
    const asr = await transcriber;
    post({ id, type: 'transcribing' });
    const language = await detectLanguage(asr, audio);
    const output = await asr(audio, {
      ...(language && { language }),
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const text = (Array.isArray(output) ? output.map((o) => o.text).join(' ') : output.text).trim();
    post({ id, type: 'done', text });
  } catch (error) {
    post({ id, type: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
};
