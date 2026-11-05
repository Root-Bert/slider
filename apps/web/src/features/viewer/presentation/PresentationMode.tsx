import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import type { Slide, SlideLayers } from '@slider/shared';
import { useQueryClient } from '@tanstack/react-query';
import { slideLayersQuery } from '@/lib/api';
import { cn, IconButton } from '@/ui';
import { useEditing } from '../editing/editing-context';
import { useTransitionOf } from '../editing/transition/picked-transitions';
import { playTransition } from '../editing/transition/transition-frames';
import { useRestoreFocus } from '../hooks/useRestoreFocus';
import { slideSrcSet } from '../stage/lib/slide-image';
import { useViewerData } from '../state/viewer-data';
import { morphPictures, morphPlan, type MorphPlan } from './lib/morph';
import { presentationStart, presentedSlides } from './lib/presentation';
import { atIndex, atMessage, FULLSCREEN_MESSAGE } from './lib/show-sync';
import { MorphStage } from './MorphStage';
import { useBoxColor, useShowBoxes } from './show-boxes';
import { ShowBoxLayer } from './ShowBoxLayer';
import { RecordControls } from './RecordControls';
import { useShowRecording } from './show-recording';
import { useSaveShowRun, showRunOf } from './lib/show-runs';
import { useViewerToast } from '../state/viewer-toast';
import type { ShowScene } from './lib/show-recorder';
import {
  useShowChannel,
  useShowClock,
  useShowFullscreen,
  useShowKeys,
  useShowMessages,
  useWakeLock,
} from './show-hooks';

/** How long the controls and the pointer stay after the mouse last moved. */
const IDLE_MS = 2500;
/** A touch moving this far sideways is a swipe, not a tap. */
const SWIPE_PX = 50;
/** How long a transition plays – LibreOffice's „mittel“. */
const TRANSITION_MS = 700;
/** The morph takes a little longer: things travel. */
const MORPH_MS = 1000;

interface PresentationModeProps {
  /** The slide it starts on (a hidden one hands over to the next one shown). */
  startSlideId: string | null;
  /** Ended (Esc, ✕, leaving fullscreen, past the last slide): with the slide it was on. */
  onExit: (slideId: string | null) => void;
  /**
   * The audience's window opened from the presenter view: follows it (and leads it when stepped
   * here), never asks for fullscreen by itself.
   */
  audience?: boolean;
}

/**
 * The deck as a slide show: fullscreen, one slide at a time on black, nothing else – no
 * comments, no tools. Clicks, taps, swipes and PowerPoint's keys move on (`presentationKey`);
 * after the last slide a black end screen, the next step ends it. A step on to the next slide plays
 * the transition it comes in with (as LibreOffice and PowerPoint do); going back or jumping does
 * not. The controls show while the mouse moves. Takes every key while it is open, so the viewer's
 * shortcuts stay quiet.
 */
