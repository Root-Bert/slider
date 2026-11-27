import {
  aiAuthor,
  writerText,
  type Author,
  type DocumentVoiceContext,
  type DocumentVoiceInfo,
  type DocumentVoiceItem,
  type DocumentVoiceSegmentMeta,
  type DocumentVoiceSession,
} from '@slider/shared';
import { useQuery } from '@tanstack/react-query';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ringColor } from '@/lib/accent';
import { ApiError } from '@/lib/api-client';
import { voiceApi } from '@/lib/api';
import { useOnline } from '@/lib/offline';
import {
  canRecord,
  describeError,
  encodeWav,
  levelOf,
  LiveTranscript,
  openMicrophone,
  pieceWords,
  prepareMicrophone,
  Segmenter,
  VoiceBarView,
  VoiceContext,
  type LiveCaption,
  type Microphone,
  type VoiceState,
  type VoiceStatus,
} from '@/features/viewer';
import { useWriter } from '../editor/session';
import { isCollapsed, lengthOf, ordered, paragraphOf } from '../lib/model';

/** What was on screen is looked at this often. */
const SAMPLE_MS = 250;
/** Quiet this long, comments still being said are finished (the person thinks of the next). */
const FLUSH_AFTER_MS = 2_500;
/** The session is asked how its comments go this often while the AI works – else seldom. */
const POLL_BUSY_MS = 1_500;
const POLL_IDLE_MS = 6_000;
/** What was on screen is kept this long, and counts from a moment before a piece to one after. */
const KEPT_MS = 3 * 60_000;
const LEAD_MS = 600;
const TRAIL_MS = 300;

type Selection = DocumentVoiceContext['selection'];

/** What was on screen at one moment: the paragraphs in the window, the pointer's, the pick. */
interface Sample {
  atMs: number;
  paragraphs: string[];
  pointer: string | null;
  selection: Selection;
}

/** What was on screen while a piece was said (`ContextTracker` is the same for slides). */
function summarize(samples: readonly Sample[], startMs: number, endMs: number) {
  const during = samples.filter(
    (sample) => sample.atMs >= startMs - LEAD_MS && sample.atMs <= endMs + TRAIL_MS,
  );
  // A piece shorter than the time between two looks: the look before it.
  const seen = during.length > 0 ? during : samples.slice(-1);
  const shown = new Map<string, number>();
  const pointed = new Map<string, number>();
  for (const sample of seen) {
    for (const id of sample.paragraphs) shown.set(id, (shown.get(id) ?? 0) + SAMPLE_MS);
    if (sample.pointer) pointed.set(sample.pointer, (pointed.get(sample.pointer) ?? 0) + SAMPLE_MS);
  }
  const longestFirst = (times: Map<string, number>, most: number) =>
    [...times]
      .map(([paragraphId, ms]) => ({ paragraphId, ms: Math.min(ms, 600_000) }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, most);
  const context: DocumentVoiceContext = {
    paragraphs: longestFirst(shown, 120),
    pointer: longestFirst(pointed, 20),
    selection: seen.findLast((sample) => sample.selection)?.selection ?? null,
  };
  return context;
}

/** One listening, from the start to the bar closed. */
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
  samples: Sample[];
  seq: number;
  inFlight: Set<Promise<unknown>>;
  commandsDone: Set<number>;
  pointer: { x: number; y: number } | null;
  timers: { sample?: number; flush?: number };
  stopped: boolean;
}

const BUSY_STATES = new Set(['draft', 'queued', 'working']);

/** What a document shows, for speaking to its AI: Writer's sheets or a page (`features/pages`). */
export interface DocumentVoiceLook {
  /** What is on screen now: the paragraphs in the window, the one under the pointer, the pick. */
  sample: (pointer: { x: number; y: number } | null) => Omit<Sample, 'atMs'>;
  /** A paragraph brought into the window („geh zum Fazit“). */
  show: (paragraphId: string) => void;
}

/** What Writer's tools need of speaking to the AI besides the session (`VoiceContext`). */
interface WriterVoice {
  /** The document's AI, as an author. */
  ai: Author;
  /** There is an AI to speak to and the person may comment here. */
  available: boolean;
  open: (item: DocumentVoiceItem) => void;
}

const WriterVoiceContext = createContext<WriterVoice | null>(null);

/** Speaking to the AI in this document – `null` outside of one. */
export const useWriterVoice = (): WriterVoice | null => use(WriterVoiceContext);

/**
 * Speaking to the AI in a text document, as `VoiceProvider` does on a presentation (the same
 * `VoiceContext`, so the same bar): listens while the person goes through the text, sends each
 * piece of speech with the paragraphs that were in the window, where the pointer rested and what
 * was picked, and keeps the session the server makes of it. `onOpen`: a comment of the bar's list
 * was clicked.
 */
