import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { MaterialTile } from '@/features/viewer';
import { Icon } from '@/ui';
import { rafThrottle } from '@/lib/dom';
import { pluralize } from '@/lib/format';
import { countWords } from '../lib/model';
import { useWriter, useWriterState } from './session';

const THUMB_WIDTH = 104;
/** As between a presentation's small slides. */
const THUMB_GAP = 8;
/** Room above and below the sheets, the gap between them: the bracket's outset fits in it. */
const STRIP_PAD = THUMB_GAP;
/** The strip stands this far from the window's left edge, as a presentation's minimap. */
export const STRIP_INSET = 16;
/** The pages' column: the strip and its inset on both sides. */
export const STRIP_COLUMN = THUMB_WIDTH + 2 * STRIP_INSET;
/** Bracket edges far enough out that no sheet lies outside the window. */
const DIM_ALL = 1e6;
/** The „Material“ tile above the pages, as high as a presentation's small slides. */
const MATERIAL_TILE_H = 48;
/** The bracket stands this far out around the sheets it frames. */
const BRACKET_OUTSET = 3;
/** A pointer that moves this far after pressing drags the bracket instead of clicking. */
const DRAG_FROM = 3;
/** The small sheets follow the text a moment after it stands still. */
const REDRAW_AFTER_MS = 350;

/**
 * The pages one under the other, small, as a presentation's minimap: each a copy of what stands
 * on it, and a bracket marks the part of the document in the window – clear inside, the sheets
 * outside dimmed (only they: the gaps stay clear); the whole document in the window shows none. Dragging the bracket scrolls the document, a click leads to the page. Before
 * the pages, as before a presentation's slides, the „Material“ tile – not a page: it stands above
 * the strip and stays while that scrolls.
 */