export function PresentationMode({
  startSlideId,
  onExit,
  audience = false,
}: PresentationModeProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { slides: viewerSlides, deck } = useViewerData();
  const [slides] = useState(() => presentedSlides(viewerSlides));
  const [index, setIndex] = useState(() => presentationStart(viewerSlides, slides, startSlideId));
  const [black, setBlack] = useState(false);
  const transitionOf = useTransitionOf();
  // The editor's (a pick shows before the server has it), else the slide's as everyone sees it.
  const transitionFor = (slide: Slide) => transitionOf(slide.id) ?? slide.transition ?? 'none';
  // The slide being left while the next one comes in with its transition.
  const [leaving, setLeaving] = useState<string | null>(null);
  const pictures = useRef(new Map<string, HTMLImageElement>());
  const morph = useMorph(slides, index, transitionFor);
  // The morph playing (it stands for the transition then).
  const [morphing, setMorphing] = useState<MorphPlan | null>(null);
  // When the mouse last moved: the controls and the pointer show until it rests.
  const [movedAt, setMovedAt] = useState<number | null>(null);
  const controlsShown = movedAt !== null;
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  useRestoreFocus();

  // `slides.length` is the end screen.
  const ended = index >= slides.length;
  const current = slides[Math.min(index, slides.length - 1)] ?? null;

  const show = useShowChannel(deck.id);
  const finishing = useRef<() => void>(() => undefined);
  const exit = () => {
    if (audience) show.post({ type: 'end' });
    finishing.current();
    onExit(current?.id ?? null);
  };
  const go = (next: number) => {
    setBlack(false);
    if (next > slides.length) {
      exit();
      return;
    }
    const to = Math.max(0, next);
    const incoming = slides[to];
    const transition = incoming && to === index + 1 && !black ? transitionFor(incoming) : null;
    // Its pictures not there yet (or no edit rights to take slides apart): a crossfade.
    const plan =
      transition === 'morph' && incoming && slides[index]
        ? morph.plan(slides[index].id, incoming.id)
        : null;
    setMorphing(plan);
    setLeaving(transition && transition !== 'none' && !plan ? (slides[index]?.id ?? null) : null);
    setIndex(to);
  };

  // The next slide comes in over the one left; that one goes once the transition is over.
  useLayoutEffect(() => {
    const incoming = slides[index];
    const into = incoming && pictures.current.get(incoming.id);
    const from = leaving && pictures.current.get(leaving);
    if (!incoming || !into || !from) return;
    const transition = transitionFor(incoming);
    if (transition === 'none') return;
    const stop = playTransition(transition, into, from, TRANSITION_MS);
    const timer = window.setTimeout(() => setLeaving(null), TRANSITION_MS);
    return () => {
      window.clearTimeout(timer);
      stop();
    };
    // Only a new step plays it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, leaving]);
  const step = (by: 1 | -1) => {
    // A black screen goes back to the slide first, like in PowerPoint.
    if (black) setBlack(false);
    else go(index + by);
  };

  const boxes = useShowBoxes(show, ended ? null : (current?.id ?? null));
  const boxColor = useBoxColor();
  useShowKeys({
    step,
    go,
    count: slides.length,
    toggleBlack: () => setBlack((on) => !on),
    exit,
    clear: boxes.clear,
  });

  // The audience's window: where the presenter view moves, it follows – and the other way round.
  // A step taken on a message is not told back (rapid steps would bounce).
  const fromOther = useRef(false);
  useShowMessages(show, (message) => {
    if (!audience) return;
    if (message.type === 'end') {
      onExit(current?.id ?? null);
      return;
    }
    if (message.type !== 'at') return;
    const target = atIndex(slides, message);
    if (target === null || (target === index && message.black === black)) return;
    fromOther.current = true;
    if (target !== index) go(target);
    setBlack(message.black);
  });
  const told = useRef(false);
  useEffect(() => {
    if (!audience) return;
    // First: ask where the show is, instead of telling.
    if (!told.current) {
      told.current = true;
      show.post({ type: 'hello' });
      return;
    }
    if (fromOther.current) {
      fromOther.current = false;
      return;
    }
    show.post(atMessage(slides, index, black));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, black]);

  // A window of its own goes fullscreen on the first click in it (or when the presenter view
  // hands it the right to); leaving fullscreen there only leaves fullscreen.
  useShowFullscreen(rootRef, exit, !audience);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!audience) return;
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    const onDelegated = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data !== FULLSCREEN_MESSAGE) return;
      void rootRef.current?.requestFullscreen().catch(() => undefined);
    };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('message', onDelegated);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('message', onDelegated);
    };
  }, [audience]);
  const enterFullscreen = () => {
    if (!document.fullscreenEnabled || document.fullscreenElement) return false;
    void rootRef.current?.requestFullscreen().catch(() => undefined);
    return true;
  };

  useWakeLock();

  // „Aufnehmen“ (not in the audience's window: the presenter view records there): what the
  // audience sees, with the stopwatch that only a recording starts here.
  const clock = useShowClock(ended ? null : (current?.id ?? null));
  const scene = useRef<ShowScene>({ slide: null, black: false, transition: 'none', boxes: [] });
  useEffect(() => {
    scene.current = {
      slide: ended ? null : current,
      black,
      transition: current ? transitionFor(current) : 'none',
      boxes: boxes.boxes,
    };
  });
  const recording = useShowRecording({
    clock,
    title: deck.title,
    aspect: current?.aspectRatio ?? 16 / 9,
    color: boxColor,
    scene,
  });
  const toast = useViewerToast();
  const saveRun = useSaveShowRun(deck.id);
  const savedRun = useRef(false);
  useEffect(() => {
    finishing.current = () => {
      if (savedRun.current) return;
      savedRun.current = true;
      if (!ended || !clock.started) return;
      const run = showRunOf(slides, clock.marks(), clock.elapsed(), new Date());
      void recording
        .complete()
        .then((blob) => saveRun(run, blob))
        .then(
          () => toast('Durchgang gespeichert'),
          (error: Error) => toast(error.message, 'danger'),
        );
    };
  });

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
    // Its own window not yet fullscreen: the first click makes it so, it does not step on.
    if (audience && enterFullscreen()) return;
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
    .filter(({ slide, at }) => Math.abs(at - index) <= 1 || slide.id === leaving);

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
          ref={(element) => {
            if (element) pictures.current.set(slide.id, element);
            else pictures.current.delete(slide.id);
          }}
          src={slide.imageUrl}
          {...slideSrcSet(slide, 'screen')}
          alt={at === index ? `Folie ${at + 1}` : ''}
          aria-hidden={at !== index}
          draggable={false}
          className={cn(
            'absolute inset-0 size-full object-contain',
            at === index && 'z-1',
            ((at !== index && slide.id !== leaving) || black) && 'invisible',
          )}
        />
      ))}

      {morphing && !black && (
        <MorphStage
          key={`${morphing.from}>${morphing.to}`}
          plan={morphing}
          aspect={morph.aspect}
          duration={MORPH_MS}
          onDone={() => setMorphing(null)}
        />
      )}

      {/* Boxes drawn on the slide (a drag; a click still steps on): over the slide's own box. */}
      {!ended && !black && current && (
        <div
          className="pointer-events-none absolute inset-0 z-3 m-auto"
          style={{
            width: `min(100vw, calc(100vh * ${current.aspectRatio}))`,
            aspectRatio: `${current.aspectRatio}`,
          }}
        >
          <ShowBoxLayer
            boxes={boxes.boxes}
            now={boxes.now}
            color={boxColor}
            onDraw={boxes.add}
            className={controlsShown ? 'cursor-crosshair' : 'cursor-none'}
          />
        </div>
      )}

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
          'absolute bottom-4 left-4 z-4 flex items-center gap-1 rounded-full p-1 text-fg-muted transition-opacity duration-300 glass-dark',
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
        {audience && !fullscreen && (
          <IconButton icon="openInFull" label="Vollbild" size="sm" onClick={enterFullscreen} />
        )}
        {!audience && <RecordControls recording={recording} />}
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

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function decode(url: string): Promise<void> {
  const image = new Image();
  image.src = url;
  return image.decode().catch(() => undefined);
}

