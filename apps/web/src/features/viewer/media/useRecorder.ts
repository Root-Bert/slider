import { MAX_MEDIA_DURATION_MS, type MediaKind } from '@slider/shared';
import fixWebmDuration from 'fix-webm-duration';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AUDIO_CONSTRAINTS,
  canRecord,
  downsamplePeaks,
  pickRecorderFormat,
  RECORDER_BITRATES,
  VIDEO_CONSTRAINTS,
} from './recording';

/** A finished recording, ready to send. */
export interface Recording {
  kind: MediaKind;
  blob: Blob;
  /** Object URL of `blob` for the preview; revoked when the recorder resets or unmounts. */
  url: string;
  mimeType: string;
  durationMs: number;
  peaks: number[];
  /** Audio for the transcription – for video the separately recorded voice track. */
  transcriptionAudio: Blob;
}

export type RecorderState =
  | { status: 'idle' }
  | { status: 'requesting' }
  /** Video: the camera preview runs, recording has not started. */
  | { status: 'ready' }
  | { status: 'recording' }
  | { status: 'recorded'; recording: Recording }
  | { status: 'error'; message: string };

const LEVEL_INTERVAL_MS = 100;
/** Bars of the live meter while recording. */
const LIVE_BARS = 40;

const DEVICE_NAMES: Record<MediaKind, string> = { audio: 'Mikrofon', video: 'Kamera und Mikrofon' };

function describeError(error: unknown, kind: MediaKind): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return `Kein Zugriff auf ${DEVICE_NAMES[kind]}. Bitte im Browser erlauben und erneut versuchen.`;
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return `${kind === 'audio' ? 'Kein Mikrofon' : 'Keine Kamera'} gefunden.`;
  if (name === 'NotReadableError')
    return `${DEVICE_NAMES[kind]} wird gerade von einer anderen App benutzt.`;
  return 'Die Aufnahme ist fehlgeschlagen. Bitte erneut versuchen.';
}

function recorderFor(stream: MediaStream, kind: MediaKind): MediaRecorder {
  const mimeType = pickRecorderFormat(kind, (type) => MediaRecorder.isTypeSupported(type));
  return new MediaRecorder(stream, { ...(mimeType && { mimeType }), ...RECORDER_BITRATES[kind] });
}

/** Collects a recorder's chunks into one blob once it stops. */
function collect(recorder: MediaRecorder): Promise<Blob> {
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  return new Promise((resolve) =>
    recorder.addEventListener('stop', () =>
      resolve(new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || '' })),
    ),
  );
}

/** Chrome writes WebM without a duration – players then can't seek. Patch it in. */
async function withDuration(blob: Blob, durationMs: number): Promise<Blob> {
  if (!blob.type.includes('webm')) return blob;
  try {
    return await fixWebmDuration(blob, durationMs, { logger: false });
  } catch {
    return blob;
  }
}

/**
 * Voice or video recording with MediaRecorder (BER-116): compressed while recording, live level
 * meter, stops by itself after five minutes. Video opens the camera right away for a preview.
 */
