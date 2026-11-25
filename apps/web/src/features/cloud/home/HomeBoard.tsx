import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
  type Announcements,
  type DragStartEvent,
} from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';
import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { isTextTarget } from '@/lib/dom';
import { Button, cn, Icon } from '@/ui';
import type { CloudSelection } from '../components/CloudPage';
import { useCloud } from '../hooks/useCloud';
import { HomeCustomize } from './HomeCustomize';
import {
  addWidget,
  changeWidget,
  DEFAULT_LAYOUT,
  MAX_ROWS,
  moveWidget,
  nearestWidth,
  newWidget,
  removeWidget,
  spanOf,
  useHomeLayout,
  type HomeLayout,
  type Widget,
  type WidgetLook,
  type NewDragData,
  type WidgetType,
} from './layout';
import { FrameContext, HomePageContext, useAvailable, WIDGET_INFO, WIDGET_VIEWS } from './widgets';

/** One row of a widget's height, the gap below it included – and the gap between widgets. */
export const ROW_PX = 72;
const GAP_PX = 24;
/**
 * The grid's own rows: fine, so a widget as high as its content takes just that (rounded to
 * these), the gap carried in each widget's foot. Twelve columns where the page is wide.
 */
const STEP_PX = 4;
/** A mouse moves this far before a press is a drag; a finger rests this long (and moves less). */
const DRAG_PX = 4;
const TOUCH_DELAY_MS = 250;
const TOUCH_TOLERANCE_PX = 8;
/** How near the scrolling box's edge a drag scrolls it, and how fast at the edge. */
const SCROLL_EDGE_PX = 64;
const SCROLL_SPEED = 16;

const LOOKS: Record<WidgetLook, string> = {
  none: '',
  glass: 'glass rounded-panel p-4',
  fill: 'bg-surface-1 rounded-panel p-4',
  line: 'ring-hairline-strong rounded-panel p-4',
};

/** Twelve columns on a wide page, six on a tablet, one on a phone. */
/**
 * The page left beside the panel (400 px and its 12 px from the edge) must be this wide, else the
 * panel is a sheet below (a phone, a tablet, a narrow window).
 */
const ROOM_BESIDE_PX = 640;
const PANEL_PX = 412;

function columnsFor(width: number) {
  if (width >= 960) return 12;
  if (width >= 560) return 6;
  return 1;
}

type Drag = { kind: 'move'; id: string } | { kind: 'new'; type: WidgetType; id: string };

type Resize = { id: string; left: number; top: number };

/**
 * „Zuletzt“'s widgets – and, while they are being arranged (`editing`), dragged about, made
 * larger by their corner, picked to change in the panel beside, taken off; new ones are dragged
 * in from the panel or put at the end with a click.
 */
