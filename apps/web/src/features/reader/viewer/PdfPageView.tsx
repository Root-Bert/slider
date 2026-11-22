import {
  memo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  readerFieldMarkId,
  type ReaderMark,
  type ReaderMarkBody,
  type ReaderRect,
} from '@slider/shared';
import {
  drawPage,
  drawTextLayer,
  type FormWidget,
  type PageSize,
  type PDFDocumentProxy,
} from '../lib/pdf';
import { useMarks, useReader } from './session';

/** What a click on the page does: the tools of the bar. */
export type Tool =
  | { kind: 'select' }
  | { kind: 'text' }
  | { kind: 'check' }
  | { kind: 'signature'; image: string; ratio: number }
  | { kind: 'comment' };

/** A mark drawn on the page behind its fields: a comment's place, a hit of the search. */
export interface PageMark {
  key: string;
  rect: ReaderRect;
  color: string;
  strong?: boolean;
}

type ItemMark = Exclude<ReaderMark, { kind: 'field' }>;

/** A page's rendered picture stays this long after it scrolled far away. */
const NEAR = '1200px 0px';
/** The words of a new box, in points of the page. */
export const TEXT_SIZE = 11;
const TICK = 14;
const SIGNATURE_WIDTH = 160;

const pct = (value: number) => `${value * 100}%`;
const boxStyle = (rect: ReaderRect): CSSProperties => ({
  left: pct(rect.x),
  top: pct(rect.y),
  width: pct(rect.w),
  height: pct(rect.h),
});
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export const PdfPageView = memo(function PdfPageView({
  doc,
  index,
  size,
  zoom,
  widgets,
  marks: pageMarks,
  tool,
  picked,
  onPick,
  onPlace,
  onComment,
  onTyped,
}: {
  doc: PDFDocumentProxy;
  index: number;
  size: PageSize;
  zoom: number;
  widgets: readonly FormWidget[];
  marks: readonly PageMark[];
  tool: Tool;
  picked: string | null;
  onPick: (id: string | null) => void;
  /** A click with a tool: what it put down, its id. */
  onPlace: (body: ReaderMarkBody) => void;
  /** An area dragged (or clicked) with the comment tool. */
  onComment: (page: number, rect: ReaderRect) => void;
  /** A field was typed into: its step closes once it is left. */
  onTyped: () => void;
}) {
  const { pdf, marks: store } = useReader();
  const { marks } = useMarks();
  const canEdit = pdf.permissions.canEdit;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(index < 3);
  const width = size.width * zoom;
  const height = size.height * zoom;

  // Drawn while near the window; the picture follows the size a moment after it rests.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      { rootMargin: NEAR },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    const timer = window.setTimeout(async () => {
      const page = await doc.getPage(index + 1);
      if (cancelled || !canvas.current) return;
      // Drawn into a canvas of its own, swapped in when done: no white flash while zooming.
      const fresh = document.createElement('canvas');
      task = drawPage(page, fresh, zoom);
      try {
        await task.promise;
      } catch {
        return;
      }
      const shown = canvas.current;
      if (cancelled || !shown) return;
      shown.width = fresh.width;
      shown.height = fresh.height;
      shown.getContext('2d')?.drawImage(fresh, 0, 0);
      if (text.current) await drawTextLayer(page, text.current, zoom).catch(() => {});
    }, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      task?.cancel();
    };
  }, [doc, index, zoom, near]);

  /** A point in the page as a fraction of it. */
  const at = (event: { clientX: number; clientY: number }) => {
    const frame = box.current!.getBoundingClientRect();
    return {
      x: clamp((event.clientX - frame.left) / frame.width),
      y: clamp((event.clientY - frame.top) / frame.height),
    };
  };

  // ── A tool at work: click to put down; the comment tool drags an area ─────
  const [lasso, setLasso] = useState<ReaderRect | null>(null);
  const lassoFrom = useRef<{ x: number; y: number; id: number } | null>(null);
  const onCatchDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const point = at(event);
    if (tool.kind === 'comment') {
      event.currentTarget.setPointerCapture(event.pointerId);
      lassoFrom.current = { ...point, id: event.pointerId };
      setLasso({ x: point.x, y: point.y, w: 0, h: 0 });
      return;
    }
    if (tool.kind === 'text') {
      const w = Math.min(200 / size.width, 1 - point.x);
      const h = (TEXT_SIZE * 1.6) / size.height;
      onPlace({
        kind: 'text',
        page: index,
        rect: { x: point.x, y: clamp(point.y - h / 2, 0, 1 - h), w, h },
        text: '',
        size: TEXT_SIZE,
      });
    } else if (tool.kind === 'check') {
      const w = TICK / size.width;
      const h = TICK / size.height;
      onPlace({
        kind: 'check',
        page: index,
        rect: { x: clamp(point.x - w / 2, 0, 1 - w), y: clamp(point.y - h / 2, 0, 1 - h), w, h },
      });
    } else if (tool.kind === 'signature') {
      const w = Math.min(SIGNATURE_WIDTH / size.width, 1);
      const h = Math.min(SIGNATURE_WIDTH / tool.ratio / size.height, 1);
      onPlace({
        kind: 'signature',
        page: index,
        rect: { x: clamp(point.x - w / 2, 0, 1 - w), y: clamp(point.y - h / 2, 0, 1 - h), w, h },
        image: tool.image,
      });
    }
  };
  const onCatchMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const from = lassoFrom.current;
    if (from?.id !== event.pointerId) return;
    const point = at(event);
    setLasso({
      x: Math.min(from.x, point.x),
      y: Math.min(from.y, point.y),
      w: Math.abs(point.x - from.x),
      h: Math.abs(point.y - from.y),
    });
  };
  const onCatchUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const from = lassoFrom.current;
    if (from?.id !== event.pointerId) return;
    lassoFrom.current = null;
    const area = lasso;
    setLasso(null);
    if (!area) return;
    // A click is a point: a small square around it.
    const tiny = area.w * width < 6 && area.h * height < 6;
    const side = 18;
    onComment(
      index,
      tiny
        ? {
            x: clamp(area.x - side / 2 / width, 0, 1 - side / width),
            y: clamp(area.y - side / 2 / height, 0, 1 - side / height),
            w: side / width,
            h: side / height,
          }
        : area,
    );
  };

  const onPage = marks.filter(
    (mark): mark is ItemMark => mark.page === index && mark.kind !== 'field',
  );
  const placing = tool.kind !== 'select';

  return (
    <div
      ref={box}
      className="reader-page"
      data-page={index}
      style={{ width, height, '--total-scale-factor': zoom } as CSSProperties}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget || event.target === canvas.current) onPick(null);
      }}
    >
      <canvas ref={canvas} aria-hidden />
      <div ref={text} className="textLayer" />
      <div className="reader-marks" aria-hidden>
        {pageMarks.map((mark) => (
          <span
            key={mark.key}
            style={{
              ...boxStyle(mark.rect),
              backgroundColor: mark.color,
              outline: mark.strong ? '1.5px solid var(--selection)' : undefined,
            }}
          />
        ))}
      </div>
      {widgets.map((widget, order) => (
        <Field
          key={`${widget.name}:${order}`}
          widget={widget}
          zoom={zoom}
          pageHeight={size.height}
          mark={store.get(readerFieldMarkId(widget.name))}
          disabled={!canEdit || widget.readOnly || placing}
          onTyped={onTyped}
        />
      ))}
      {onPage.map((mark) => (
        <Item
          key={mark.id}
          mark={mark}
          zoom={zoom}
          size={size}
          page={box}
          canEdit={canEdit && !placing}
          picked={picked === mark.id}
          onPick={onPick}
          onTyped={onTyped}
        />
      ))}
      {placing && (
        <div
          className="reader-catch"
          style={{ cursor: tool.kind === 'text' ? 'text' : 'crosshair' }}
          onPointerDown={onCatchDown}
          onPointerMove={onCatchMove}
          onPointerUp={onCatchUp}
          onPointerCancel={() => {
            lassoFrom.current = null;
            setLasso(null);
          }}
        >
          {lasso && <div className="reader-lasso" style={boxStyle(lasso)} />}
        </div>
      )}
    </div>
  );
});