/**
 * The morph's pictures, taken apart ahead (`morph.ts`): the slide shown and the next one when it
 * comes in with a morph, asked for and decoded while the slide is on screen. Gives the plan from
 * one slide to the next once both are in – `null` before, or for whom the deck cannot be taken
 * apart (no edit rights: no elements), or with reduced motion.
 */
function useMorph(
  slides: readonly Slide[],
  index: number,
  transitionFor: (slide: Slide) => string,
) {
  const editing = useEditing();
  const queryClient = useQueryClient();
  const seq = editing.state?.seq;
  const deckId = useViewerData().deck.id;
  const ready = useRef(new Map<string, SlideLayers>());
  const next = slides[index + 1];
  const wanted =
    seq !== undefined && next && transitionFor(next) === 'morph' && !reducedMotion()
      ? [slides[index]!.id, next.id]
      : [];
  const key = wanted.join(' ');
  useEffect(() => {
    if (seq === undefined || !key) return;
    let cancelled = false;
    for (const slideId of key.split(' ')) {
      if (ready.current.has(`${slideId}@${seq}`)) continue;
      void queryClient
        .fetchQuery(slideLayersQuery(deckId, slideId, seq, 'interactive'))
        .then(async (layers) => {
          await Promise.all(
            [layers.background, ...layers.layers.map((layer) => layer.url)]
              .filter((url): url is string => !!url)
              .map(decode),
          );
          if (!cancelled) ready.current.set(`${slideId}@${seq}`, layers);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [deckId, key, queryClient, seq]);

  const plan = (fromId: string, toId: string): MorphPlan | null => {
    if (seq === undefined || reducedMotion()) return null;
    const from = ready.current.get(`${fromId}@${seq}`);
    const to = ready.current.get(`${toId}@${seq}`);
    if (!from || !to) return null;
    const made = morphPlan(from, editing.elementsOf(fromId), to, editing.elementsOf(toId));
    return morphPictures(made).length > 0 ? made : null;
  };
  const { width, height } = editing.pageSize;
  return { plan, aspect: height > 0 ? width / height : 16 / 9 };
}