export function useRecorder(kind: MediaKind, { autoStart = false }: { autoStart?: boolean } = {}) {
  const [state, setState] = useState<RecorderState>(() =>
    !canRecord()
      ? {
          status: 'error',
          message: 'Aufnehmen geht nur über https (oder localhost) in einem aktuellen Browser.',
        }
      : kind === 'video' || autoStart
        ? { status: 'requesting' }
        : { status: 'idle' },
  );
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [levels, setLevels] = useState<number[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const urlRef = useRef<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const pendingRef = useRef<Promise<MediaStream | null> | null>(null);
  const mountedRef = useRef(false);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  /**
   * One camera/microphone request at a time; a stream arriving after unmount is closed. State
   * changes only once the browser answered – callers show "requesting" themselves.
   */
  const acquire = useCallback((): Promise<MediaStream | null> => {
    if (streamRef.current) return Promise.resolve(streamRef.current);
    if (pendingRef.current) return pendingRef.current;
    if (!canRecord()) return Promise.resolve(null);
    pendingRef.current = navigator.mediaDevices
      .getUserMedia({
        audio: AUDIO_CONSTRAINTS,
        video: kind === 'video' ? VIDEO_CONSTRAINTS : false,
      })
      .then(
        (media) => {
          if (!mountedRef.current) {
            media.getTracks().forEach((track) => track.stop());
            return null;
          }
          streamRef.current = media;
          setStream(media);
          setState({ status: 'ready' });
          return media;
        },
        (error: unknown) => {
          setState({ status: 'error', message: describeError(error, kind) });
          return null;
        },
      )
      .finally(() => {
        pendingRef.current = null;
      });
    return pendingRef.current;
  }, [kind]);

  const beginRecording = useCallback(
    (media: MediaStream) => {
      const recorder = recorderFor(media, kind);
      const done = collect(recorder);
      // Video: the voice separately, small and easy to decode for the transcription.
      const voiceRecorder =
        kind === 'video' && media.getAudioTracks().length > 0
          ? recorderFor(new MediaStream(media.getAudioTracks()), 'audio')
          : null;
      const voiceDone = voiceRecorder ? collect(voiceRecorder) : null;

      // Level meter: RMS of the microphone every 100 ms – live bars now, waveform later.
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      audioContext.createMediaStreamSource(media).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const allLevels: number[] = [];
      const startedAt = performance.now();
      const timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const level = Math.min(1, Math.sqrt(sum / samples.length) * 4);
        allLevels.push(level);
        setLevels(allLevels.slice(-LIVE_BARS));
        const elapsed = performance.now() - startedAt;
        setElapsedMs(elapsed);
        if (elapsed >= MAX_MEDIA_DURATION_MS) stopRef.current?.();
      }, LEVEL_INTERVAL_MS);

      const cleanup = () => {
        window.clearInterval(timer);
        void audioContext.close().catch(() => undefined);
      };
      cleanupRef.current = cleanup;

      stopRef.current = () => {
        stopRef.current = null;
        cleanup();
        cleanupRef.current = null;
        const durationMs = Math.min(
          Math.round(performance.now() - startedAt),
          MAX_MEDIA_DURATION_MS,
        );
        if (recorder.state !== 'inactive') recorder.stop();
        if (voiceRecorder && voiceRecorder.state !== 'inactive') voiceRecorder.stop();
        void (async () => {
          const raw = await done;
          const blob = await withDuration(raw, durationMs);
          const voice = voiceDone ? await voiceDone : blob;
          releaseStream();
          if (blob.size === 0) {
            setState({
              status: 'error',
              message: 'Die Aufnahme ist leer. Bitte erneut versuchen.',
            });
            return;
          }
          const url = URL.createObjectURL(blob);
          urlRef.current = url;
          setState({
            status: 'recorded',
            recording: {
              kind,
              blob,
              url,
              mimeType: blob.type,
              durationMs,
              peaks: downsamplePeaks(allLevels),
              transcriptionAudio: voice.size > 0 ? voice : blob,
            },
          });
        })();
      };

      recorder.start(1000);
      voiceRecorder?.start(1000);
      setLevels([]);
      setElapsedMs(0);
      setState({ status: 'recording' });
    },
    [kind, releaseStream],
  );

  const start = useCallback(async () => {
    if (!streamRef.current) setState({ status: 'requesting' });
    const media = await acquire();
    if (media) beginRecording(media);
  }, [acquire, beginRecording]);

  const stop = useCallback(() => stopRef.current?.(), []);

  /** Throws the recording away; video goes back to the camera preview. */
  const reset = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setLevels([]);
    setElapsedMs(0);
    setState({ status: kind === 'video' ? 'requesting' : 'idle' });
    if (kind === 'video') void acquire();
  }, [acquire, kind]);

  // Video shows the camera as soon as the tab opens; `autoStart` records right away. Leaving
  // (tab switch, cancel, sent) turns camera and microphone off, so nothing keeps recording.
  useEffect(() => {
    mountedRef.current = true;
    if (kind === 'video' || autoStart) {
      void acquire().then((media) => {
        if (media && autoStart && mountedRef.current) beginRecording(media);
      });
    }
    return () => {
      mountedRef.current = false;
      stopRef.current = null;
      cleanupRef.current?.();
      cleanupRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, [acquire, autoStart, beginRecording, kind]);

  return { state, stream, levels, elapsedMs, start, stop, reset };
}
