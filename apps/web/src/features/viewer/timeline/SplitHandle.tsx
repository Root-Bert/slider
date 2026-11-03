import {
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { cn } from '@/ui';
import { flushSync } from 'react-dom';
import { rafThrottle } from '@/lib/dom';
import {
  dragSplit,
  SPLIT_KEY_STEP_LARGE_PX,
  SPLIT_KEY_STEP_PX,
  SPLIT_MAX,
  SPLIT_MIN,
  stepSplit,
} from './lib/split';
import { resolvedSplit, type TrackGeometry } from './lib/timeline-layout';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch } from '../state/viewer-state';
import { VoiceContext } from '../voice/voice-context';

/** The bars that grow out of the handle, the one in front first (as the slot shows them). */
const BARS = ['[data-find-bar]', '[data-comment-selection]', '[data-voice-bar]'];
/** Room for the handle's ends beside such a bar, each side (the bars leave 2 × this, 3.5rem). */
const END_ROOM = 28;

/**
 * The width of the bar grown out of the handle (find, comment selection, voice) – its pill, not
 * the wider spot it may sit in – or `null` while there is none. Kept up as bars come, go and
 * resize.
 */
function useBarBeside(handle: HTMLElement | null): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const slot = handle?.parentElement;
    if (!slot) return;
    let bar: HTMLElement | null = null;
    const measure = () => {
      if (!bar?.isConnected) return setWidth(null);
      // Its pill: the children in the flow (a list above it is positioned out of it).
      let widest = 0;
      for (const child of bar.children) {
        if (!(child instanceof HTMLElement) || getComputedStyle(child).position === 'absolute')
          continue;
        widest = Math.max(widest, child.offsetWidth);
      }
      setWidth(widest || bar.offsetWidth || null);
    };
    const resize = new ResizeObserver(measure);
    const pick = () => {
      const next =
        BARS.map((selector) => slot.querySelector<HTMLElement>(`:scope > ${selector}`)).find(
          Boolean,
        ) ?? null;
      if (next !== bar) {
        resize.disconnect();
        bar = next;
        if (bar) {
          resize.observe(bar);
          for (const child of bar.children) resize.observe(child);
        }
      }
      measure();
    };
    const mutations = new MutationObserver(pick);
    mutations.observe(slot, { childList: true });
    pick();
    return () => {
      mutations.disconnect();
      resize.disconnect();
    };
  }, [handle]);
  return width;
}

interface SplitHandleProps {
  geometry: TrackGeometry;
  /** Current slide height (the track's height). */
  slideH: number;
  /** The split shown – while dragging, the dragged one. */
  split: number | null;
  /**
   * The split while dragging, once per frame; `null` when the drag ends (the store has the
   * final split by then).
   */
  onDrag: (split: number | null) => void;
}

/**
 * Grabber between the slide area (track, minimap, controls row) and the comment area, centred in
 * the controls row (desktop only). Dragging it down makes the slides bigger and the comment area smaller, up the
 * other way round; the slides always fill the track. A double click speaks to the AI (the voice bar
 * grows out of the handle) – without the AI it resets the default split. As a focusable separator, ↑ / ↓
 * (with Shift: larger steps) move it, Home / End jump to the smallest / largest slides, Enter resets.
 * While a bar has grown out of it, its two ends stick out left and right of the bar and still drag.
 */
