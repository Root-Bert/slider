import { hitTestShapes, type VoiceSession } from '@slider/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api-client';
import { voiceApi } from '@/lib/api';
import { useOnline } from '@/lib/offline';
import { useEditing } from '../editing/editing-context';
import { useAskAi } from '../editing/hooks/useAskAi';
import { useAiThreads } from '../comments/hooks/useAiThreads';
import { useGoToSlide } from '../hooks/useGoToSlide';
import { locateCursor } from '../live/lib/cursor-anchor';
import { canRecord } from '../media/lib/recording';
import { describeError } from '../media/lib/recorder-errors';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { encodeClip } from './lib/clip';
import { placeOf, workingThreadAt, type PickedPlace } from './lib/ai-additions';
import { encodeWav, joinPieces, levelOf, peaksOf } from './lib/audio';
import { ContextTracker } from './lib/context-tracker';
import { pieceWords, type LiveCaption } from './lib/caption';
import { LiveTranscript } from './lib/live-transcript';
import { Segmenter } from './lib/segmenter';
import { openMicrophone, prepareMicrophone, type Microphone } from './lib/vad';
import { AiBoxContext, type PlaceAiBox } from './hooks/usePlaceAiBox';
import { VoiceContext, type VoiceState, type VoiceStatus } from './voice-context';

/** What was on screen is looked at this often. */
const SAMPLE_MS = 100;
/** Quiet this long, comments still being said are finished (the person thinks of the next). */
const FLUSH_AFTER_MS = 2_500;
/** The session is asked how its comments go this often while the AI works – else seldom. */
const POLL_BUSY_MS = 1_500;
const POLL_IDLE_MS = 6_000;
/** Pieces' sound kept for the comments' recordings, at most. */
const MAX_KEPT_PIECES = 400;

/** One listening, from the start to the panel closed. */
interface Run {
  /** Empty until the server has made the session (the microphone is not kept waiting for it). */
  sessionId: string;
  /** The session made – pieces said before that wait for it. */
  ready: Promise<string>;
  startedAt: number;
  mic: Microphone | null;
  segmenter: Segmenter;
  /** The words as they are spoken – `null` once it is unavailable. */
  live: LiveTranscript | null;
  /** Where in the live text each piece ended (`seq` → its length then). */
  liveMarks: Record<number, number>;
  tracker: ContextTracker;
  seq: number;
  pieces: Map<number, Float32Array>;
  inFlight: Set<Promise<unknown>>;
  commandsDone: Set<number>;
  recorded: Set<string>;
  pointer: { x: number; y: number } | null;
  timers: { sample?: number; flush?: number };
  stopped: boolean;
}

const BUSY_STATES = new Set(['draft', 'queued', 'working']);

/**
 * Speaking to the AI (its avatar, bottom right): listens while the person goes through the
 * slides, sends each piece of speech with what was on screen, and keeps the session the server
 * makes of it – the comments said, how the AI gets on with them – for the panel.
 */