/** One of the file's own fields, as an input of ours over its place. */
function Field({
  widget,
  zoom,
  pageHeight,
  mark,
  disabled,
  onTyped,
}: {
  widget: FormWidget;
  zoom: number;
  pageHeight: number;
  mark: ReaderMark | undefined;
  disabled: boolean;
  onTyped: () => void;
}) {
  const { marks } = useReader();
  const id = readerFieldMarkId(widget.name);
  const value = mark?.kind === 'field' ? mark.value : widget.initial;
  const filled = mark !== undefined;
  const set = (next: string | boolean, typing = false) =>
    marks.set(id, { kind: 'field', page: widget.page, name: widget.name, value: next }, { typing });
  const boxHeight = widget.rect.h * pageHeight;
  // As the export sets „fit to the box“ (`fillField` in pdf-bake.ts).
  const fontSize =
    (widget.fontSize > 0
      ? widget.fontSize * pageHeight
      : widget.multiLine
        ? 10
        : Math.max(6, Math.min(12, boxHeight * 0.6))) * zoom;
  const style: CSSProperties = {
    ...boxStyle(widget.rect),
    fontSize,
    textAlign: widget.align,
  };
  const common = {
    className: 'reader-field',
    style,
    disabled,
    'aria-label': widget.label ?? widget.name,
    title: widget.label ?? widget.name,
    'data-filled': filled || undefined,
  };

  if (widget.type === 'checkbox') {
    return (
      <input
        {...common}
        type="checkbox"
        data-kind="check"
        checked={value === true || (typeof value === 'string' && value !== '' && value !== 'Off')}
        onChange={(event) => set(event.target.checked)}
      />
    );
  }
  if (widget.type === 'radio') {
    return (
      <input
        {...common}
        type="radio"
        data-kind="check"
        data-round
        name={`reader:${widget.name}`}
        checked={value === widget.onValue}
        onChange={() => set(widget.onValue ?? '')}
        // A picked one clicked again is taken back, as on paper.
        onClick={() => {
          if (value === widget.onValue) set('');
        }}
      />
    );
  }
  if (widget.type === 'choice') {
    const current = typeof value === 'string' ? value : '';
    return (
      <select {...common} value={current} onChange={(event) => set(event.target.value)}>
        {!widget.options?.some((option) => option.value === current) && (
          <option value={current}>{current}</option>
        )}
        {widget.options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  const textValue = typeof value === 'string' ? value : '';
  return widget.multiLine ? (
    <textarea
      {...common}
      value={textValue}
      maxLength={widget.maxLen}
      onChange={(event) => set(event.target.value, true)}
      onBlur={onTyped}
    />
  ) : (
    <input
      {...common}
      type="text"
      value={textValue}
      maxLength={widget.maxLen}
      onChange={(event) => set(event.target.value, true)}
      onBlur={onTyped}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onTyped();
          focusNext(event.currentTarget);
        }
      }}
    />
  );
}

