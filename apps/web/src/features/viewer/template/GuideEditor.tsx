import { TEMPLATE_MAX_GUIDES, type Guide } from '@slider/shared';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { GUIDE_COLORS } from '@/lib/palette';
import { cn } from '@/ui';
import { useEditing } from '../editing/editing-context';
import { useViewerToast } from '../state/viewer-toast';
import { useLayoutGuides } from './useTemplate';
import { sameGuide } from './guide-geometry';
import { useLayoutGridLines } from './useLayoutGridLines';

/**
 * How close (screen pixels) a guide is caught at the slide's middle, an element's edge or – in
 * „Layout-Ansicht“ – a column's or row's edge.
 */
const SNAP_PX = 6;
/** Moved less than this (screen pixels) between press and let go, it was a click, not a drag. */
const CLICK_PX = 3;

/** A guide being placed: a new one (`index` null) or one of the template's, moved. */
interface Dragged {
  index: number | null;
  guide: Guide;
  /** Let go here, it goes: dragged off the slide. */
  off: boolean;
  /** Where it was pressed, to tell a click from a drag. */
  start: { x: number; y: number };
  moved: boolean;
}

/**
 * „Hilfslinien setzen“ (the guides tool while designing a template): a click puts a vertical guide
 * where it is, with ⇧ a horizontal one; a guide dragged moves; clicked, or dragged off the slide,
 * it goes. Caught at the slide's middle, at the elements' edges and centres and, with
 * „Layout-Ansicht“ on, at the edges of the layout grid's columns and rows. The guides are the
 * layout's own – each layout of the template has its own – saved with it (`Deck.template`).
 */
export function GuideEditor({ slideId }: { slideId: string }) {
  const editing = useEditing();
  const layout = useLayoutGuides(slideId);
  const toast = useViewerToast();
  const gridLines = useLayoutGridLines();
  const ref = useRef<HTMLDivElement>(null);
  // Under the pointer, either way: ⇧ picks the horizontal one.
  const [hover, setHover] = useState<Record<Guide['orientation'], Guide> | null>(null);
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const [shift, setShift] = useState(false);
  const guides = layout?.guides ?? [];
  const update = ({ guides: next }: { guides: Guide[] }) => layout?.set(next);

  // ⇧ turns the guide under the pointer at once, not only on the next move; Esc puts the tool away.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      setShift(event.shiftKey);
      if (event.type === 'keydown' && event.key === 'Escape' && !event.defaultPrevented) {
        editing.setTool('select');
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [editing]);

  /** Where the pointer is on the slide (not clamped: off it is past 0 or 1), and the slide's size. */
  const pointOf = (event: { clientX: number; clientY: number }) => {
    const box = ref.current!.getBoundingClientRect();
    return {
      x: (event.clientX - box.left) / Math.max(1, box.width),
      y: (event.clientY - box.top) / Math.max(1, box.height),
      width: box.width,
      height: box.height,
    };
  };
  /** A guide at the pointer, caught at what lies close. */
  const guideAt = (
    event: { clientX: number; clientY: number },
    orientation: Guide['orientation'],
  ): { guide: Guide; off: boolean } => {
    const point = pointOf(event);
    const vertical = orientation === 'vertical';
    const value = vertical ? point.x : point.y;
    const tolerance = SNAP_PX / (vertical ? point.width : point.height);
    const targets = [0.5, ...((vertical ? gridLines?.x : gridLines?.y) ?? [])];
    for (const { bbox } of editing.elementsOf(slideId)) {
      const [start, size] = vertical ? [bbox.x, bbox.w] : [bbox.y, bbox.h];
      targets.push(start, start + size / 2, start + size);
    }
    let position = value;
    let best = tolerance;
    for (const target of targets) {
      const distance = Math.abs(target - value);
      if (distance < best && target >= 0 && target <= 1) {
        position = target;
        best = distance;
      }
    }
    const off = value < 0 || value > 1;
    position = Math.round(Math.min(1, Math.max(0, position)) * 10000) / 10000;
    return { guide: { orientation, position }, off };
  };

  const startDrag = (event: PointerEvent<HTMLElement>, index: number | null) => {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    event.stopPropagation();
    ref.current?.setPointerCapture(event.pointerId);
    const orientation =
      index === null ? (event.shiftKey ? 'horizontal' : 'vertical') : guides[index]!.orientation;
    setDragged({
      index,
      ...guideAt(event, orientation),
      start: { x: event.clientX, y: event.clientY },
      moved: false,
    });
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return;
    if (dragged) {
      const moved =
        dragged.moved ||
        Math.hypot(event.clientX - dragged.start.x, event.clientY - dragged.start.y) > CLICK_PX;
      setDragged({ ...dragged, ...guideAt(event, dragged.guide.orientation), moved });
      return;
    }
    // Over a guide of its own, no new one is shown.
    const overGuide = (event.target as Element).closest('[data-guide]');
    setShift(event.shiftKey);
    setHover(
      overGuide
        ? null
        : {
            vertical: guideAt(event, 'vertical').guide,
            horizontal: guideAt(event, 'horizontal').guide,
          },
    );
  };
  const onPointerUp = () => {
    if (!dragged) return;
    setDragged(null);
    const { index, guide, off, moved } = dragged;
    const others = guides.filter((_, at) => at !== index);
    if (!moved) {
      // A click on a guide already there takes it away.
      const at = index ?? guides.findIndex((other) => sameGuide(other, guide));
      if (at >= 0) {
        update({ guides: guides.filter((_, i) => i !== at) });
        return;
      }
    }
    if (off) {
      if (index !== null) update({ guides: others });
      return;
    }
    if (others.some((other) => sameGuide(other, guide))) {
      // Onto one already there: the two become one.
      if (index !== null) update({ guides: others });
      return;
    }
    if (index === null && guides.length >= TEMPLATE_MAX_GUIDES) {
      toast(`Ein Layout hat höchstens ${TEMPLATE_MAX_GUIDES} Hilfslinien.`, 'neutral');
      return;
    }
    update({
      guides:
        index === null ? [...guides, guide] : guides.map((g, at) => (at === index ? guide : g)),
    });
  };
  const cm = (guide: Guide) =>
    `${(guide.position * (guide.orientation === 'vertical' ? editing.pageSize.width : editing.pageSize.height)).toFixed(2).replace('.', ',')} cm`;

  return (
    <div
      ref={ref}
      data-guide-editor={slideId}
      className="absolute inset-0 z-(--z-raised) cursor-crosshair touch-none"
      onPointerDown={(event) => startDrag(event, null)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDragged(null)}
      onPointerLeave={() => setHover(null)}
      // The slide's own clicks (letting go, comments) stay out of it.
      onClick={(event) => event.stopPropagation()}
    >
      {guides.map((guide, index) =>
        index === dragged?.index ? null : (
          <GuideLine
            key={`${index}:${guide.orientation}:${guide.position}`}
            guide={guide}
            title={`${cm(guide)} – ziehen verschiebt, Klick oder aus der Folie ziehen entfernt`}
            onPointerDown={(event) => startDrag(event, index)}
          />
        ),
      )}
      {dragged && (
        <GuideLine guide={dragged.guide} active faded={dragged.off}>
          {dragged.off ? 'Loslassen entfernt' : cm(dragged.guide)}
        </GuideLine>
      )}
      {!dragged && hover && <GuideLine guide={shift ? hover.horizontal : hover.vertical} faded />}
    </div>
  );
}

