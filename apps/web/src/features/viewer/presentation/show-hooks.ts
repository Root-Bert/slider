import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { useSearchParams } from 'react-router';
import { presentationKey } from './lib/presentation';
import type { SlideMark } from './lib/show-times';
import {
  AUDIENCE_PARAM,
  AUDIENCE_VALUE,
  parseShowMessage,
  showChannelName,
  stopwatchElapsed,
  stopwatchReset,
  stopwatchToggled,
  type ShowMessage,
  type Stopwatch,
} from './lib/show-sync';

/** What the slide show's keys do (`presentationKey`), for the show and the presenter view alike. */
export interface ShowKeyHandlers {
  /** One step on (1) or back (-1). */
  step: (by: 1 | -1) => void;
  /** To this slide (0-based); a number typed then Enter. */
  go: (index: number) => void;
  /** How many slides are shown: a typed number is clamped to it. */
  count: number;
  toggleBlack: () => void;
  exit: () => void;
  /** Clears the drawn boxes (Esc, Delete) – `false` when there were none: Esc then ends. */
  clear?: () => boolean;
}

/**
 * PowerPoint's keys while presenting, taken on the window before anything else: nothing reaches
 * the viewer behind (shortcuts, find, tools), the browser keeps its own (⌘, Ctrl, ⌥).
 */
export function useShowKeys(handlers: ShowKeyHandlers) {
  // A number typed before Enter: the slide to jump to.
  const typed = useRef('');
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    event.stopImmediatePropagation();
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Delete' && handlers.clear) {
      event.preventDefault();
      handlers.clear();
      return;
    }
    const action = presentationKey(event.key);
    if (!action) return;
    event.preventDefault();
    if (action.type !== 'digit' && !(action.type === 'next' && event.key === 'Enter')) {
      typed.current = '';
    }
    switch (action.type) {
      case 'digit':
        typed.current = (typed.current + action.digit).slice(-4);
        return;
      case 'next':
        if (event.key === 'Enter' && typed.current) {
          const number = Number(typed.current);
          typed.current = '';
          if (number >= 1) handlers.go(Math.min(number, handlers.count) - 1);
          return;
        }
        handlers.step(1);
        return;
      case 'previous':
        handlers.step(-1);
        return;
      case 'first':
        handlers.go(0);
        return;
      case 'last':
        handlers.go(handlers.count - 1);
        return;
      case 'black':
        handlers.toggleBlack();
        return;
      case 'exit':
        if (handlers.clear?.()) return;
        handlers.exit();
        return;
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    // Capture on the window: before the viewer's own listeners.
    window.addEventListener('keydown', listener, { capture: true });
    return () => window.removeEventListener('keydown', listener, { capture: true });
  }, []);
}

/**
 * Fullscreen on `rootRef` – still within the click or key press that started it. The browser's
 * own way out (Esc, the system's gesture) calls `onLeft` (`null`: stays open). `request: false` (a
 * window of its own, opened without a click in it): only once asked there, `onLeft` never.
 */
export function useShowFullscreen(
  rootRef: RefObject<HTMLElement | null>,
  onLeft: (() => void) | null,
  request = true,
) {
  const left = useEffectEvent(() => onLeft?.());
  useLayoutEffect(() => {
    const root = rootRef.current;
    root?.focus({ preventScroll: true });
    if (!root || !document.fullscreenEnabled) return;
    let entered = false;
    const onChange = () => {
      if (document.fullscreenElement === root) entered = true;
      else if (entered && request) left();
    };
    document.addEventListener('fullscreenchange', onChange);
    if (request) void root.requestFullscreen().catch(() => undefined);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement === root)
        void document.exitFullscreen().catch(() => undefined);
    };
  }, [rootRef, request]);
}

/** The screen stays on while presenting (where the browser allows it). */
export function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let released = false;
    void navigator.wakeLock
      ?.request('screen')
      .then((sentinel) => {
        if (released) void sentinel.release();
        else lock = sentinel;
      })
      .catch(() => undefined);
    return () => {
      released = true;
      void lock?.release().catch(() => undefined);
    };
  }, []);
}

