import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Slide, SlideTransition } from '@slider/shared';
import { cn, IconButton } from '@/ui';
import { placePopover, type Placement } from '../../lib/geometry';
import { useViewerData } from '../../state/viewer-data';
import { useViewerToast } from '../../state/viewer-toast';
import { useEditing } from '../editing-context';
import { showPickedTransition, useTransitionOf } from './picked-transitions';
import { playTransition, TRANSITIONS } from './transition-frames';

const PANEL_WIDTH = 560;
const MARGIN = 12;
/** A hovered preview plays again after this long. */
const REPLAY_MS = 1600;

/**
 * „Übergang“ from a gap between two slides: a panel beside the gap's button with the transitions
 * the slide after the gap can come in with – each a small picture of the two slides that plays
 * it while hovered or focused. A pick goes into the file (LibreOffice and PowerPoint play it) –
 * shown at once, the panel closing, while the edit goes out (a refusal tells in a toast).
 * Rendered into the body: the track's scroller would clip it.
 */
export function SlideTransitionPicker({
  anchorRef,
  panelRef,
  panelId,
  afterSlideId,
  slideId,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  panelId: string;
  /** The slide before the gap; `null`: the gap before the first slide. */
  afterSlideId: string | null;
  /** The slide that comes in with the transition. */
  slideId: string;
  onClose: () => void;
}) {
  const { slides } = useViewerData();
  const editing = useEditing();
  const toast = useViewerToast();
  const transitionOf = useTransitionOf();
  const [placement, setPlacement] = useState<Placement | null>(null);
  const editSlide = editing.state?.slides.find((slide) => slide.slideId === slideId);
  const current = transitionOf(slideId);
  const incoming = slides.find((slide) => slide.id === slideId);
  const outgoing = afterSlideId ? slides.find((slide) => slide.id === afterSlideId) : undefined;
  const number = incoming ? slides.indexOf(incoming) + 1 : null;

  // Beside the gap, measured once it is laid out (as „Folie einfügen“).
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;
    const place = () => {
      const box = (anchor.parentElement ?? anchor).getBoundingClientRect();
      setPlacement(
        placePopover(
          box,
          { width: panel.offsetWidth, height: panel.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight },
          12,
          MARGIN,
        ),
      );
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [anchorRef, panelRef]);

  const pick = (transition: SlideTransition) => {
    onClose();
    if (!editSlide || transition === current) return;
    const done = editing.apply([
      { type: 'setSlideTransition', pageId: editSlide.pageId, transition },
    ]);
    showPickedTransition(slideId, transition, done);
    toast(transition === 'none' ? 'Übergang entfernt' : 'Übergang gesetzt');
  };

  const disabled = !editing.available || !editSlide;

  return createPortal(
    <section
      ref={panelRef}
      id={panelId}
      role="dialog"
      aria-label="Übergang"
      className={cn(
        'glass-elevated fixed z-(--z-popover) flex max-h-[min(640px,80vh)] animate-pop-in flex-col gap-3 rounded-panel p-3',
        !placement && 'invisible',
      )}
      style={{
        width: `min(${PANEL_WIDTH}px, calc(100vw - ${2 * MARGIN}px))`,
        left: placement?.left ?? 0,
        top: placement?.top ?? 0,
      }}
    >
      <header className="flex items-center gap-3">
        <h2 className="pl-1 text-sm font-medium text-fg">
          Übergang{number !== null && ` · Folie ${number}`}
        </h2>
        {current === null && (
          <span className="text-caption text-fg-faint">Eigener Übergang aus der Datei</span>
        )}
        <IconButton
          icon="close"
          label="Schließen"
          size="sm"
          onClick={onClose}
          className="ml-auto"
        />
      </header>
      <div
        role="group"
        aria-label="Übergänge"
        className="grid min-h-0 grid-cols-2 content-start gap-2 overflow-y-auto p-1 sm:grid-cols-4"
      >
        {TRANSITIONS.map((item) => (
          <TransitionTile
            key={item.value}
            transition={item.value}
            label={item.label}
            hint={item.hint}
            checked={current === item.value}
            disabled={disabled}
            incoming={incoming}
            outgoing={outgoing}
            onPick={() => pick(item.value)}
          />
        ))}
      </div>
    </section>,
    document.body,
  );
}

/** A transition to pick: the two slides, which it plays while hovered or focused. */
function TransitionTile({
  transition,
  label,
  hint,
  checked,
  disabled,
  incoming,
  outgoing,
  onPick,
}: {
  transition: SlideTransition;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  incoming: Slide | undefined;
  outgoing: Slide | undefined;
  onPick: () => void;
}) {
  const incomingRef = useRef<HTMLSpanElement>(null);
  const outgoingRef = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const into = incomingRef.current;
    const from = outgoingRef.current;
    if (!playing || !into || !from) return;
    let stop = playTransition(transition, into, from);
    const timer = window.setInterval(() => {
      stop();
      stop = playTransition(transition, into, from);
    }, REPLAY_MS);
    return () => {
      window.clearInterval(timer);
      stop();
    };
  }, [playing, transition]);

  return (
    <button
      type="button"
      aria-pressed={checked}
      disabled={disabled}
      title={hint}
      onClick={onPick}
      onPointerEnter={() => setPlaying(true)}
      onPointerLeave={() => setPlaying(false)}
      onFocus={() => setPlaying(true)}
      onBlur={() => setPlaying(false)}
      className="group flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-chip p-1 text-left transition-colors outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-fg/60 disabled:cursor-default"
    >
      <span
        className={cn(
          'relative block h-0 overflow-hidden rounded-thumb bg-black ring-hairline',
          checked && 'ring-2 ring-fg',
        )}
        style={{ paddingBottom: `${100 / (incoming?.aspectRatio ?? 16 / 9)}%` }}
      >
        <span ref={outgoingRef} className="absolute inset-0 bg-placeholder">
          {outgoing && <Picture slide={outgoing} />}
        </span>
        <span ref={incomingRef} className="absolute inset-0 bg-placeholder">
          {incoming && <Picture slide={incoming} />}
        </span>
      </span>
      <span
        className={cn(
          'truncate px-0.5 text-caption group-hover:text-fg',
          checked ? 'text-fg' : 'text-fg-muted',
        )}
      >
        {label}
      </span>
    </button>
  );
}

function Picture({ slide }: { slide: Slide }) {
  return (
    <img
      src={slide.thumbnailUrl}
      alt=""
      loading="lazy"
      draggable={false}
      className="absolute inset-0 size-full object-cover"
    />
  );
}
