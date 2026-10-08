import type { Comment, UpdateTranscriptInput } from '@slider/shared';
import type { QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';

/*
 * On-device transcription of voice and video comments (BER-116). After a recording is sent, the
 * recording browser runs Whisper in a worker and sends only the text to the server. Recordings
 * are transcribed one after another; progress is a tiny store the players subscribe to.
 */

export interface TranscribeRequest {
  id: string;
  /** 16 kHz mono PCM; the language is detected from it. */
  audio: Float32Array;
}

export type TranscribeResponse =
  | { id: string; type: 'loading'; progress: number }
  | { id: string; type: 'transcribing' }
  | { id: string; type: 'done'; text: string }
  | { id: string; type: 'failed'; message: string };

export type TranscriptionProgress =
  | { phase: 'queued' }
  /** First use: the model is being downloaded (0–1). */
  | { phase: 'loading'; progress: number }
  | { phase: 'transcribing' };

const WHISPER_SAMPLE_RATE = 16_000;

/** Decodes a recording to 16 kHz mono, the input Whisper expects. */
export async function decodeForWhisper(blob: Blob): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, 1, WHISPER_SAMPLE_RATE);
  const buffer = await context.decodeAudioData(await blob.arrayBuffer());
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) mono[i]! += data[i]! / buffer.numberOfChannels;
  }
  return mono;
}

// ── Progress store ──────────────────────────────────────────────────────────

const progress = new Map<string, TranscriptionProgress>();
const listeners = new Set<() => void>();

function setProgress(mediaId: string, value: TranscriptionProgress | null) {
  if (value) progress.set(mediaId, value);
  else progress.delete(mediaId);
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** This browser's transcription of a recording, while it runs; `null` otherwise. */
export function useTranscriptionProgress(mediaId: string): TranscriptionProgress | null {
  return useSyncExternalStore(
    subscribe,
    () => progress.get(mediaId) ?? null,
    () => null,
  );
}

// ── Worker queue ────────────────────────────────────────────────────────────

let worker: Worker | null = null;
let queue: Promise<void> = Promise.resolve();

function getWorker(): Worker {
  worker ??= new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

/** Transcribing (not downloading the model) may take this long before the worker is restarted. */
const transcribeTimeoutMs = (audio: Float32Array) =>
  60_000 + 4 * (audio.length / WHISPER_SAMPLE_RATE) * 1000;

function runInWorker(mediaId: string, audio: Float32Array): Promise<string> {
  const target = getWorker();
  const id = `${mediaId}-${Date.now()}`;
  const timeoutMs = transcribeTimeoutMs(audio);
  return new Promise((resolve, reject) => {
    let timer: number | undefined;
    const finish = (error: Error | null, text = '') => {
      window.clearTimeout(timer);
      target.removeEventListener('message', onMessage);
      target.removeEventListener('error', onError);
      if (error) {
        // A crashed or stuck worker would block the queue for good: start a fresh one next time.
        target.terminate();
        if (worker === target) worker = null;
        reject(error);
      } else resolve(text);
    };
    const onError = (event: ErrorEvent) =>
      finish(new Error(event.message || 'Transcription worker crashed'));
    const onMessage = (event: MessageEvent<TranscribeResponse>) => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.type === 'loading') {
        setProgress(mediaId, { phase: 'loading', progress: message.progress });
      } else if (message.type === 'transcribing') {
        setProgress(mediaId, { phase: 'transcribing' });
        timer = window.setTimeout(() => finish(new Error('Transcription timed out')), timeoutMs);
      } else if (message.type === 'done') finish(null, message.text);
      else finish(new Error(message.message));
    };
    target.addEventListener('message', onMessage);
    target.addEventListener('error', onError);
    const request: TranscribeRequest = { id, audio };
    target.postMessage(request, [audio.buffer]);
  });
}

function replaceComment(queryClient: QueryClient, deckId: string, saved: Comment) {
  queryClient.setQueryData<Comment[]>(queryKeys.comments(deckId), (current = []) =>
    current.map((comment) => (comment.id === saved.id ? saved : comment)),
  );
}

/**
 * Transcribes a sent recording in the background and stores the text with it. Failures are
 * recorded as such, so nobody waits for a transcript that will never come.
 */
export function transcribeInBackground(options: {
  queryClient: QueryClient;
  deckId: string;
  mediaId: string;
  /** The recording's audio (for video: the separately recorded audio track). */
  audio: Blob | (() => Promise<Blob>);
}): void {
  const { queryClient, deckId, mediaId, audio } = options;
  setProgress(mediaId, { phase: 'queued' });
  queue = queue.then(async () => {
    let input: UpdateTranscriptInput;
    try {
      const blob = typeof audio === 'function' ? await audio() : audio;
      const text = await runInWorker(mediaId, await decodeForWhisper(blob));
      input = { status: 'done', transcript: text };
    } catch (error) {
      console.warn('Transcription failed', error);
      input = { status: 'failed' };
    }
    try {
      replaceComment(
        queryClient,
        deckId,
        await api.put<Comment>(`/media/${mediaId}/transcript`, input),
      );
    } catch (error) {
      console.warn('Could not save the transcript', error);
    } finally {
      setProgress(mediaId, null);
    }
  });
}