export function WriterVoiceProvider({
  onOpen,
  children,
}: {
  onOpen: (item: DocumentVoiceItem) => void;
  children: ReactNode;
}) {
  const { engine, document: file } = useWriter();
  const look = useMemo<DocumentVoiceLook>(
    () => ({
      sample: (at) => {
        const stage = document.querySelector<HTMLElement>('.writer-stage');
        if (!stage) return { paragraphs: [], pointer: null, selection: null };
        const frame = stage.getBoundingClientRect();
        const paragraphs: string[] = [];
        for (const element of stage.querySelectorAll<HTMLElement>('[data-p]')) {
          const id = element.dataset.id;
          if (!id) continue;
          const rect = element.getBoundingClientRect();
          if (rect.bottom > frame.top && rect.top < frame.bottom && rect.height > 0) {
            paragraphs.push(id);
          }
        }
        let pointer: string | null = null;
        if (at) {
          const under = document.elementFromPoint(at.x, at.y);
          const paragraph = under?.closest<HTMLElement>('[data-p]');
          if (paragraph && stage.contains(paragraph)) pointer = paragraph.dataset.id ?? null;
        }
        const { blocks, sel } = engine.getState();
        let selection: Selection = null;
        if (sel) {
          const { from, to } = ordered(blocks, sel);
          const block = paragraphOf(blocks, from.id);
          if (block) {
            // Words picked through several paragraphs: those of the first.
            const end = isCollapsed(sel) || to.id === from.id ? to.offset : lengthOf(block);
            selection = {
              paragraphId: block.id,
              start: from.offset,
              end: Math.max(from.offset, end),
              text: writerText(block).slice(from.offset, end).slice(0, 600),
            };
          }
        }
        return { paragraphs, pointer, selection };
      },
      show: (paragraphId) => {
        const at = { id: paragraphId, offset: 0 };
        engine.showRange(at, at);
      },
    }),
    [engine],
  );
  return (
    <DocumentVoiceProvider
      documentId={file.id}
      mayComment={file.permissions.canComment}
      look={look}
      onOpen={onOpen}
    >
      {children}
    </DocumentVoiceProvider>
  );
}

/**
 * Speaking to the AI in a text document – Writer's or a page's –, as `VoiceProvider` does on a
 * presentation (the same `VoiceContext`, so the same bar). `look` is what the document shows.
 */