export function VoiceProvider({ children }: { children: ReactNode }) {
  const { deck, slides, slideIndex, threads, viewer } = useViewerData();
  const { activeSlideId, draft } = useViewerState();
  const dispatch = useViewerDispatch();
  const ai = useAskAi();
  const { selection, select, elementsOf } = useEditing();
  const { working } = useAiThreads();
  const goToSlide = useGoToSlide();

  const [status, setStatus] = useState<VoiceStatus>('off');
  const [speaking, setSpeaking] = useState(false);
  const [sending, setSending] = useState(0);
  const [session, setSession] = useState<VoiceSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** What the live stream heard so far – `null` without one (the pieces' text is shown then). */
  const [live, setLive] = useState<LiveCaption | null>(null);

  // What callbacks need of the latest render.
  const latest = useRef({ activeSlideId, slides, slideIndex, selection, goToSlide, session });
  useEffect(() => {
    latest.current = { activeSlideId, slides, slideIndex, selection, goToSlide, session };
  });

  const run = useRef<Run | null>(null);
  // A box for the AI is open: what is said meanwhile is its own – no pieces go to the session.
  const boxOpen = useRef(false);
  const boxCount = useRef(0);
  const stopRef = useRef<() => void>(() => {});

  // The level meter: read per frame, told to its listeners once per paint.
  const levelValue = useRef(0);
  const levelListeners = useRef(new Set<() => void>());
  const levelFrame = useRef<number | null>(null);
  const setLevel = useCallback((value: number) => {
    levelValue.current = value;
    if (levelFrame.current !== null) return;
    levelFrame.current = requestAnimationFrame(() => {
      levelFrame.current = null;
      for (const listener of levelListeners.current) listener();
    });
  }, []);

  /** An answer of the server: the session as it is, its commands done, recordings made. */
  const apply = useCallback((next: VoiceSession) => {
    const current = run.current;
    if (!current || current.sessionId !== next.id) return;
    setSession(next);
    for (const { id, command } of next.commands) {
      if (current.commandsDone.has(id)) continue;
      current.commandsDone.add(id);
      if (command.type === 'goToSlide') {
        const index = latest.current.slideIndex.get(command.slideId);
        if (index !== undefined) latest.current.goToSlide(index);
      } else if (command.type === 'stop') {
        stopRef.current();
      }
    }
    for (const item of next.items) {
      if (item.state === 'draft' || item.state === 'dropped' || item.hasRecording) continue;
      if (current.recorded.has(item.commentId)) continue;
      const pieces = item.segments.map((seq) => current.pieces.get(seq));
      if (pieces.length === 0 || pieces.some((piece) => !piece)) continue;
      current.recorded.add(item.commentId);
      const audio = joinPieces(pieces as Float32Array[]);
      void encodeClip(audio)
        .then((clip) =>
          clip
            ? voiceApi.recording(
                next.id,
                item.commentId,
                { durationMs: Math.max(1, Math.round(audio.length / 16)), peaks: peaksOf(audio) },
                clip.blob,
              )
            : null,
        )
        // Without its recording the comment keeps its text – nothing to tell.
        .catch(() => undefined);
    }
  }, []);

  /** Comments still being said are finished – after a while of quiet. */
  const scheduleFlush = useCallback(() => {
    const current = run.current;
    if (!current || current.stopped) return;
    window.clearTimeout(current.timers.flush);
    current.timers.flush = window.setTimeout(() => {
      if (run.current !== current || current.segmenter.speaking) return;
      const drafts = latest.current.session?.items.some((item) => item.state === 'draft');
      if (!drafts || current.inFlight.size > 0) return;
      void voiceApi
        .flush(current.sessionId)
        .then(apply)
        .catch(() => undefined);
    }, FLUSH_AFTER_MS);
  }, [apply]);

  /** A piece of speech to the server, with what was on screen while it was said. */
  const send = useCallback(
    (audio: Float32Array, startMs: number, endMs: number) => {
      const current = run.current;
      if (!current) return;
      const seq = current.seq;
      current.seq += 1;
      if (boxOpen.current && current.live) {
        // Said to a box for the AI (its field takes the live words): only its place in the live
        // words is kept, so the next piece's words do not begin with it. Without live words what
        // is said goes on as ever.
        current.liveMarks = { ...current.liveMarks, [seq]: current.live.heard.length };
        return;
      }
      current.pieces.set(seq, audio);
      if (current.pieces.size > MAX_KEPT_PIECES) {
        current.pieces.delete(current.pieces.keys().next().value!);
      }
      const go = () => {
        // Where the live words stand as the piece ends: up to here, its accurate text replaces them.
        if (current.live) {
          current.liveMarks = { ...current.liveMarks, [seq]: current.live.heard.length };
          setLive({ text: current.live.heard, marks: current.liveMarks });
        }
        // The live words of the piece: the server decides on them at once, not after its accurate
        // text (speech to text takes a second – on the server's own CPU several).
        const liveText = current.live
          ? pieceWords(current.live.heard, current.liveMarks, seq).slice(0, 5_000)
          : '';
        const meta = {
          seq,
          startMs: Math.round(startMs),
          endMs: Math.max(Math.round(startMs), Math.round(endMs)),
          context: current.tracker.summarize(startMs, endMs),
          ...(/[\p{L}\p{N}]/u.test(liveText) ? { liveText } : {}),
        };
        const wav = new Blob([encodeWav(audio)], { type: 'audio/wav' });
        const post = (sessionId: string): Promise<VoiceSession> =>
          voiceApi.segment(sessionId, meta, wav).catch(async (failure: unknown) => {
            // The server forgot the session (it restarted): a new one takes the piece.
            if (failure instanceof ApiError && failure.status === 404 && run.current === current) {
              const fresh = await voiceApi.start(deck.id);
              current.sessionId = fresh.id;
              current.commandsDone.clear();
              return voiceApi.segment(fresh.id, meta, wav);
            }
            throw failure;
          });
        setSending((count) => count + 1);
        const request = current.ready
          .then(() => post(current.sessionId))
          .then(apply)
          .catch((failure: unknown) => {
            // A session that could not be made says so itself (`start`).
            if (run.current !== current) return;
            setError(
              failure instanceof ApiError ? failure.message : 'Ein Stück wurde nicht verstanden.',
            );
          })
          .finally(() => {
            current.inFlight.delete(request);
            setSending((count) => count - 1);
            scheduleFlush();
          });
        current.inFlight.add(request);
        return request;
      };
      // The live words of its last moments may still be on their way: a moment for them (mostly
      // none – the stream was quiet through the pause that ended the piece).
      // Waiting counts as on its way: the end waits for it, the pause does not finish meanwhile.
      const settling = current.stopped ? 0 : (current.live?.settlingMs() ?? 0);
      if (settling <= 0) {
        go();
        return;
      }
      const waiting: Promise<unknown> = new Promise((resolve) => {
        window.setTimeout(() => {
          current.inFlight.delete(waiting);
          resolve(go());
        }, settling);
      });
      current.inFlight.add(waiting);
    },
    [apply, deck.id, scheduleFlush],
  );

  /** What was on screen, a few times a second: the slide in front, the pointer, the pick. */
  const sample = useCallback(() => {
    const current = run.current;
    if (!current) return;
    const { activeSlideId: active, slides: all, selection: picked } = latest.current;
    let pointer = null;
    if (current.pointer) {
      const { x, y } = current.pointer;
      const cursor = locateCursor(document.elementFromPoint(x, y), x, y);
      if (cursor) {
        const slide = all.find((candidate) => candidate.id === cursor.slideId);
        const shape = slide ? hitTestShapes(slide.shapes, cursor.point, slide.aspectRatio) : null;
        pointer = { slideId: cursor.slideId, point: cursor.point, shapeId: shape?.id ?? null };
      }
    }
    current.tracker.add({
      atMs: performance.now() - current.startedAt,
      activeSlideId: active,
      pointer,
      selection: picked ? { slideId: picked.slideId, elementId: picked.elementId } : null,
    });
  }, []);

  const start = useCallback(async () => {
    if (run.current && !run.current.stopped) return;
    if (!canRecord()) {
      setError('Dieser Browser kann nicht aufnehmen (nur über HTTPS möglich).');
      return;
    }
    setError(null);
    setSession(null);
    setLive(null);
    setStatus('starting');
    // The session and the microphone side by side: listening starts as soon as the microphone
    // hears, what is said before the server answers waits for the session.
    const starting = voiceApi.start(deck.id);
    const current: Run = {
      sessionId: '',
      ready: starting.then((started) => {
        if (!current.sessionId) current.sessionId = started.id;
        if (run.current === current) setSession(started);
        return started.id;
      }),
      startedAt: performance.now(),
      mic: null,
      segmenter: new Segmenter(
        (piece) => send(piece.audio, piece.startMs, piece.endMs),
        (now) => {
          setSpeaking(now);
          if (now) window.clearTimeout(run.current?.timers.flush);
          else scheduleFlush();
        },
      ),
      live: null,
      liveMarks: {},
      tracker: new ContextTracker(),
      seq: 0,
      pieces: new Map(),
      inFlight: new Set(),
      commandsDone: new Set(),
      recorded: new Set(),
      pointer: null,
      timers: {},
      stopped: false,
    };
    run.current = current;
    /** Could not start: back to off, with why. */
    const fail = (message: string) => {
      if (run.current !== current) return;
      current.stopped = true;
      window.clearInterval(current.timers.sample);
      current.live?.stop();
      void current.mic?.destroy().catch(() => undefined);
      run.current = null;
      setStatus('off');
      setSession(null);
      setSpeaking(false);
      setLevel(0);
      setError(message);
    };
    current.ready.catch((failure: unknown) =>
      fail(failure instanceof ApiError ? failure.message : 'Sprechen ließ sich nicht starten.'),
    );
    current.live = new LiveTranscript(
      async () => voiceApi.live(await current.ready.then(() => current.sessionId)),
      (text) => {
        if (run.current === current) setLive({ text, marks: current.liveMarks });
      },
      () => {
        if (run.current !== current) return;
        current.live = null;
        setLive(null);
      },
    );
    current.live.start();
    sample();
    current.timers.sample = window.setInterval(sample, SAMPLE_MS);
    let mic: Microphone;
    try {
      mic = await openMicrophone((frame, probability) => {
        if (run.current !== current || current.stopped) return;
        setLevel(levelOf(frame));
        current.live?.push(frame);
        current.segmenter.push(frame, probability, performance.now() - current.startedAt);
      });
    } catch (failure) {
      fail(
        failure instanceof DOMException
          ? describeError(failure, 'audio')
          : 'Das Mikrofon ließ sich nicht starten.',
      );
      void starting.then((started) => voiceApi.end(started.id)).catch(() => undefined);
      return;
    }
    if (run.current !== current || current.stopped) {
      // Closed, ended or failed meanwhile.
      void mic.destroy().catch(() => undefined);
      return;
    }
    current.mic = mic;
    setStatus('listening');
  }, [deck.id, sample, scheduleFlush, send, setLevel]);

  const stop = useCallback(async () => {
    const current = run.current;
    if (!current || current.stopped) return;
    current.stopped = true;
    setStatus('ending');
    window.clearInterval(current.timers.sample);
    window.clearTimeout(current.timers.flush);
    // What is being said is sent before the end.
    current.segmenter.flush();
    current.live?.stop();
    setSpeaking(false);
    setLevel(0);
    await current.mic?.destroy().catch(() => undefined);
    current.mic = null;
    await Promise.allSettled([...current.inFlight]);
    try {
      await current.ready;
      apply(await voiceApi.end(current.sessionId));
    } catch {
      // Gone already: what it said is in the comments.
    }
    if (run.current === current) setStatus('ended');
  }, [apply, setLevel]);
  useEffect(() => {
    stopRef.current = () => void stop();
  }, [stop]);

  const pause = useCallback(() => {
    const current = run.current;
    if (!current?.mic || current.stopped) return;
    current.segmenter.flush();
    current.live?.flush();
    setSpeaking(false);
    setLevel(0);
    void current.mic.pause();
    setStatus('paused');
  }, [setLevel]);

  const resume = useCallback(() => {
    const current = run.current;
    if (!current?.mic || current.stopped) return;
    void current.mic.resume();
    setStatus('listening');
  }, []);

  const dismiss = useCallback(() => {
    if (run.current && !run.current.stopped) return;
    run.current = null;
    setSession(null);
    setError(null);
    setLive(null);
    setStatus('off');
  }, []);

  const toggle = useCallback(() => {
    if (status === 'off' || status === 'ended') void start();
    else if (status === 'listening' || status === 'paused') void stop();
  }, [start, status, stop]);

  // The pause detector is loaded ahead whenever speaking is possible and off: a click on the
  // microphone then only opens it (loading it at the click took seconds). Not offline: its files
  // are not kept by the service worker (some 16 MB, and the AI needs the server anyway) – loaded
  // once the connection is back.
  const canSpeak = !!deck.ai?.available;
  const idle = status === 'off' || status === 'ended';
  const online = useOnline();
  useEffect(() => {
    if (!canSpeak || !idle || !online || !canRecord()) return;
    const prepare = () => void prepareMicrophone().catch(() => undefined);
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(prepare, { timeout: 3_000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(prepare, 1_000);
    return () => window.clearTimeout(timer);
  }, [canSpeak, idle, online]);

  // A box for the AI open: what was being said goes on as before, what is said from now on is
  // the box's – up to its close (sent, dropped), where the piece being said is cut again.
  const aiBox = draft?.aiBox;
  useEffect(() => {
    if (aiBox === undefined) return;
    run.current?.segmenter.flush();
    boxOpen.current = true;
    return () => {
      run.current?.segmenter.flush();
      boxOpen.current = false;
    };
  }, [aiBox]);

  // The pointer, for what was on screen (over a slide only, see `locateCursor`).
  useEffect(() => {
    if (status === 'off') return;
    const onMove = (event: PointerEvent) => {
      if (run.current) run.current.pointer = { x: event.clientX, y: event.clientY };
    };
    const onLeave = () => {
      if (run.current) run.current.pointer = null;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, [status]);

  // How the comments get on: asked often while the AI works on them, seldom else.
  useEffect(() => {
    if (!session || status === 'off') return;
    const busy = session.pending > 0 || session.items.some((item) => BUSY_STATES.has(item.state));
    if (status === 'ended' && !busy) return;
    const timer = window.setTimeout(
      () => {
        const current = run.current;
        if (!current) return;
        void voiceApi
          .get(current.sessionId)
          .then(apply)
          .catch(() => undefined);
      },
      busy ? POLL_BUSY_MS : POLL_IDLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [apply, session, status]);

  // Leaving the deck ends it.
  useEffect(
    () => () => {
      const current = run.current;
      run.current = null;
      if (!current) return;
      window.clearInterval(current.timers.sample);
      window.clearTimeout(current.timers.flush);
      current.live?.stop();
      void current.mic?.destroy().catch(() => undefined);
      if (!current.stopped) {
        void current.ready.then(() => voiceApi.end(current.sessionId)).catch(() => undefined);
      }
    },
    [],
  );

  // Listening (or held), with the AI there to ask: a box drawn goes to it. A box still open with
  // words in it is sent as it gives way (`AiBoxComposer`). Drawn (or a pin clicked, an element
  // picked) again where one's own request is still at work, the box adds to that one.
  const aiBoxes =
    ai.available && (status === 'starting' || status === 'listening' || status === 'paused');
  const places = useRef({ threads, working, authorId: viewer.author.id, draft });
  useEffect(() => {
    places.current = { threads, working, authorId: viewer.author.id, draft };
  });
  const placeAiBox = useMemo<PlaceAiBox | null>(() => {
    if (!aiBoxes) return null;
    const open = (slideId: string, anchor: Parameters<PlaceAiBox>[1], aiThreadId?: string) => {
      boxCount.current += 1;
      dispatch({ type: 'activeSlideChanged', slideId });
      dispatch({
        type: 'anchorPlaced',
        slideId,
        anchor,
        aiBox: boxCount.current,
        ...(aiThreadId ? { aiThreadId } : {}),
      });
    };
    /** The request still at work there – its own thread (`threadId`) or the one at the place. */
    const runningAt = (place: PickedPlace | null, threadId?: string) => {
      const { threads: all, working: busy, authorId, draft: open } = places.current;
      const thread = threadId
        ? all.find(
            (each) => each.id === threadId && busy.has(each.id) && each.root.author.id === authorId,
          )
        : place && workingThreadAt(all, busy, authorId, place);
      // Its field open already: stays as it is.
      if (!thread || open?.aiThreadId === thread.id) return thread ? 'open' : null;
      return thread;
    };
    return (slideId, anchor, threadId) => {
      const thread = runningAt(placeOf(slideId, anchor), threadId);
      if (thread === 'open') return true;
      if (thread) {
        open(thread.root.slideId ?? slideId, thread.root.anchor, thread.id);
        return true;
      }
      if (threadId) return false;
      open(slideId, anchor);
      return true;
    };
  }, [aiBoxes, dispatch]);

  // An element picked again while one's own request on it is at work: its field opens to add to it.
  const picked = selection ? `${selection.slideId}\u0000${selection.elementId}` : null;
  useEffect(() => {
    if (!placeAiBox || !picked) return;
    const [slideId, elementId] = picked.split('\u0000') as [string, string];
    const element = elementsOf(slideId).find((each) => each.id === elementId);
    if (!element) return;
    const { threads: all, working: busy, authorId } = places.current;
    const thread = workingThreadAt(all, busy, authorId, {
      slideId,
      rect: element.bbox,
      shapeId: element.id,
    });
    if (!thread) return;
    // As a frame drawn for the AI (`useInsertFrame`): its field, not the element's panels.
    select(null);
    placeAiBox(slideId, thread.root.anchor, thread.id);
    // Only when picked – not again as the element or the requests change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, placeAiBox]);
  const value = useMemo<VoiceState>(
    () => ({
      heard: () => run.current?.live?.heard ?? '',
      status,
      speaking,
      sending,
      session,
      error,
      live,
      toggle,
      pause,
      resume,
      stop: () => void stop(),
      dismiss,
      level: () => levelValue.current,
      subscribeLevel: (listener) => {
        levelListeners.current.add(listener);
        return () => levelListeners.current.delete(listener);
      },
    }),
    [dismiss, error, live, pause, resume, sending, session, speaking, status, stop, toggle],
  );

  return (
    <VoiceContext value={value}>
      <AiBoxContext value={placeAiBox}>{children}</AiBoxContext>
    </VoiceContext>
  );
}
