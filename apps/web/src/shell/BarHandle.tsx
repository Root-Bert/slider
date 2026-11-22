import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';

/** A row's height in the side bar with its gap – what an arrow key moves the handle by. */
const ROW = 38;

/**
 * A line between two parts of a page as a handle (as Figma's panels). Across (`axis` y, the side
 * bar's lines): dragged, the part above takes the height it is pulled to (never more than it
 * holds). Upright (`axis` x, between a chat and its cards): the part after it takes the width,
 * between `min` and `max` – with `before`, the part before it (a list left of what it opens); a
 * short grip a little above its middle, as Slider's.
 * Double-clicked, `onReset` decides – back to the default, at the default the part whole. Arrow
 * keys move it a row, Enter is the double click.
 */
export function BarHandle({
  label,
  target,
  onSize,
  onReset,
  axis = 'y',
  min = 0,
  max,
  before = false,
  even = false,
  className,
}: {
  label: string;
  /** The part whose size the handle sets: above it (`y`), after it (`x`; `before`: before it). */
  target: RefObject<HTMLElement | null>;
  onSize: (size: number) => void;
  onReset: () => void;
  axis?: 'x' | 'y';
  min?: number;
  /** The largest size; across, by default what the part holds. */
  max?: () => number;
  /** Upright: the part before the handle takes the width, growing as it moves right. */
  before?: boolean;
  /** Upright: as much room before it as after – beside a card with its own edge (a mail). */
  even?: boolean;
  className?: string;
}) {
  const across = axis === 'y';
  const drag = useRef<{ at: number; size: number } | null>(null);
  const sizeOf = (element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    return across ? box.height : box.width;
  };
  const topOf = (size: number) =>
    max?.() ?? (across ? target.current?.scrollHeight : undefined) ?? size;
  const limit = (size: number) => Math.round(Math.max(min, Math.min(topOf(size), size)));
  // What a screen reader says of it (a focusable separator's value): the part's size in px, and
  // how far it goes – measured as it changes (dragged, a window resized).
  const [shown, setShown] = useState<{ now: number; top: number } | null>(null);
  const measure = useRef(() => {});
  useEffect(() => {
    measure.current = () => {
      if (!target.current) return;
      const now = Math.round(sizeOf(target.current));
      const top = Math.round(Math.max(min, topOf(now)));
      setShown((was) => (was?.now === now && was.top === top ? was : { now, top }));
    };
  });
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const observer = new ResizeObserver(() => measure.current());
    observer.observe(element);
    return () => observer.disconnect();
  }, [target]);
  // Across the part is before the handle and grows as it moves down; upright it is after it and
  // grows as it moves left (`before`: right).
  const grown = (start: number, moved: number) =>
    across || before ? start + moved : start - moved;
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !target.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      at: across ? event.clientY : event.clientX,
      size: sizeOf(target.current),
    };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const moved = (across ? event.clientY : event.clientX) - drag.current.at;
    onSize(limit(grown(drag.current.size, moved)));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!target.current) return;
    const now = sizeOf(target.current);
    const step = across
      ? { ArrowUp: -ROW, ArrowDown: ROW }[event.key]
      : { ArrowLeft: -ROW, ArrowRight: ROW }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      onSize(limit(grown(now, step)));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onReset();
    }
  };
  return (
    <div
      role="separator"
      aria-orientation={across ? 'horizontal' : 'vertical'}
      aria-label={label}
      aria-valuemin={shown ? min : undefined}
      aria-valuemax={shown?.top}
      aria-valuenow={shown?.now}
      aria-valuetext={shown ? `${shown.now} px` : undefined}
      tabIndex={0}
      title="Ziehen zum Verschieben, Doppelklick für die Standardgröße"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className={
        across
          ? 'group mx-2 flex h-4 shrink-0 cursor-row-resize touch-none items-center rounded-full focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'
          : // Room on both sides, more before it (avatars at a chat's edge, a row's end): the eye
            // wants more on the side with things at the edge (`even`: a card's edge, no more).
            `group relative w-8 shrink-0 cursor-col-resize touch-none outline-none select-none ${even ? '' : 'ml-3'} ${className ?? ''}`
      }
    >
      {across ? (
        <div className="h-px w-full bg-hairline-strong transition-[background-color,height] group-hover:h-0.5 group-hover:bg-fg-subtle group-active:bg-fg-muted" />
      ) : (
        // Upright, a grip as Slider's (`SplitHandle`): a short pill a little above the middle (the
        // eye's middle – the column starts under the page's head), the whole height takes the drag.
        <div className="absolute top-[35%] left-1/2 h-24 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-handle transition-[background-color,height] duration-150 group-hover:h-28 group-hover:bg-fg-muted group-focus-visible:h-28 group-focus-visible:bg-fg-muted group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-focus group-active:h-28 group-active:bg-fg" />
      )}
    </div>
  );
}
