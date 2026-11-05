import { useEffect, useRef, useState } from 'react';
import {
  recordingFileName,
  startShowRecording,
  type ShowRecording,
  type ShowScene,
} from './lib/show-recorder';
import type { ShowClock } from './show-hooks';

/** A finished recording, ready to download. */
export interface RecordingFile {
  blob: Blob;
  url: string;
  fileName: string;
}

export type RecordingState = 'idle' | 'starting' | 'recording' | 'paused' | 'done';

/**
 * „Aufnehmen“ while presenting (`show-recorder.ts`): starting it starts the stopwatch, pausing it
 * pauses the stopwatch too, so the slides' times and the recording's run alike. `scene` is read
 * for every frame. Left without `complete`, a running recording is dropped.
 */
export function useShowRecording({
  clock,
  title,
  aspect,
  color,
  scene,
}: {
  clock: ShowClock;
  title: string;
  aspect: number;
  color: string;
  scene: { current: ShowScene };
}) {
  const [state, setState] = useState<RecordingState>('idle');
  const [failed, setFailed] = useState(false);
  const mounted = useRef(false);
  const starting = useRef(false);
  const recording = useRef<ShowRecording | null>(null);
  const file = useRef<Promise<RecordingFile | null> | null>(null);
  const [done, setDone] = useState<RecordingFile | null>(null);
  const [camera, setCamera] = useState<MediaStream | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recording.current?.dispose();
      recording.current = null;
      void file.current?.then((made) => {
        if (made) URL.revokeObjectURL(made.url);
      });
    };
  }, []);

  const stopNow = (): Promise<RecordingFile | null> => {
    const active = recording.current;
    if (!active) return file.current ?? Promise.resolve(null);
    recording.current = null;
    setCamera(null);
    const made = active.stop().then((blob) => ({
      blob,
      url: URL.createObjectURL(blob),
      fileName: recordingFileName(title, blob.type),
    }));
    file.current = made;
    setState('done');
    void made.then(setDone);
    return made;
  };

  return {
    state,
    complete: async () => (await stopNow())?.blob ?? null,
    failed,
    /** The camera while recording with it – the bubble's preview. */
    camera,
    /** The file once stopped (to download before the show ends). */
    file: done,
    start: async (camera: boolean) => {
      if (starting.current || recording.current) return;
      starting.current = true;
      setFailed(false);
      setState('starting');
      try {
        const made = await startShowRecording({
          camera,
          aspect,
          color,
          scene: () => scene.current,
        });
        if (!mounted.current) {
          made.dispose();
          return;
        }
        recording.current = made;
        setCamera(made.camera);
        if (!clock.running) clock.start();
        setState('recording');
      } catch {
        if (mounted.current) {
          setFailed(true);
          setState('idle');
        }
      } finally {
        starting.current = false;
      }
    },
    /** Pauses or resumes – the recording and the stopwatch together. */
    toggle: () => {
      const active = recording.current;
      if (!active) return;
      if (state === 'recording') {
        active.pause();
        if (clock.running) clock.toggle();
        setState('paused');
      } else {
        active.resume();
        if (!clock.running) clock.toggle();
        setState('recording');
      }
    },
    stop: () => void stopNow(),
  };
}