export function SplitHandle({ geometry, slideH, split, onDrag }: SplitHandleProps) {
  const dispatch = useViewerDispatch();
  const { deck, aiAuthor } = useViewerData();
  const voice = useContext(VoiceContext);
  const canSpeak = !!voice && !!deck.ai?.available;
  const [handle, setHandle] = useState<HTMLDivElement | null>(null);
  const barWidth = useBarBeside(handle);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    startH: number;
    /** Last split shown by the drag – stored on release. */
    split: number | null;
  } | null>(null);
  const pendingRef = useRef<number | null>(null);
  // Pointer moves arrive faster than frames: the latest split is shown once per frame. Only on
  // release does it go to the viewer store (and the stored preference).
  const flushRef = useRef<ReturnType<typeof rafThrottle> | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const throttle = rafThrottle(() => {
      const next = pendingRef.current;
      if (next === null || !dragRef.current) return;
      pendingRef.current = null;
      dragRef.current.split = next;
      // Drawn this frame (`flushSync`), not a frame behind the pointer.
      flushSync(() => onDrag(next));
    });
    flushRef.current = throttle;
    return () => {
      throttle.cancel();
      flushRef.current = null;
    };
  }, [onDrag]);

  // While dragging the cursor stays a resize cursor everywhere (the pointer outruns the handle
  // at the limits) and nothing gets text-selected.
  useEffect(() => {
    if (!dragging) return;
    const root = document.documentElement;
    const { cursor, userSelect } = root.style;
    root.style.cursor = 'row-resize';
    root.style.userSelect = 'none';
    return () => {
      root.style.cursor = cursor;
      root.style.userSelect = userSelect;
    };
  }, [dragging]);

  const value = resolvedSplit(split, geometry);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startH: slideH,
      split: null,
    };
    setDragging(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    pendingRef.current = dragSplit(drag.startH, event.clientY - drag.startY, geometry);
    flushRef.current?.schedule();
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    flushRef.current?.cancel();
    // The last move counts even when its frame hasn't come yet.
    const final = pendingRef.current ?? drag.split;
    pendingRef.current = null;
    setDragging(false);
    // One render: the store takes over the split the drag showed.
    if (final !== null) dispatch({ type: 'splitChanged', split: final });
    onDrag(null);
  };

  const onDoubleClick = () => {
    if (!canSpeak) {
      dispatch({ type: 'splitChanged', split: null });
      return;
    }
    // Only opens it: a double click on the ends beside the open voice bar does nothing more – nor
    // beside the find bar or the comment selection, which the voice bar would hide behind.
    if (barWidth !== null) return;
    if (voice.status === 'off' || voice.status === 'ended') voice.toggle();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? SPLIT_KEY_STEP_LARGE_PX : SPLIT_KEY_STEP_PX;
    let next: number | null;
    if (event.key === 'ArrowUp') next = stepSplit(split, -1, geometry, step);
    else if (event.key === 'ArrowDown') next = stepSplit(split, 1, geometry, step);
    else if (event.key === 'Home') next = SPLIT_MIN;
    else if (event.key === 'End') next = SPLIT_MAX;
    else if (event.key === 'Enter') next = null;
    else return;
    event.preventDefault();
    dispatch({ type: 'splitChanged', split: next });
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Größe von Folien und Kommentarbereich"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={`Folien ${Math.round(slideH)} px hoch`}
      title={`Ziehen: Folien größer oder kleiner\nDoppelklick: ${canSpeak ? `Mit ${aiAuthor.name} sprechen` : 'Standard'}`}
      ref={setHandle}
      tabIndex={0}
      data-split-handle
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      className={cn(
        'group flex h-4 cursor-row-resize touch-none items-center rounded-full outline-none select-none',
        barWidth === null ? 'w-36 justify-center' : 'justify-between',
      )}
      style={barWidth === null ? undefined : { width: barWidth + 2 * END_ROOM }}
    >
      {barWidth !== null ? (
        // Its ends, left and right of the bar (which lies over the rest of it).
        <>
          <HandleEnd dragging={dragging} />
          <HandleEnd dragging={dragging} />
        </>
      ) : (
        <span
          aria-hidden
          className={cn(
            'h-[3px] rounded-full transition-[background-color,width] duration-150',
            // One or the other: with plain class merging `bg-handle` would outrank `bg-fg`.
            dragging ? 'w-28 bg-fg' : 'w-24 bg-handle',
            'group-hover:w-28 group-hover:bg-fg-muted group-focus-visible:w-28 group-focus-visible:bg-fg-muted group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-mention',
          )}
        />
      )}
    </div>
  );
}

/** One end of the handle beside a bar grown out of it. */
function HandleEnd({ dragging }: { dragging: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'h-[3px] w-4 animate-fade-in rounded-full transition-colors duration-150',
        dragging ? 'bg-fg' : 'bg-handle',
        'group-hover:bg-fg-muted group-focus-visible:bg-fg-muted group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-mention',
      )}
    />
  );
}