function GuideLine({
  guide,
  active = false,
  faded = false,
  title,
  onPointerDown,
  children,
}: {
  guide: Guide;
  active?: boolean;
  faded?: boolean;
  title?: string;
  onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
  children?: string;
}) {
  const horizontal = guide.orientation === 'horizontal';
  const grabbable = !!onPointerDown;
  return (
    // A band wider than the line, to take hold of it.
    <div
      data-guide={grabbable ? '' : undefined}
      title={title}
      className={cn(
        'absolute flex items-center justify-center',
        horizontal ? 'inset-x-0 h-2.5 -translate-y-1/2' : 'inset-y-0 w-2.5 -translate-x-1/2',
        grabbable
          ? horizontal
            ? 'group cursor-row-resize'
            : 'group cursor-col-resize'
          : 'pointer-events-none',
      )}
      style={{ [horizontal ? 'top' : 'left']: `${guide.position * 100}%` }}
      onPointerDown={onPointerDown}
    >
      <div
        className={cn(
          horizontal ? 'h-px w-full' : 'h-full w-px',
          faded ? 'opacity-50' : 'opacity-90',
          (active || grabbable) && (horizontal ? 'group-hover:h-0.5' : 'group-hover:w-0.5'),
          active && (horizontal ? 'h-0.5' : 'w-0.5'),
        )}
        style={{ backgroundColor: GUIDE_COLORS.guide }}
      />
      {children && (
        <span
          className={cn(
            'absolute rounded-full px-1.5 py-0.5 text-caption leading-tight font-medium',
            'whitespace-nowrap text-white tabular-nums shadow-mark',
            horizontal ? 'left-3 -translate-y-full' : 'top-3 translate-x-1/2',
          )}
          style={{ backgroundColor: GUIDE_COLORS.guide }}
        >
          {children}
        </span>
      )}
    </div>
  );
}
