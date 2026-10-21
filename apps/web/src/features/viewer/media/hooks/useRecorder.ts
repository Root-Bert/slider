import { MAX_MEDIA_DURATION_MS, type MediaKind } from '@slider/shared';
import fixWebmDuration from 'fix-webm-duration';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AUDIO_CONSTRAINTS,
  canRecord,
  downsamplePeaks,
  pickRecorderFormat,
  RECORDER_BITRATES,
  SCREEN_BITRATES,
  SCREEN_CONSTRAINTS,
  VIDEO_CONSTRAINTS,
  type VideoSource,
} from '../lib/recording';
import { describeError, describeScreenError } from '../lib/recorder-errors';
import { composeScreenAndCamera } from '../lib/screen-compositor';

/** A finished recording, ready to send. */
export interface Recording {
  kind: MediaKind;
  blob: Blob;
  /** Object URL of `blob` for the preview; revoked when the recorder resets or unmounts. */
  url: string;
  mimeType: string;
  durationMs: number;
  peaks: number[];
}

export type RecorderState =
  | { status: 'idle' }
  | { status: 'requesting' }
  /** Video: the camera preview runs, recording has not started. */
  | { status: 'ready' }
  | { status: 'recording' }
  /** Recording, held by the user; resumes into the same recording. */
  | { status: 'paused' }
  | { status: 'recorded'; recording: Recording }
  | { status: 'error'; message: string };

const LEVEL_INTERVAL_MS = 100;
/** Bars of the live meter while recording. */
const LIVE_BARS = 40;