export function DocumentVoiceProvider({
  documentId,
  mayComment,
  look,
  onOpen,
  children,
}: {
  documentId: string;
  mayComment: boolean;
  look: DocumentVoiceLook;
  onOpen: (item: DocumentVoiceItem) => void;
  children: ReactNode;
}) {
  const online = useOnline();
  const info = useQuery<DocumentVoiceInfo>({
    queryKey: ['document-voice', documentId],
    queryFn: () => voiceApi.document.info(documentId),
    enabled: mayComment,
    staleTime: 60_000,
  });

  const [status, setStatus] = useState<VoiceStatus>('off');
  const [speaking, setSpeaking] = useState(false);
  const [sending, setSending] = useState(0);
  const [session, setSession] = useState<DocumentVoiceSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** What the live stream heard so far – `null` without one (the pieces' text is shown then). */
  const [live, setLive] = useState<LiveCaption | null>(null);

  // What callbacks need of the latest render.
  const latest = useRef({ session, onOpen, look });
  useEffect(() => {
    latest.current = { session, onOpen, look };
  });

  const run = useRef<Run | null>(null);
  const claims = useRef({ open: 0, strict: 0 });
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

  /** An answer of the server: the session as it is, its commands done. */
  const apply = useCallback((next: DocumentVoiceSession) => {
    const current = run.current;
    if (!current || current.sessionId !== next.id) return;
    setSession(next);
    for (const { id, command } of next.commands) {
      if (current.commandsDone.has(id)) continue;
      current.commandsDone.add(id);
      if (command.type === 'scrollTo') latest.current.look.show(command.paragraphId);
      else stopRef.current();
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
      void voiceApi.document
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
      if (claims.current.open > 0 && (current.live || claims.current.strict > 0)) {
        // Said to a field that takes the live words: only its place in them is kept.
        if (current.live) {
          current.liveMarks = { ...current.liveMarks, [seq]: current.live.heard.length };
        }
        return;
      }
      const go = () => {
        // Where the live words stand as the piece ends: up to here, its accurate text replaces them.
        if (current.live) {
          current.liveMarks = { ...current.liveMarks, [seq]: current.live.heard.length };
          setLive({ text: current.live.heard, marks: current.liveMarks });
        }
        // The live words of the piece: the server decides on them at once, not after its accurate
        // text.
        const liveText = current.live
          ? pieceWords(current.live.heard, current.liveMarks, seq).slice(0, 5_000)
          : '';
        const meta: DocumentVoiceSegmentMeta = {
          seq,
          startMs: Math.round(startMs),
          endMs: Math.max(Math.round(startMs), Math.round(endMs)),
          context: summarize(current.samples, startMs, endMs),
          ...(/[\p{L}\p{N}]/u.test(liveText) ? { liveText } : {}),
        };
        const wav = new Blob([encodeWav(audio)], { type: 'audio/wav' });
        const post = (sessionId: string): Promise<DocumentVoiceSession> =>
          voiceApi.document.segment(sessionId, meta, wav).catch(async (failure: unknown) => {
            // The server forgot the session (it restarted): a new one takes the piece.
            if (failure instanceof ApiError && failure.status === 404 && run.current === current) {
              const fresh = await voiceApi.document.start(documentId);
              current.sessionId = fresh.id;
              current.commandsDone.clear();
              return voiceApi.document.segment(fresh.id, meta, wav);
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
      // The live words of its last moments may still be on their way: a moment for them.
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
    [apply, documentId, scheduleFlush],
  );

  /** What is on screen, a few times a second: the paragraphs in the window, the pointer, the pick. */
  const sample = useCallback(() => {
    const current = run.current;
    if (!current) return;
    const seen = latest.current.look.sample(current.pointer);
    const atMs = performance.now() - current.startedAt;
    current.samples.push({ atMs, ...seen });
    while (current.samples.length > 0 && current.samples[0]!.atMs < atMs - KEPT_MS) {
      current.samples.shift();
    }
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
    const starting = voiceApi.document.start(documentId);
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
      samples: [],
      seq: 0,
      inFlight: new Set(),
      commandsDone: new Set(),
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
  }, [documentId, sample, scheduleFlush, send, setLevel]);

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
      apply(await voiceApi.document.end(current.sessionId));
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

  // The pause detector is loaded ahead whenever speaking is possible and off: the double click
  // then only opens the microphone.
  const available = mayComment && !!info.data?.available;
  const idle = status === 'off' || status === 'ended';
  useEffect(() => {
    if (!available || !idle || !online || !canRecord()) return;
    const prepare = () => void prepareMicrophone().catch(() => undefined);
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(prepare, { timeout: 3_000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(prepare, 1_000);
    return () => window.clearTimeout(timer);
  }, [available, idle, online]);

  const claim = useCallback((options: { strict?: boolean } = {}) => {
    run.current?.segmenter.flush();
    claims.current.open += 1;
    if (options.strict) claims.current.strict += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      run.current?.segmenter.flush();
      claims.current.open -= 1;
      if (options.strict) claims.current.strict -= 1;
    };
  }, []);

  // The pointer, for what was on screen.
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
        void voiceApi.document
          .get(current.sessionId)
          .then(apply)
          .catch(() => undefined);
      },
      busy ? POLL_BUSY_MS : POLL_IDLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [apply, session, status]);

  // Leaving the document ends it.
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

  const value = useMemo<VoiceState>(
    () => ({
      heard: () => run.current?.live?.heard ?? '',
      claim,
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
    [claim, dismiss, error, live, pause, resume, sending, session, speaking, status, stop, toggle],
  );
  const name = info.data?.name;
  const writerVoice = useMemo<WriterVoice>(
    () => ({ ai: aiAuthor(name), available, open: (item) => latest.current.onOpen(item) }),
    [available, name],
  );

  return (
    <VoiceContext value={value}>
      <WriterVoiceContext value={writerVoice}>{children}</WriterVoiceContext>
    </VoiceContext>
  );
}

/**
 * The bar of speaking to the AI in Writer: double-clicking the tools' upright handle
 * (`WriterToolbar`) opens it upright in the handle's place.
 */
export function WriterVoiceBar() {
  const voice = useWriterVoice();
  const { me } = useWriter();
  if (!voice) return null;
  return (
    <VoiceBarView
      host={{
        aiAuthor: voice.ai,
        color: ringColor(me.color),
        place: (item) => (item.threadId === item.commentId ? 'Kommentar' : 'Ergänzung'),
        open: (item) => {
          if ('paragraphId' in item) voice.open(item);
        },
        hint: `Geh durch den Text und zeig mit der Maus oder der Auswahl, was du meinst. Fertige Gedanken gehen sofort an ${voice.ai.name}. Senden beendet das Zuhören, was du gesagt hast, wird noch fertig bearbeitet. Auch: „geh zur Einleitung“, „vergiss das“, „mach das rückgängig“, „Stopp“.`,
        // Upright, as the handle it grows out of: turned a quarter clockwise about its top left
        // corner (the handle's right edge, at its middle), so it runs down the tools' column over
        // the handle, the words top to bottom; what opens below it (the list) opens towards the
        // page.
        className:
          'absolute top-1/2 left-full z-(--z-panel) w-[clamp(240px,calc(100vh-32rem),460px)] origin-top-left [transform:rotate(90deg)_translateX(-50%)] @container',
      }}
    />
  );
}