/** ↵ in a one-line field goes on to the next, as Tab does. */
function focusNext(from: HTMLElement) {
  const all = [...document.querySelectorAll<HTMLElement>('.reader-field:not(:disabled)')];
  all[all.indexOf(from) + 1]?.focus();
}

type Drag = {
  pointerId: number;
  mode: 'move' | 'nw' | 'ne' | 'sw' | 'se';
  start: { x: number; y: number };
  rect: ReaderRect;
  moved: boolean;
};

/** Words, a tick or a signature put onto the page: picked, moved, sized, typed into. */
function Item({
  mark,
  zoom,
  size,
  page,
  canEdit,
  picked,
  onPick,
  onTyped,
}: {
  mark: ItemMark;
  zoom: number;
  size: PageSize;
  page: React.RefObject<HTMLDivElement | null>;
  canEdit: boolean;
  picked: boolean;
  onPick: (id: string | null) => void;
  onTyped: () => void;
}) {
  const { marks } = useReader();
  const [live, setLive] = useState<ReaderRect | null>(null);
  const drag = useRef<Drag | null>(null);
  const words = useRef<HTMLTextAreaElement>(null);
  const rect = live ?? mark.rect;
  const { id: _id, author: _author, updatedAt: _at, ...body } = mark;

  // A new box of words takes the keys at once.
  useEffect(() => {
    if (picked && mark.kind === 'text' && mark.text === '') words.current?.focus();
  }, [picked, mark]);

  const begin = (event: ReactPointerEvent<HTMLElement>, mode: Drag['mode']) => {
    if (!canEdit || event.button !== 0) return;
    event.stopPropagation();
    onPick(mark.id);
    // Into the words: the caret goes there, the box stays.
    if (mode === 'move' && mark.kind === 'text' && event.target === words.current && picked) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      mode,
      start: { x: event.clientX, y: event.clientY },
      rect: mark.rect,
      moved: false,
    };
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    const frame = page.current?.getBoundingClientRect();
    if (current?.pointerId !== event.pointerId || !frame) return;
    const dx = (event.clientX - current.start.x) / frame.width;
    const dy = (event.clientY - current.start.y) / frame.height;
    if (!current.moved && Math.abs(dx * frame.width) < 2 && Math.abs(dy * frame.height) < 2) return;
    current.moved = true;
    const from = current.rect;
    if (current.mode === 'move') {
      setLive({
        ...from,
        x: clamp(from.x + dx, 0, 1 - from.w),
        y: clamp(from.y + dy, 0, 1 - from.h),
      });
      return;
    }
    const min = 8 / Math.min(frame.width, frame.height);
    let { x, y, h } = from;
    let w: number;
    const east = current.mode.endsWith('e');
    const south = current.mode.startsWith('s');
    if (mark.kind === 'text') {
      // Words: wider or narrower, as high as they need.
      w = clamp(east ? from.w + dx : from.w - dx, min, east ? 1 - from.x : from.x + from.w);
      if (!east) x = from.x + from.w - w;
    } else {
      // A tick and a signature keep their shape.
      const ratio = from.w / from.h;
      const grow = east ? dx : -dx;
      w = clamp(from.w + grow, min, 1);
      h = w / ratio;
      if (!east) x = from.x + from.w - w;
      if (!south) y = from.y + from.h - h;
      if (x < 0 || y < 0 || x + w > 1 || y + h > 1) return;
    }
    setLive({ x, y, w, h });
  };
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (current.moved && live) marks.set(mark.id, { ...body, rect: live } as ReaderMarkBody);
    setLive(null);
  };

  // Words grow downwards as they are typed.
  const fit = () => {
    const area = words.current;
    if (!area || mark.kind !== 'text') return;
    area.style.height = '0px';
    const needed = area.scrollHeight / zoom / size.height;
    area.style.height = '';
    if (Math.abs(needed - mark.rect.h) > 0.002) {
      return clamp(needed, 0, 1 - mark.rect.y);
    }
    return undefined;
  };

  const handles = picked && canEdit ? (['nw', 'ne', 'sw', 'se'] as const) : [];
  return (
    <div
      className="reader-item"
      data-movable={canEdit || undefined}
      data-picked={picked || undefined}
      data-mark={mark.id}
      style={boxStyle(rect)}
      onPointerDown={(event) => begin(event, 'move')}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {mark.kind === 'signature' && <img src={mark.image} alt="Unterschrift" draggable={false} />}
      {mark.kind === 'check' && (
        <svg viewBox="0 0 24 24" aria-label="Haken">
          <path
            d="M3 12.5l6 6L21 6"
            fill="none"
            stroke="#000"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {mark.kind === 'text' && (
        <textarea
          ref={words}
          className="reader-words"
          aria-label="Text auf der Seite"
          placeholder={picked ? 'Text' : undefined}
          readOnly={!canEdit}
          tabIndex={canEdit ? 0 : -1}
          value={mark.text}
          rows={1}
          style={{ fontSize: mark.size * zoom, cursor: picked ? 'text' : undefined }}
          onFocus={() => onPick(mark.id)}
          onChange={(event) => {
            const h = fit();
            marks.set(
              mark.id,
              {
                ...body,
                text: event.target.value,
                ...(h !== undefined && { rect: { ...mark.rect, h } }),
              } as ReaderMarkBody,
              { typing: true },
            );
          }}
          onBlur={() => {
            onTyped();
            // Words that were never written leave no empty box behind.
            const now = marks.get(mark.id);
            if (now?.kind === 'text' && now.text.trim() === '') marks.set(mark.id, null);
          }}
        />
      )}
      {handles.map((corner) => (
        <span
          key={corner}
          className="reader-handle"
          style={{
            left: corner.endsWith('w') ? 0 : '100%',
            top: corner.startsWith('n') ? 0 : '100%',
            cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize',
          }}
          onPointerDown={(event) => begin(event, corner)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      ))}
    </div>
  );
}