function recorderFor(
  stream: MediaStream,
  kind: MediaKind,
  bitrates: MediaRecorderOptions = RECORDER_BITRATES[kind],
): MediaRecorder {
  const mimeType = pickRecorderFormat(kind, (type) => MediaRecorder.isTypeSupported(type));
  return new MediaRecorder(stream, { ...(mimeType && { mimeType }), ...bitrates });
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
 * meter, pauses and resumes, stops by itself after five minutes. Video opens the camera right away for a preview.
 *
 * Video can show the shared screen instead (`source: 'screen'`) or the screen with the camera as
 * a bubble in the corner (`'both'`). The browser only lets a click share a screen, so that is
 * asked for when recording starts; ending the share in the browser ends the recording.
 */
export function useRecorder(
  kind: MediaKind,
  { autoStart = false, source = 'camera' }: { autoStart?: boolean; source?: VideoSource } = {},
) {
  const screenSource = kind === 'video' && source !== 'camera';
  // Camera (alone or as the bubble) opens right away for the preview; the screen alone waits.
  const previewsCamera = kind === 'video' && source !== 'screen';
  const [state, setState] = useState<RecorderState>(() =>
    !canRecord()
      ? {
          status: 'error',
          message: 'Aufnehmen geht nur über https (oder localhost) in einem aktuellen Browser.',
        }
      : previewsCamera || autoStart
        ? { status: 'requesting' }
        : { status: 'idle' },
  );
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [levels, setLevels] = useState<number[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const urlRef = useRef<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const pauseRef = useRef<((paused: boolean) => void) | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const pendingRef = useRef<Promise<MediaStream | null> | null>(null);
  /** The shared screen and the compositor of one recording – stopped with it. */
  const screenRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(false);

  const releaseScreen = useCallback(() => {
    screenRef.current?.();
    screenRef.current = null;
  }, []);

  const releaseStream = useCallback(() => {
    releaseScreen();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
  }, [releaseScreen]);

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
        video: kind === 'video' && source !== 'screen' ? VIDEO_CONSTRAINTS : false,
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
          // Sharing the screen only needs the microphone from getUserMedia.
          const device = kind === 'video' && source === 'screen' ? 'audio' : kind;
          setState({ status: 'error', message: describeError(error, device) });
          return null;
        },
      )
      .finally(() => {
        pendingRef.current = null;
      });
    return pendingRef.current;
  }, [kind, source]);

  /**
   * Screen sources: the stream to record – the shared screen (or screen + camera bubble) with
   * the microphone. Asks for the screen first, while the click still counts as one.
   */
  const acquireScreen = useCallback(async (): Promise<MediaStream | null> => {
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia(SCREEN_CONSTRAINTS);
    } catch (error) {
      const message = describeScreenError(error);
      setState(
        message ? { status: 'error', message } : { status: streamRef.current ? 'ready' : 'idle' },
      );
      return null;
    }
    const stopDisplay = () => display.getTracks().forEach((track) => track.stop());
    // "Freigabe beenden" in the browser ends the recording, too (with the bubble, the recorded
    // track is the canvas's – only the screen's own track ends).
    display
      .getVideoTracks()[0]
      ?.addEventListener('ended', () => stopRef.current?.(), { once: true });
    const base = await acquire();
    if (!base || !mountedRef.current) {
      stopDisplay();
      return null;
    }
    let composed: ReturnType<typeof composeScreenAndCamera> | null = null;
    try {
      composed = source === 'both' ? composeScreenAndCamera(display, base) : null;
    } catch {
      stopDisplay();
      setState({ status: 'error', message: 'Bildschirm teilen ist fehlgeschlagen.' });
      return null;
    }
    screenRef.current = () => {
      composed?.dispose();
      stopDisplay();
    };
    const picture = composed ? composed.stream : display;
    const media = new MediaStream([...picture.getVideoTracks(), ...base.getAudioTracks()]);
    setStream(media);
    return media;
  }, [acquire, source]);

  const beginRecording = useCallback(
    (media: MediaStream) => {
      const recorder = recorderFor(media, kind, screenSource ? SCREEN_BITRATES : undefined);
      const done = collect(recorder);

      // Level meter: RMS of the microphone every 100 ms – live bars now, waveform later.
      const audioContext = new AudioContext();
      // Created after awaiting the microphone (`autoStart`), i.e. outside the click: Safari may
      // start it suspended – the meter would stay flat. Best effort; recording works regardless.
      audioContext.resume().catch(() => undefined);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      audioContext.createMediaStreamSource(media).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const allLevels: number[] = [];
      const startedAt = performance.now();
      // Time spent paused does not count – neither towards the length nor the limit.
      let pausedMs = 0;
      let pausedAt: number | null = null;
      const elapsedNow = () =>
        performance.now() -
        startedAt -
        pausedMs -
        (pausedAt === null ? 0 : performance.now() - pausedAt);
      const reachedLimit = () => elapsedNow() >= MAX_MEDIA_DURATION_MS;
      // Background tabs throttle timers; the recorder's one-second chunks still arrive, so the
      // five-minute limit is checked there too.
      recorder.addEventListener('dataavailable', () => {
        if (reachedLimit()) stopRecording();
      });
      const timer = window.setInterval(() => {
        if (pausedAt !== null) return;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const level = Math.min(1, Math.sqrt(sum / samples.length) * 4);
        allLevels.push(level);
        setLevels(allLevels.slice(-LIVE_BARS));
        const elapsed = elapsedNow();
        setElapsedMs(elapsed);
        if (elapsed >= MAX_MEDIA_DURATION_MS) stopRecording();
      }, LEVEL_INTERVAL_MS);

      const cleanup = () => {
        window.clearInterval(timer);
        void audioContext.close().catch(() => undefined);
      };
      cleanupRef.current = cleanup;

      let stopped = false;
      function stopRecording() {
        if (stopped) return;
        stopped = true;
        if (stopRef.current === stopRecording) stopRef.current = null;
        if (pauseRef.current === setPaused) pauseRef.current = null;
        cleanup();
        if (cleanupRef.current === cleanup) cleanupRef.current = null;
        // The real length – the limit may be overshot by up to a chunk; the server allows that.
        const durationMs = Math.round(elapsedNow());
        if (recorder.state !== 'inactive') recorder.stop();
        void (async () => {
          const raw = await done;
          releaseScreen();
          const blob = await withDuration(raw, durationMs);
          // Unmounted meanwhile (sent, cancelled): no object URL nobody would revoke.
          if (!mountedRef.current) return;
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
            },
          });
        })();
      }
      stopRef.current = stopRecording;

      function setPaused(paused: boolean) {
        if (stopped || paused === (pausedAt !== null)) return;
        if (paused) {
          pausedAt = performance.now();
          recorder.pause();
        } else {
          pausedMs += performance.now() - (pausedAt ?? performance.now());
          pausedAt = null;
          recorder.resume();
        }
        setState({ status: paused ? 'paused' : 'recording' });
      }
      pauseRef.current = setPaused;

      recorder.start(1000);
      setLevels([]);
      setElapsedMs(0);
      setState({ status: 'recording' });
    },
    [kind, releaseScreen, releaseStream, screenSource],
  );

  /** A recorder that won't start (format not supported, a device gone) shows an error. */
  const record = useCallback(
    (media: MediaStream) => {
      try {
        beginRecording(media);
      } catch (error) {
        stopRef.current = null;
        pauseRef.current = null;
        cleanupRef.current?.();
        cleanupRef.current = null;
        releaseStream();
        setState({ status: 'error', message: describeError(error, kind) });
      }
    },
    [beginRecording, kind, releaseStream],
  );

  const start = useCallback(async () => {
    if (!streamRef.current || screenSource) setState({ status: 'requesting' });
    const media = await (screenSource ? acquireScreen() : acquire());
    if (media) record(media);
  }, [acquire, acquireScreen, record, screenSource]);

  const stop = useCallback(() => stopRef.current?.(), []);
  const pause = useCallback(() => pauseRef.current?.(true), []);
  const resume = useCallback(() => pauseRef.current?.(false), []);

  /** Throws the recording away; video goes back to the camera preview. */
  const reset = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setLevels([]);
    setElapsedMs(0);
    releaseScreen();
    setState({ status: previewsCamera ? 'requesting' : 'idle' });
    if (previewsCamera) void acquire();
  }, [acquire, previewsCamera, releaseScreen]);

  // Video shows the camera as soon as the tab opens; `autoStart` records right away. Leaving
  // (tab switch, cancel, sent) turns camera and microphone off, so nothing keeps recording.
  useEffect(() => {
    mountedRef.current = true;
    // Per run: under StrictMode the effect runs twice and both runs share one pending request.
    let cancelled = false;
    if (previewsCamera || (autoStart && !screenSource)) {
      void acquire().then((media) => {
        if (media && autoStart && !cancelled) record(media);
      });
    }
    return () => {
      cancelled = true;
      mountedRef.current = false;
      stopRef.current = null;
      pauseRef.current = null;
      cleanupRef.current?.();
      cleanupRef.current = null;
      screenRef.current?.();
      screenRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, [acquire, autoStart, previewsCamera, record, screenSource]);

  return { state, stream, levels, elapsedMs, start, stop, pause, resume, reset };
}