export function PageStrip({
  stage,
  onMaterial,
}: {
  stage: RefObject<HTMLElement | null>;
  /** „Material (M)“: the document's material page opens. */
  onMaterial: () => void;
}) {
  const { engine } = useWriter();
  const state = useWriterState();
  const { metrics, pages, layout } = state;
  const list = useRef<HTMLOListElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const bracket = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const drag = useRef<{ grab: number; x: number; y: number; moved: boolean } | null>(null);
  const scale = THUMB_WIDTH / metrics.width;
  const thumbHeight = Math.round(metrics.height * scale);
  const step = thumbHeight + THUMB_GAP;
  const stripHeight = 2 * STRIP_PAD + pages * step - THUMB_GAP;

  /** A height in the document (its own points) as one in the strip, and back. */
  const toStrip = (y: number) => {
    const page = Math.max(0, Math.min(pages - 1, Math.floor(y / metrics.pitch)));
    const within = Math.max(0, Math.min(metrics.height, y - page * metrics.pitch));
    return STRIP_PAD + page * step + (within / metrics.height) * thumbHeight;
  };
  const toDocument = (y: number) => {
    const page = Math.max(0, Math.min(pages - 1, Math.floor((y - STRIP_PAD) / step)));
    const within = Math.max(0, Math.min(1, (y - STRIP_PAD - page * step) / thumbHeight));
    return page * metrics.pitch + within * metrics.height;
  };
  /** The document's pages as they stand in the window. */
  const stack = () => stage.current?.querySelector<HTMLElement>('.writer-stack') ?? null;

  // Straight on the DOM: the bracket follows every frame of a scroll without a render.
  const place = useEffectEvent(() => {
    const frame = stage.current?.getBoundingClientRect();
    const box = stack()?.getBoundingClientRect();
    const mark = bracket.current;
    if (!frame || !box || !mark || box.height === 0) return;
    const total = pages * metrics.pitch;
    const at = (clientY: number) =>
      Math.max(0, Math.min(total, ((clientY - box.top) / box.height) * state.height));
    const top = at(frame.top);
    const bottom = at(frame.bottom);
    const all = top <= 0 && bottom >= total;
    const from = toStrip(top) - BRACKET_OUTSET;
    const to = toStrip(bottom) + BRACKET_OUTSET;
    mark.hidden = all;
    mark.style.transform = `translateY(${from}px)`;
    mark.style.height = `${Math.max(12, to - from)}px`;
    // The window's edges for `SheetDim`; the whole document in view dims nothing.
    list.current?.style.setProperty('--bracket-from', `${all ? -DIM_ALL : from}px`);
    list.current?.style.setProperty('--bracket-to', `${all ? DIM_ALL : to}px`);
    // The bracket stays in sight in a strip longer than the window.
    const rail = scroller.current;
    if (rail && !drag.current && !all) {
      if (from < rail.scrollTop) rail.scrollTop = Math.max(0, from - STRIP_PAD);
      else if (to > rail.scrollTop + rail.clientHeight)
        rail.scrollTop = to - rail.clientHeight + STRIP_PAD;
    }
  });
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const follow = rafThrottle(() => place());
    element.addEventListener('scroll', follow.schedule, { passive: true });
    const sizes = new ResizeObserver(follow.schedule);
    sizes.observe(element);
    const pagesBox = element.querySelector('.writer-stack');
    if (pagesBox) sizes.observe(pagesBox);
    return () => {
      element.removeEventListener('scroll', follow.schedule);
      sizes.disconnect();
      follow.cancel();
    };
  }, [stage]);
  useEffect(() => {
    place();
  }, [pages, metrics, state.height]);

  /** The document scrolls until this height of the strip stands in the window's middle. */
  const show = (stripY: number) => {
    const element = stage.current;
    const frame = element?.getBoundingClientRect();
    const box = stack()?.getBoundingClientRect();
    if (!element || !frame || !box) return;
    const y = box.top + (toDocument(stripY) / state.height) * box.height;
    element.scrollBy({ top: y - (frame.top + frame.height / 2) });
  };
  const stripY = (clientY: number) => {
    const box = list.current?.getBoundingClientRect();
    return box ? clientY - box.top : 0;
  };

  useEffect(() => {
    const draw = () => {
      const strip = list.current;
      if (!strip) return;
      const root = engine.view.root;
      const origin = root.getBoundingClientRect();
      const zoom = engine.scale;
      const sheets = [...strip.querySelectorAll<HTMLElement>('[data-sheet]')];
      const fills = sheets.map(() => document.createDocumentFragment());
      for (const child of root.children) {
        if (!(child instanceof HTMLElement)) continue;
        const box = child.getBoundingClientRect();
        const top = (box.top - origin.top) / zoom + metrics.top;
        const bottom = top + box.height / zoom;
        const from = Math.max(0, Math.floor(top / metrics.pitch));
        const to = Math.min(
          sheets.length - 1,
          Math.floor(Math.max(top, bottom - 1) / metrics.pitch),
        );
        for (let page = from; page <= to; page += 1) {
          const copy = child.cloneNode(true) as HTMLElement;
          copy.removeAttribute('data-picked');
          copy.style.position = 'absolute';
          copy.style.left = '0';
          copy.style.right = '0';
          copy.style.marginTop = '0';
          copy.style.top = `${top - page * metrics.pitch - metrics.top}px`;
          fills[page]?.append(copy);
        }
      }
      sheets.forEach((sheet, index) => {
        const flow = sheet.firstElementChild;
        const fill = fills[index];
        if (flow && fill) flow.replaceChildren(fill);
      });
    };
    if (first.current) {
      first.current = false;
      draw();
      return;
    }
    const timer = window.setTimeout(draw, REDRAW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [engine, layout, pages, metrics]);

  return (
    <>
      <div
        className="shrink-0"
        style={{
          width: THUMB_WIDTH,
          height: MATERIAL_TILE_H,
          marginTop: STRIP_INSET,
          marginLeft: STRIP_INSET,
        }}
      >
        <MaterialTile onOpen={onMaterial} />
      </div>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]"
        onPointerDown={(event) => {
          const mark = bracket.current;
          if (event.pointerType === 'touch' || event.button !== 0 || !mark || mark.hidden) return;
          const box = mark.getBoundingClientRect();
          if (event.clientY < box.top || event.clientY > box.bottom) return;
          // Grabbed where it is held: the bracket does not jump under the pointer.
          drag.current = {
            grab: event.clientY - (box.top + box.height / 2),
            x: event.clientX,
            y: event.clientY,
            moved: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const held = drag.current;
          if (!held) return;
          if (!held.moved && Math.hypot(event.clientX - held.x, event.clientY - held.y) < DRAG_FROM)
            return;
          held.moved = true;
          event.currentTarget.dataset.grab = 'drag';
          show(stripY(event.clientY - held.grab));
        }}
        onPointerUp={(event) => {
          const held = drag.current;
          drag.current = null;
          delete event.currentTarget.dataset.grab;
          if (!held || held.moved) return;
          // A plain click in the bracket leads to the page under it.
          const page = Math.floor((stripY(event.clientY) - STRIP_PAD + THUMB_GAP / 2) / step);
          engine.showPage(Math.max(0, Math.min(pages - 1, page)));
        }}
        onPointerCancel={(event) => {
          drag.current = null;
          delete event.currentTarget.dataset.grab;
        }}
      >
        <ol
          ref={list}
          aria-label="Seiten"
          className="relative flex flex-col"
          style={{
            width: THUMB_WIDTH,
            marginLeft: STRIP_INSET,
            height: stripHeight,
            padding: `${STRIP_PAD}px 0`,
            gap: THUMB_GAP,
          }}
        >
          {Array.from({ length: pages }, (_, index) => (
            <li key={index} className="shrink-0">
              <button
                type="button"
                data-page={index}
                aria-label={`Seite ${index + 1}`}
                onClick={() => engine.showPage(index)}
                className="focus-ring relative block overflow-hidden rounded-thumb"
                style={{ width: THUMB_WIDTH, height: thumbHeight }}
              >
                <span
                  data-sheet
                  className="writer-thumb relative block bg-white text-left"
                  style={{ width: metrics.width, height: metrics.height, zoom: scale }}
                >
                  <span
                    className="writer-flow"
                    style={{
                      display: 'block',
                      left: metrics.left,
                      top: metrics.top,
                      width: Math.max(40, metrics.width - metrics.left - metrics.right),
                    }}
                  />
                </span>
                <SheetDim y={STRIP_PAD + index * step} />
              </button>
            </li>
          ))}
          <div
            ref={bracket}
            aria-hidden
            data-page-bracket
            className="absolute top-0 cursor-grab border-[1.5px] border-fg-muted shadow-[0_0_0_1px_rgb(0_0_0/0.5),0_0_12px_var(--color-hairline)] will-change-transform [[data-grab=drag]_&]:cursor-grabbing"
            style={{
              left: -BRACKET_OUTSET,
              right: -BRACKET_OUTSET,
              borderRadius: `calc(var(--radius-thumb) + ${BRACKET_OUTSET}px)`,
            }}
          />
        </ol>
      </div>
    </>
  );
}

/**
 * Dims what of a sheet (at `y` in the strip) lies outside the bracket, still readable – a
 * presentation's `BracketDim` turned upright: a gradient from the edges `place` sets on the
 * strip, so a scroll moves it without a render.
 */
function SheetDim({ y }: { y: number }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        background: `linear-gradient(to bottom, var(--color-well-dark) calc(var(--bracket-from) - ${y}px), transparent calc(var(--bracket-from) - ${y}px) calc(var(--bracket-to) - ${y}px), var(--color-well-dark) calc(var(--bracket-to) - ${y}px))`,
      }}
    />
  );
}