/** The show's channel of one deck (`useShowChannel`): tell the other window, hear it. */
export interface ShowChannel {
  post: (message: ShowMessage) => void;
  listeners: Set<(message: ShowMessage) => void>;
}

/**
 * The presenter view and the audience's window of one deck talking (`show-sync.ts`) – heard with
 * `useShowMessages`. Without BroadcastChannel: alone.
 */
export function useShowChannel(deckId: string): ShowChannel {
  const channel = useRef<BroadcastChannel | null>(null);
  const [listeners] = useState(() => new Set<(message: ShowMessage) => void>());
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const opened = new BroadcastChannel(showChannelName(deckId));
    channel.current = opened;
    opened.onmessage = (event: MessageEvent) => {
      const message = parseShowMessage(event.data);
      if (message) for (const listener of listeners) listener(message);
    };
    return () => {
      opened.close();
      if (channel.current === opened) channel.current = null;
    };
  }, [deckId, listeners]);
  const post = useCallback((message: ShowMessage) => channel.current?.postMessage(message), []);
  return useMemo(() => ({ post, listeners }), [post, listeners]);
}

/** What the other window says, heard while mounted. */
export function useShowMessages(channel: ShowChannel, onMessage: (message: ShowMessage) => void) {
  const heard = useEffectEvent(onMessage);
  useEffect(() => {
    const listener = (message: ShowMessage) => heard(message);
    channel.listeners.add(listener);
    return () => void channel.listeners.delete(listener);
  }, [channel]);
}

/** This viewer was opened from the presenter view as the audience's window (`?present=audience`). */
export function useIsAudienceWindow(): boolean {
  const [searchParams] = useSearchParams();
  return searchParams.get(AUDIENCE_PARAM) === AUDIENCE_VALUE;
}

/** The presenting stopwatch with each slide's start on it (`show-times.ts`). */
export interface ShowClock {
  watch: Stopwatch;
  /** Started once (by „Start“ or a recording); before, there is no time to show. */
  started: boolean;
  running: boolean;
  start: () => void;
  /** Paused, or running again. */
  toggle: () => void;
  reset: () => void;
  /** Stopwatch time now. */
  elapsed: () => number;
  /** Where each slide started on it, oldest first. */
  marks: () => SlideMark[];
}

/**
 * The stopwatch while presenting: it does not run on its own – „Start“ or a recording starts
 * it. Every slide shown (`slideKey`, `null` for the end screen) is marked on it, so its time on
 * screen counts only while it runs.
 */
export function useShowClock(slideKey: string | null): ShowClock {
  const [watch, setWatch] = useState<Stopwatch>({ gathered: 0, since: null });
  const [started, setStarted] = useState(false);
  const watchRef = useRef(watch);
  const marks = useRef<SlideMark[]>([]);
  const change = (next: Stopwatch) => {
    watchRef.current = next;
    setWatch(next);
  };
  useEffect(() => {
    marks.current.push({ slideId: slideKey, at: stopwatchElapsed(watchRef.current, Date.now()) });
  }, [slideKey]);
  const keyRef = useRef(slideKey);
  useEffect(() => {
    keyRef.current = slideKey;
  }, [slideKey]);
  return {
    watch,
    started,
    running: watch.since !== null,
    start: () => {
      setStarted(true);
      if (watchRef.current.since === null) change(stopwatchToggled(watchRef.current, Date.now()));
    },
    toggle: () => {
      setStarted(true);
      change(stopwatchToggled(watchRef.current, Date.now()));
    },
    reset: () => {
      change(stopwatchReset(watchRef.current, Date.now()));
      marks.current = [{ slideId: keyRef.current, at: 0 }];
    },
    elapsed: () => stopwatchElapsed(watchRef.current, Date.now()),
    marks: () => [...marks.current],
  };
}