export function HomeBoard({
  selection,
  editing,
  onEdit,
}: {
  selection: CloudSelection;
  editing: boolean;
  onEdit: (editing: boolean) => void;
}) {
  const ui = useCloud();
  const available = useAvailable();
  const [stored, setStored] = useHomeLayout(ui.userId, ui.workspace.id);
  const layout = stored.filter((widget) => available(widget.type));
  // While something is dragged or stretched: how the page looks if it is let go now.
  const [draft, setDraft] = useState<HomeLayout | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const shown = draft ?? layout;
  const gridRef = useRef<HTMLDivElement>(null);
  const boxes = useRef(new Map<string, HTMLElement>());
  const [columns, setColumns] = useState(12);
  const [sheet, setSheet] = useState(false);
  // The grid's width now, and as it is on the page (frozen while arranging).
  const [gridWidth, setGridWidth] = useState(0);
  const [pageWidth, setPageWidth] = useState(0);

  const save = (next: HomeLayout) => setStored(next);
  // Only while arranging is anything picked.
  const pickedWidget = (editing && layout.find((widget) => widget.id === picked)) || null;

  useLayoutEffect(() => {
    // While it is arranged the panel takes 400 px beside: the columns stay as they were, so what
    // one arranges is the page one sees after.
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const width = grid.clientWidth;
      setGridWidth(width);
      if (editing) return;
      setPageWidth(width);
      setColumns(columnsFor(width));
      setSheet(width - PANEL_PX < ROOM_BESIDE_PX);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [editing]);

  /* ----- Dragging (a widget on the page, or a new one from the panel) ----- */

  // dnd-kit starts, follows and ends a drag – a mouse after a few pixels, a finger after resting a
  // moment (before that the page scrolls), Esc gives up, the click a drag ends with is no click.
  // Where it goes and the page's scrolling are ours: the grid is in order, not in x/y.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: DRAG_PX } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: TOUCH_DELAY_MS, tolerance: TOUCH_TOLERANCE_PX },
    }),
  );
  const pointer = useRef({ x: 0, y: 0 });
  // The same as `drag` and `draft`, for the listeners of one drag.
  const dragRef = useRef<Drag | null>(null);
  const draftRef = useRef<HomeLayout | null>(null);
  const putDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };
  const putDraft = (next: HomeLayout | null) => {
    draftRef.current = next;
    setDraft(next);
  };
  const [resizing, setResizing] = useState(false);
  const stopFollowing = useRef<(() => void) | null>(null);

  // Where the boxes stood when the drag began, and how far the page was scrolled then: the place
  // is found on those – the page flowing anew under the pointer would swing it back and forth.
  const startRects = useRef<{ rects: Map<string, DOMRect>; scroll: number } | null>(null);
  const scrollerOf = (): HTMLElement | null =>
    gridRef.current?.closest<HTMLElement>('.overflow-y-auto') ??
    (document.scrollingElement as HTMLElement | null);
  const rectOf = (id: string): DOMRect | undefined => {
    const start = startRects.current;
    const rect = start?.rects.get(id);
    if (!start || !rect) return undefined;
    const shift = start.scroll - (scrollerOf()?.scrollTop ?? 0);
    return new DOMRect(rect.x, rect.y + shift, rect.width, rect.height);
  };

  // The panel stands over the page (a phone's sheet over its lower half): what is over it is not
  // on the page.
  const panelRect = () => document.querySelector('[data-side-panel]')?.getBoundingClientRect();

  /** Where in the list (without the dragged one) the pointer means: before or after the nearest. */
  const placeAt = (x: number, y: number, without: string, list: HomeLayout): number | null => {
    const grid = gridRef.current;
    if (!grid) return null;
    const area = grid.getBoundingClientRect();
    const reach = 48;
    if (x < area.left - reach || x > area.right + reach || y < area.top - reach) return null;
    if (y > area.bottom + reach * 3) return null;
    const panel = panelRect();
    if (panel && x >= panel.left && x <= panel.right && y >= panel.top && y <= panel.bottom)
      return null;
    const rest = list.filter((widget) => widget.id !== without);
    if (rest.length === 0) return 0;
    // Over where it stood at first: back there.
    const own = rectOf(without);
    if (own && x >= own.left && x <= own.right && y >= own.top && y <= own.bottom)
      return layout.findIndex((widget) => widget.id === without);
    let best: { index: number; rect: DOMRect; distance: number } | null = null;
    rest.forEach((widget, index) => {
      const rect = rectOf(widget.id);
      if (!rect) return;
      const dx = Math.max(rect.left - x, 0, x - rect.right);
      const dy = Math.max(rect.top - y, 0, y - rect.bottom);
      const distance = Math.hypot(dx, dy);
      if (!best || distance < best.distance) best = { index, rect, distance };
    });
    if (!best) return rest.length;
    const { index, rect } = best as { index: number; rect: DOMRect };
    // Below everything: at the end.
    if (y > area.bottom) return rest.length;
    // A wide one is before or after by height, the others by side.
    const after =
      rect.width > area.width * 0.6
        ? y > rect.top + rect.height / 2
        : x > rect.left + rect.width / 2;
    return index + (after ? 1 : 0);
  };

  const follow = () => {
    const current = dragRef.current;
    const list = draftRef.current;
    if (!current || !list) return;
    const at = placeAt(pointer.current.x, pointer.current.y, current.id, list);
    const has = list.some((widget) => widget.id === current.id);
    if (at === null) {
      // Out of the page: a new one is not put in; a moved one stays where it was shown last.
      if (current.kind === 'new' && has) putDraft(removeWidget(list, current.id));
      return;
    }
    if (current.kind === 'new' && !has) {
      putDraft(addWidget(list, newWidget(current.type, current.id), at));
      return;
    }
    if (list.findIndex((widget) => widget.id === current.id) !== at)
      putDraft(moveWidget(list, current.id, at));
  };

  // Near the scrolling box's edge the page scrolls under the drag – ours, as dnd-kit scrolls only
  // what holds the dragged thing (for a new one: the panel's list).
  useEffect(() => {
    if (!drag) return;
    const scroller = scrollerOf();
    if (!scroller) return;
    let frame = 0;
    const tick = () => {
      const box =
        scroller === document.scrollingElement
          ? new DOMRect(0, 0, window.innerWidth, window.innerHeight)
          : scroller.getBoundingClientRect();
      const { x, y } = pointer.current;
      // A sheet across the page's foot (a phone): the page ends at its top.
      const panel = panelRect();
      const bottom =
        panel && x >= panel.left && x <= panel.right && panel.top > box.top
          ? Math.min(box.bottom, panel.top)
          : box.bottom;
      const up = box.top + SCROLL_EDGE_PX - y;
      // Over the sheet itself (a new one just picked up there) nothing scrolls – only the band above.
      const down = y > bottom ? 0 : y - (bottom - SCROLL_EDGE_PX);
      const step =
        up > 0
          ? -Math.ceil((Math.min(up, SCROLL_EDGE_PX) / SCROLL_EDGE_PX) * SCROLL_SPEED)
          : down > 0
            ? Math.ceil((Math.min(down, SCROLL_EDGE_PX) / SCROLL_EDGE_PX) * SCROLL_SPEED)
            : 0;
      if (step !== 0) {
        scroller.scrollTop += step;
        follow();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs while a drag lasts
  }, [!!drag]);

  const finish = (drop: boolean) => {
    const current = dragRef.current;
    const final = draftRef.current;
    if (drop && current && final?.some((widget) => widget.id === current.id)) {
      save(final);
      setPicked(current.id);
    }
    stopFollowing.current?.();
    stopFollowing.current = null;
    startRects.current = null;
    putDrag(null);
    putDraft(null);
  };

  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const data = active.data.current as NewDragData | undefined;
    const drag: Drag = data?.type
      ? { kind: 'new', type: data.type, id: newWidget(data.type).id }
      : { kind: 'move', id: String(active.id) };
    pointer.current = getEventCoordinates(activatorEvent) ?? pointer.current;
    startRects.current = {
      rects: new Map([...boxes.current].map(([id, box]) => [id, box.getBoundingClientRect()])),
      scroll: scrollerOf()?.scrollTop ?? 0,
    };
    putDrag(drag);
    putDraft(layout);
    // The pointer itself (dnd-kit's delta carries the scrolling in it).
    const onMouse = (event: MouseEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      follow();
    };
    const onTouch = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      pointer.current = { x: touch.clientX, y: touch.clientY };
      follow();
    };
    window.addEventListener('mousemove', onMouse);
    window.addEventListener('touchmove', onTouch, { passive: true });
    stopFollowing.current = () => {
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('touchmove', onTouch);
    };
    follow();
  };

  const labelOf = (id: string | number) => {
    const text = String(id);
    const type = text.startsWith('new:')
      ? (text.slice(4) as WidgetType)
      : layout.find((widget) => widget.id === text)?.type;
    return type ? WIDGET_INFO[type].label : 'Widget';
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${labelOf(active.id)} aufgenommen.`,
    onDragOver: () => undefined,
    onDragEnd: ({ active }) => `${labelOf(active.id)} abgelegt.`,
    onDragCancel: ({ active }) => `${labelOf(active.id)} zurückgelegt.`,
  };

  /* ----- Stretching by the corner ----- */

  const resizeRef = useRef<Resize | null>(null);
  const pressCorner = (event: ReactPointerEvent, widget: Widget) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    // A finger keeps it too (with `touch-none` on the grip the page does not scroll instead).
    event.currentTarget.setPointerCapture(event.pointerId);
    const box = boxes.current.get(widget.id)?.getBoundingClientRect();
    const grid = gridRef.current?.getBoundingClientRect();
    if (!box || !grid) return;
    resizeRef.current = { id: widget.id, left: box.left, top: box.top };
    setPicked(widget.id);
    setResizing(true);
    let last: HomeLayout = layout;
    const move = (e: PointerEvent) => {
      const at = resizeRef.current;
      if (!at) return;
      const twelfths = (12 * (e.clientX - at.left + GAP_PX / 2)) / (grid.width + GAP_PX);
      const rows = Math.round((e.clientY - at.top + GAP_PX) / ROW_PX);
      last = changeWidget(layout, widget.id, {
        ...(columns > 1 ? { w: nearestWidth(twelfths) } : {}),
        h: Math.max(1, Math.min(MAX_ROWS, rows)),
      });
      setDraft(last);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      resizeRef.current = null;
      save(last);
      setDraft(null);
      setResizing(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  /* ----- Keys while arranging ----- */

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    // While a corner is held its letting go decides – ⌫ now would come back with it.
    if (!editing || event.defaultPrevented || dragRef.current || resizeRef.current) return;
    if (isTextTarget(event.target) || document.querySelector('dialog[open], [role="menu"]')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (pickedWidget) setPicked(null);
      else onEdit(false);
      return;
    }
    if (!pickedWidget) return;
    // On a control of the panel its own keys win (a segmented choice steps with the arrows).
    const target = event.target as Element | null;
    if (target?.closest?.('[data-side-panel] button, [data-side-panel] [role="radio"]')) return;
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      save(removeWidget(layout, pickedWidget.id));
      setPicked(null);
    } else if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const index = layout.findIndex((widget) => widget.id === pickedWidget.id);
      const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      save(moveWidget(layout, pickedWidget.id, index + step));
    }
  });
  // A press beside every widget and the panel lets go of the picked one (as Figma's empty canvas).
  const onPressAway = useEffectEvent((event: PointerEvent) => {
    if (!editing || !pickedWidget) return;
    const target = event.target as Element | null;
    if (
      target?.closest?.('[data-widget], [data-side-panel], [role="menu"], [role="dialog"], dialog')
    )
      return;
    setPicked(null);
  });
  useEffect(() => {
    const listener = (event: PointerEvent) => onPressAway(event);
    window.addEventListener('pointerdown', listener, true);
    return () => window.removeEventListener('pointerdown', listener, true);
  }, []);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    // Before the page's own (⌫ deletes picked files, ↑/↓ step through them).
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, []);

  /* ----- Changing one ----- */

  const change = (id: string, patch: Partial<Omit<Widget, 'id' | 'type'>>) =>
    save(changeWidget(layout, id, patch));
  const add = (type: WidgetType) => {
    const widget = newWidget(type);
    save(addWidget(layout, widget));
    setPicked(widget.id);
    requestAnimationFrame(() =>
      boxes.current.get(widget.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
  };
  const show = (id: string) => {
    setPicked(id);
    boxes.current.get(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const reset = () => {
    const before = stored;
    save(DEFAULT_LAYOUT);
    setPicked(null);
    ui.notify('Standard wiederhergestellt', 'neutral', {
      label: 'Rückgängig',
      run: () => save(before),
    });
  };

  return (
    <DndContext
      sensors={sensors}
      autoScroll={false}
      onDragStart={onDragStart}
      onDragEnd={() => finish(true)}
      onDragCancel={() => finish(false)}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: 'Zum Verschieben ziehen, mit dem Finger erst kurz halten. Esc legt es zurück.',
        },
      }}
    >
      <HomePageContext.Provider
        value={{
          selection,
          editing,
          onText: (id, text) => change(id, { text }),
        }}
      >
        <div
          ref={gridRef}
          // Its own drags while arranging – never the page's selection box.
          data-own-drag={editing || undefined}
          className={cn(
            'grid min-w-0 grid-flow-row-dense gap-x-6',
            // A finger resting on a widget lifts it – no text picked, no menu of the system.
            editing && 'select-none [-webkit-touch-callout:none]',
            // The panel a sheet below: the last widgets can still go above it.
            editing && sheet && 'pb-[50dvh]',
          )}
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gridAutoRows: `${STEP_PX}px`,
          }}
        >
          {shown.map((widget) => (
            <WidgetBox
              key={widget.id}
              widget={widget}
              columns={columns}
              editing={editing}
              widen={editing ? pageWidth - gridWidth : 0}
              picked={pickedWidget?.id === widget.id}
              dragged={drag?.id === widget.id}
              boxRef={(element) => {
                if (element) boxes.current.set(widget.id, element);
                else boxes.current.delete(widget.id);
              }}
              onPick={() => setPicked(widget.id)}
              onCorner={(event) => pressCorner(event, widget)}
              onRemove={() => {
                save(removeWidget(layout, widget.id));
                if (pickedWidget?.id === widget.id) setPicked(null);
              }}
            />
          ))}
          {shown.length === 0 && (
            <div
              className="col-span-full flex flex-col items-center justify-center gap-3 rounded-panel border-2 border-dashed border-handle p-10 text-center"
              style={{ gridRowEnd: `span ${Math.round(240 / STEP_PX)}` }}
            >
              <p className="text-body text-fg-muted">
                {editing
                  ? 'Zieh Widgets aus der Liste hierher oder klick sie an.'
                  : 'Hier steht noch nichts.'}
              </p>
              {!editing && (
                <Button variant="soft" icon="dashboard" onClick={() => onEdit(true)}>
                  Widgets hinzufügen
                </Button>
              )}
            </div>
          )}
        </div>

        {editing && (
          <HomeCustomize
            layout={layout}
            picked={pickedWidget}
            columns={columns}
            sheet={sheet}
            available={available}
            onAdd={add}
            onShow={show}
            onChange={change}
            onRemove={(id) => {
              save(removeWidget(layout, id));
              setPicked(null);
            }}
            onDeselect={() => setPicked(null)}
            onReset={reset}
            onDone={() => onEdit(false)}
          />
        )}

        {resizing && (
          // Over everything while the corner is held: its arrows everywhere, nothing lights up.
          <div aria-hidden className="fixed inset-0 z-(--z-toast) cursor-nwse-resize" />
        )}
        {/* What is dragged, lifted under the pointer; its place on the page shows faint. A new one
          does not fly back to the panel when it is let go. */}
        <DragOverlay dropAnimation={drag?.kind === 'new' ? null : undefined}>
          {drag && <DragGhost drag={drag} layout={shown} />}
        </DragOverlay>
      </HomePageContext.Provider>
    </DndContext>
  );
}

/** What is dragged, as large as it was where it was picked up: its mark and its name. */
function DragGhost({ drag, layout }: { drag: Drag; layout: HomeLayout }) {
  const type =
    drag.kind === 'new' ? drag.type : layout.find((widget) => widget.id === drag.id)?.type;
  if (!type) return null;
  const info = WIDGET_INFO[type];
  return (
    <div
      aria-hidden
      className={cn(
        'glass-elevated flex size-full cursor-grabbing gap-2 rounded-panel text-body font-medium text-fg shadow-lg',
        drag.kind === 'new' ? 'items-center px-3' : 'items-start p-4',
      )}
    >
      <Icon name={info.icon} size={16} className="mt-0.5 shrink-0" />
      {info.label}
    </div>
  );
}

/** One widget in the grid: its box, its look, and while arranging its handles. */
function WidgetBox({
  widget,
  columns,
  editing,
  widen,
  picked,
  dragged,
  boxRef,
  onPick,
  onCorner,
  onRemove,
}: {
  widget: Widget;
  columns: number;
  editing: boolean;
  /** How much wider the grid is on the page than now (the panel beside while arranging). */
  widen: number;
  picked: boolean;
  dragged: boolean;
  boxRef: (element: HTMLElement | null) => void;
  onPick: () => void;
  onCorner: (event: ReactPointerEvent) => void;
  onRemove: () => void;
}) {
  const headingId = useId();
  const info = WIDGET_INFO[widget.type];
  const View = WIDGET_VIEWS[widget.type];
  const frameRef = useRef<HTMLElement>(null);
  const fixed = widget.h !== 'auto';
  const [measured, setMeasured] = useState(Math.ceil(120 / STEP_PX));
  const rows = fixed ? ((widget.h as number) * ROW_PX) / STEP_PX : measured;
  // As high as its content: the grid's rows follow it, its gap below carried along.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (widget.h !== 'auto' || !frame) return;
    const measure = () =>
      setMeasured(Math.max(1, Math.ceil((frame.offsetHeight + GAP_PX) / STEP_PX)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [widget.h]);
  const span = spanOf(widget.w, columns);
  const { setNodeRef, setActivatorNodeRef, attributes, listeners } = useDraggable({
    id: widget.id,
    disabled: !editing,
  });

  return (
    <div
      ref={(element) => {
        boxRef(element);
        setNodeRef(element);
      }}
      data-widget={widget.type}
      // As high as the widget, not its grid rows (they carry the gap below): the handles sit on it.
      className={cn('relative min-w-0 self-start', editing && 'group/widget')}
      style={{ gridColumn: `span ${span} / span ${span}`, gridRowEnd: `span ${rows}` }}
    >
      <section
        ref={frameRef}
        aria-labelledby={widget.title ? headingId : undefined}
        aria-label={widget.title ? undefined : info.label}
        className={cn(
          'relative flex min-w-0 flex-col',
          LOOKS[widget.look],
          fixed && 'overflow-hidden',
          editing && 'transition-opacity duration-150',
          dragged && 'opacity-40',
        )}
        style={fixed ? { height: (widget.h as number) * ROW_PX - GAP_PX } : undefined}
      >
        <FrameContext.Provider
          // Its part of what the grid is wider on the page: its content fits itself to that, so
          // nothing comes and goes when arranging begins and ends.
          value={{ widget, headingId, widen: (widen * span) / columns }}
        >
          <div
            inert={editing}
            className={cn(
              'flex min-h-0 flex-1 flex-col',
              fixed && '-mx-2 overflow-y-auto overscroll-contain px-2',
            )}
          >
            <View />
          </div>
        </FrameContext.Provider>
        {editing && (
          // While arranging the widget is one thing to pick and drag, its content asleep.
          <div
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            // Picked with a click, moved with the arrows once picked – no stop of its own for Tab.
            tabIndex={-1}
            aria-label={`${info.label} verschieben`}
            className="absolute inset-0 z-(--z-raised) cursor-grab rounded-panel outline-none"
            onClick={onPick}
          />
        )}
      </section>
      {editing && (
        <>
          {/* No frame round each – the handles say it is arranged. A line only under the pointer
              and round the picked one, 8 px off every look (bare words reach the edge), its
              corners where the handles sit. */}
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute -inset-2 z-(--z-raised) rounded-xl border-2 transition-colors duration-150',
              picked ? 'border-focus' : 'border-transparent group-hover/widget:border-border-focus',
            )}
          />
          <button
            type="button"
            aria-label={`${info.label} entfernen`}
            title="Entfernen"
            onClick={onRemove}
            className={cn(
              // Its middle on the line's rounded corner (8 px out, 12 px round).
              // A finger's room round it (40 px), the mark small.
              'glass-elevated absolute -top-4 -left-4 z-(--z-overlay) flex size-6 items-center justify-center rounded-full text-fg transition-transform duration-150 before:absolute before:-inset-2 hover:scale-110',
            )}
          >
            <Icon name="remove" size={14} />
          </button>
          <div
            aria-hidden
            title="Größe ziehen"
            onPointerDown={onCorner}
            className="absolute -right-5 -bottom-5 z-(--z-overlay) size-10 cursor-nwse-resize touch-none"
          >
            {/* The line's own corner, drawn over it. */}
            <span className="absolute right-3 bottom-3 size-4 rounded-br-xl border-r-2 border-b-2 border-fg-muted" />
          </div>
        </>
      )}
    </div>
  );
}
