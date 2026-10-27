import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from 'react';
import { cn, IconButton } from '@/ui';
import { useRestoreFocus } from '../hooks/useRestoreFocus';
import { slideSrcSet } from '../stage/lib/slide-image';
import { useViewerData } from '../state/viewer-data';
import { presentationKey, presentationStart, presentedSlides } from './lib/presentation';

/** How long the controls and the pointer stay after the mouse last moved. */
const IDLE_MS = 2500;
/** A touch moving this far sideways is a swipe, not a tap. */
const SWIPE_PX = 50;

interface PresentationModeProps {
  /** The slide it starts on (a hidden one hands over to the next one shown). */
  startSlideId: string | null;
  /** Ended (Esc, ✕, leaving fullscreen, past the last slide): with the slide it was on. */
  onExit: (slideId: string | null) => void;
}

/**
 * The deck as a slide show: fullscreen, one slide at a time on black, nothing else – no
 * comments, no tools. Clicks, taps, swipes and PowerPoint's keys move on (`presentationKey`);
 * after the last slide a black end screen, the next step ends it. The controls show while the
 * mouse moves. Takes every key while it is open, so the viewer's shortcuts stay quiet.
 */
export function PresentationMode({ startSlideId, onExit }: PresentationModeProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { slides: viewerSlides, deck } = useViewerData();
  const [slides] = useState(() => presentedSlides(viewerSlides));
  const [index, setIndex] = useState(() => presentationStart(viewerSlides, slides, startSlideId));
  const [black, setBlack] = useState(false);
  // When the mouse last moved: the controls and the pointer show until it rests.
  const [movedAt, setMovedAt] = useState<number | null>(null);
  const controlsShown = movedAt !== null;
  // A number typed before Enter: the slide to jump to.
  const typed = useRef('');
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  useRestoreFocus();

  // `slides.length` is the end screen.
  const ended = index >= slides.length;
  const current = slides[Math.min(index, slides.length - 1)] ?? null;

  const exit = () => onExit(current?.id ?? null);
  const exitFromEffect = useEffectEvent(exit);
  const go = (next: number) => {
    setBlack(false);
    if (next > slides.length) exit();
    else setIndex(Math.max(0, next));
  };
  const step = (by: 1 | -1) => {
    // A black screen goes back to the slide first, like in PowerPoint.
    if (black) setBlack(false);
    else go(index + by);
  };

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    // Nothing reaches the viewer behind (shortcuts, find, tools)…
    event.stopImmediatePropagation();
    // …but the browser keeps its own shortcuts.
    if (event.metaKey || event.ctrlKey || event.altKey) return;
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
          if (number >= 1) go(Math.min(number, slides.length) - 1);
          return;
        }
        step(1);
        return;
      case 'previous':
        step(-1);
        return;
      case 'first':
        go(0);
        return;
      case 'last':
        go(slides.length - 1);
        return;
      case 'black':
        setBlack((on) => !on);
        return;
      case 'exit':
        exit();
        return;
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    // Capture on the window: before the viewer's own listeners.
    window.addEventListener('keydown', listener, { capture: true });
    return () => window.removeEventListener('keydown', listener, { capture: true });
  }, []);

  // Fullscreen on the show itself – still within the click or key press that started it. The
  // browser's own way out (Esc, the system's gesture) ends the show, too.
  useLayoutEffect(() => {
    const root = rootRef.current;
    root?.focus({ preventScroll: true });
    if (!root || !document.fullscreenEnabled) return;
    let entered = false;
    const onChange = () => {
      if (document.fullscreenElement === root) entered = true;
      else if (entered) exitFromEffect();
    };
    document.addEventListener('fullscreenchange', onChange);
    void root.requestFullscreen().catch(() => undefined);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement === root)
        void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  // The screen stays on while presenting (where the browser allows it).
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

  // The controls and the pointer go once the mouse rests.
  useEffect(() => {
    if (movedAt === null) return;
    const timer = window.setTimeout(() => setMovedAt(null), IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [movedAt]);

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') setMovedAt(event.timeStamp);
  };
  const onPointerDown = (event: PointerEvent) => {
    pointerStart.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: PointerEvent) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || (event.target as Element).closest('button')) return;
    const dx = event.clientX - start.x;
    if (event.pointerType === 'touch') {
      if (Math.abs(dx) >= SWIPE_PX) step(dx < 0 ? 1 : -1);
      else step(1);
      return;
    }
    if (event.button === 0) step(1);
  };

  // The current slide and its neighbours stay mounted: the next one is loaded before it shows.
  const mounted = slides
    .map((slide, at) => ({ slide, at }))
    .filter(({ at }) => Math.abs(at - index) <= 1);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal
      aria-label={`Präsentation: ${deck.title}`}
      tabIndex={-1}
      data-presentation
      className={cn(
        'fixed inset-0 z-(--z-presentation) bg-black outline-none select-none',
        !controlsShown && 'cursor-none',
      )}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onContextMenu={(event) => {
        event.preventDefault();
        step(-1);
      }}
    >
      {mounted.map(({ slide, at }) => (
        <img
          key={slide.id}
          src={slide.imageUrl}
          {...slideSrcSet(slide, 'screen')}
          alt={at === index ? `Folie ${at + 1}` : ''}
          aria-hidden={at !== index}
          draggable={false}
          className={cn(
            'absolute inset-0 size-full object-contain',
            (at !== index || black) && 'invisible',
          )}
        />
      ))}

      {ended && (
        <p className="absolute inset-x-0 top-8 text-center text-sm text-white/60">
          Ende der Präsentation. Zum Beenden klicken.
        </p>
      )}

      <p className="sr-only" aria-live="polite">
        {ended ? 'Ende der Präsentation' : `Folie ${index + 1} von ${slides.length}`}
      </p>

      <div
        className={cn(
          'absolute bottom-4 left-4 flex items-center gap-1 rounded-full bg-black/60 p-1 text-white/80 transition-opacity duration-300',
          controlsShown ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <IconButton
          icon="chevronLeft"
          label="Vorherige Folie"
          size="sm"
          disabled={index === 0}
          onClick={() => go(index - 1)}
        />
        <span className="min-w-14 text-center text-sm tabular-nums">
          {Math.min(index + 1, slides.length)} / {slides.length}
        </span>
        <IconButton
          icon="chevronRight"
          label="Nächste Folie"
          size="sm"
          onClick={() => go(index + 1)}
        />
        <IconButton
          icon="close"
          label="Präsentation beenden"
          title="Präsentation beenden (Esc)"
          size="sm"
          onClick={exit}
        />
      </div>
    </div>
  );
}