/**
 * „1 / 12“ in the document's pill, a presentation's `SlideCounter`: the page in view. The number
 * is a field – a number and ↵ lead to that page, Esc puts it back.
 */
export function PageCounter({ current }: { current: number }) {
  const { engine } = useWriter();
  const { pages } = useWriterState();
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const position = Math.min(current + 1, pages);
  const shown = draft ?? String(position);
  const commit = () => {
    const target = draft === null ? Number.NaN : Number.parseInt(draft, 10);
    if (Number.isFinite(target)) engine.showPage(Math.max(1, Math.min(pages, target)) - 1);
    setDraft(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelled.current = true;
      event.currentTarget.blur();
    }
  };
  // Upright in the tools' column: the page typed into, its count under it.
  return (
    <span className="flex w-8 shrink-0 flex-col items-center text-sm leading-5 text-fg tabular-nums">
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        aria-label={`Aktuelle Seite, 1 bis ${pages}`}
        title="Zu Seite springen"
        maxLength={Math.max(3, String(pages).length)}
        value={shown}
        style={{ width: `calc(${Math.max(1, shown.length)}ch + 0.5rem)` }}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (cancelled.current) {
            cancelled.current = false;
            setDraft(null);
          } else commit();
        }}
        className="h-7 max-w-8 min-w-6 rounded-control bg-transparent px-1 text-center leading-5 text-fg transition-colors hover:bg-surface-2 focus:bg-hover focus-visible:outline-offset-0"
      />
      <span aria-hidden className="h-px w-3 bg-hairline-strong" />
      <span aria-hidden className="pt-0.5 pb-1 text-xs text-fg-muted">
        {pages}
      </span>
    </span>
  );
}

/** The words, as an icon and their number under it in the tools' column – „312 Wörter“ said. */
export function WordCount() {
  const { blocks } = useWriterState();
  const [words, setWords] = useState(() => countWords(blocks));
  useEffect(() => {
    const timer = window.setTimeout(() => setWords(countWords(blocks)), 400);
    return () => window.clearTimeout(timer);
  }, [blocks]);
  const said = pluralize(words, 'Wort', 'Wörter');
  return (
    <span
      role="status"
      aria-label={said}
      title={said}
      className="flex w-8 flex-col items-center gap-0.5 py-1 text-fg-muted"
    >
      <Icon name="notes" size={16} />
      <span className="text-[11px] leading-3 tabular-nums">{words.toLocaleString('de-DE')}</span>
    </span>
  );
}
