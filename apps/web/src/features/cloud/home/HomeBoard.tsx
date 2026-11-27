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
import { createPortal } from 'react-dom';
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
import { Button, cn, Icon, type ShowToast } from '@/ui';
import type { CloudSelection } from '../components/CloudPage';
import { HomeCustomize } from './HomeCustomize';
import type { BoardKit } from './kit';
import {
  addWidget,
  arrange,
  changeWidget,
  defaultLayout,
  MAX_ROWS,
  nearestWidth,
  newWidget,
  pinWidgets,
  placeWidget,
  removeWidget,
  rivalOf,
  settleWidgets,
  ROW_STEPS,
  useHomeLayout,
  type HomeLayout,
  type Spot,
  type Widget,
  type WidgetLook,
  type NewDragData,
} from './layout';
import { FrameContext, HomePageContext } from './frame';

/** One row of a widget's height, the gap below it included – and the gap between widgets. */
export const ROW_PX = 72;
const GAP_PX = 24;
/**
 * The grid's own rows: fine, so a widget as high as its content takes just that (rounded to
 * these), the gap carried in each widget's foot. Twelve columns where the page is wide.
 */
const STEP_PX = ROW_PX / ROW_STEPS;
/** What a widget as high as its content counts as before it is measured. */
const UNMEASURED_STEPS = Math.ceil(120 / STEP_PX);
/** Free rows below the last widget while arranging – somewhere to put one under all. */
const SPARE_ROWS = 4;
/** Where a new one from the panel is held: its top left corner this near the pointer. */
const NEW_GRAB_PX = 16;
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

type Drag = { kind: 'move'; id: string } | { kind: 'new'; type: string; id: string };

type Resize = { id: string; left: number; top: number };

/** Where the pointer holds the dragged one, from its top left corner. */
type Grab = { x: number; y: number };

const bottomOf = (spots: ReadonlyMap<string, Spot>) =>
  Math.max(0, ...[...spots.values()].map((spot) => spot.top + spot.steps));

/**
 * A page's widgets („Zuletzt“, „Aktuell“, a mailbox's „Übersicht“: `kit`) – and, while they are
 * being arranged (`editing`), dragged about, made larger by their corner, picked to change in the
 * panel beside, taken off; new ones are dragged in from the panel or put at the end with a click.
 */
export function HomeBoard({
  kit,
  userId,
  workspaceId,
  notify,
  available = () => true,
  selection,
  editing,
  onEdit,
}: {
  kit: BoardKit;
  userId: string;
  workspaceId: string;
  notify: ShowToast;
  /** What may stand on one's page now (on „Zuletzt“ the order field: members and admins). */
  available?: (type: string) => boolean;
  selection?: CloudSelection;
  editing: boolean;
  onEdit: (editing: boolean) => void;
}) {
  const { spec } = kit;
  const [stored, setStored] = useHomeLayout(spec, userId, workspaceId);
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

  // Heights as the content, measured (in steps); where each stands on the field.
  const [measured, setMeasured] = useState<Readonly<Record<string, number>>>({});
  const measure = (id: string, steps: number) =>
    setMeasured((now) => (now[id] === steps ? now : { ...now, [id]: steps }));
  const stepsOf = (widget: Widget) =>
    widget.h === 'auto' ? (measured[widget.id] ?? UNMEASURED_STEPS) : widget.h * ROW_STEPS;
  const spots = arrange(layout, stepsOf, columns);
  // What is moved, stretched or dragged in goes first; what is in its way yields below it.
  const [lead, setLead] = useState<string | null>(null);
  // Only on the full field: on fewer columns the rows are a stack, and keeping what it pushed
  // there would pull apart what stands side by side on the wide page.
  const wide = columns >= 12;
  const shownSpots = draft ? arrange(draft, stepsOf, columns, (wide && lead) || undefined) : spots;
  /** `next` with what `id` pushed down kept there – then saved. */
  const settle = (next: HomeLayout, id: string) =>
    save(wide ? settleWidgets(next, stepsOf, columns, id) : next);
  // Taken off, it leaves its place empty.
  const remove = (id: string) => {
    save(removeWidget(pinned(), id));
    if (picked === id) setPicked(null);
  };
  /** The layout with every widget at the cell it is seen at – before one is put elsewhere. */
  // Always the wide page's cells: pinned from a tablet's or a phone's stack, every widget would
  // stand where it stood there – on the wide page in one column.
  const pinned = () =>
    pinWidgets(layout, columns >= 12 ? spots : arrange(layout, stepsOf, 12), 12);

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
  // The layout as the drag began (every widget pinned where it was seen): each place the pointer
  // means is tried on it, so one pushed down comes back up once the dragged one goes on.
  const startRef = useRef<HomeLayout>(layout);
  const grabRef = useRef<Grab>({ x: NEW_GRAB_PX, y: NEW_GRAB_PX });
  const scrollerOf = (): HTMLElement | null =>
    gridRef.current?.closest<HTMLElement>('.overflow-y-auto') ??
    (document.scrollingElement as HTMLElement | null);

  // The panel stands over the page (a phone's sheet over its lower half): what is over it is not
  // on the page.
  const panelRect = () => document.querySelector('[data-side-panel]')?.getBoundingClientRect();

  /**
   * The cell the pointer means for `widget` (held at `grabRef`): its top left corner snapped to
   * the nearest column and row – in twelfths of the field, on one column its own. Off the page or
   * over the panel: none.
   */
  const cellAt = (x: number, y: number, widget: Widget): { x: number; y: number } | null => {
    const grid = gridRef.current;
    if (!grid) return null;
    const area = grid.getBoundingClientRect();
    const reach = 48;
    if (x < area.left - reach || x > area.right + reach || y < area.top - reach) return null;
    const panel = panelRect();
    if (panel && x >= panel.left && x <= panel.right && y >= panel.top && y <= panel.bottom)
      return null;
    const pitch = (area.width + GAP_PX) / columns;
    const grab = grabRef.current;
    const col = Math.round((x - grab.x - area.left) / pitch);
    const row = Math.max(0, Math.round((y - grab.y - area.top) / ROW_PX));
    return {
      x: columns <= 1 ? (widget.x ?? 0) : Math.max(0, (col * 12) / columns),
      y: row,
    };
  };

  const follow = () => {
    const current = dragRef.current;
    if (!current) return;
    const start = startRef.current;
    const widget =
      current.kind === 'new'
        ? newWidget(spec, current.type, current.id)
        : start.find((each) => each.id === current.id);
    if (!widget) return;
    const cell = cellAt(pointer.current.x, pointer.current.y, widget);
    if (!cell) {
      // Out of the page: a new one is not put in; a moved one stays where it was shown last.
      if (current.kind === 'new') putDraft(start);
      return;
    }
    putDraft(
      current.kind === 'new'
        ? addWidget(spec, start, widget, cell)
        : placeWidget(start, current.id, cell.x, cell.y),
    );
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
      settle(final, current.id);
      setPicked(current.id);
    }
    setLead(null);
    stopFollowing.current?.();
    stopFollowing.current = null;
    putDrag(null);
    putDraft(null);
  };

  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const data = active.data.current as NewDragData | undefined;
    const drag: Drag = data?.type
      ? { kind: 'new', type: data.type, id: newWidget(spec, data.type).id }
      : { kind: 'move', id: String(active.id) };
    pointer.current = getEventCoordinates(activatorEvent) ?? pointer.current;
    const box = drag.kind === 'move' ? boxes.current.get(drag.id)?.getBoundingClientRect() : null;
    grabRef.current = box
      ? { x: pointer.current.x - box.left, y: pointer.current.y - box.top }
      : { x: NEW_GRAB_PX, y: NEW_GRAB_PX };
    startRef.current = pinned();
    setLead(drag.id);
    putDrag(drag);
    putDraft(startRef.current);
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
      ? text.slice(4)
      : layout.find((widget) => widget.id === text)?.type;
    return (type && kit.info[type]?.label) || 'Widget';
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
    setLead(widget.id);
    const start = pinned();
    // Wider only as far as the field goes to its right – it does not move.
    const room = columns >= 12 ? 12 - (spots.get(widget.id)?.col ?? 0) : 12;
    let last: HomeLayout = start;
    const move = (e: PointerEvent) => {
      const at = resizeRef.current;
      if (!at) return;
      const twelfths = (12 * (e.clientX - at.left + GAP_PX / 2)) / (grid.width + GAP_PX);
      const rows = Math.round((e.clientY - at.top + GAP_PX) / ROW_PX);
      last = changeWidget(start, widget.id, {
        ...(columns > 1 ? { w: nearestWidth(twelfths, room) } : {}),
        h: Math.max(1, Math.min(MAX_ROWS, rows)),
      });
      setDraft(last);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      resizeRef.current = null;
      settle(last, widget.id);
      setDraft(null);
      setLead(null);
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
      remove(pickedWidget.id);
    } else if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) {
      // A cell on: a column of the grid sideways (none on one), a row up or down – from where
      // it is seen.
      event.preventDefault();
      const spot = spots.get(pickedWidget.id);
      if (!spot) return;
      const across = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
      const down = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
      if (across && columns <= 1) return;
      const x = columns <= 1 ? (pickedWidget.x ?? 0) : ((spot.col + across) * 12) / columns;
      const y = Math.floor(spot.top / ROW_STEPS) + down;
      if (x < 0 || y < 0) return;
      settle(placeWidget(pinned(), pickedWidget.id, x, y), pickedWidget.id);
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

  // Wider or higher in the panel, what is in its way yields too.
  const change = (id: string, patch: Partial<Omit<Widget, 'id' | 'type'>>) =>
    settle(changeWidget(pinned(), id, patch), id);
  const add = (type: string) => {
    const widget = newWidget(spec, type);
    // Below all – or where its rival stood.
    const rival = layout.some((each) => each.type === rivalOf(spec, type));
    const end = { x: 0, y: Math.ceil(bottomOf(spots) / ROW_STEPS) };
    save(addWidget(spec, pinned(), widget, rival ? undefined : end));
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
    save(defaultLayout(spec));
    setPicked(null);
    notify('Standard wiederhergestellt', 'neutral', {
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
            'grid min-w-0 gap-x-6',
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
              kit={kit}
              widget={widget}
              spot={shownSpots.get(widget.id)}
              columns={columns}
              onMeasure={(steps) => measure(widget.id, steps)}
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
              onRemove={() => remove(widget.id)}
            />
          ))}
          {editing && shown.length > 0 && (
            <div
              aria-hidden
              style={{
                gridColumn: '1 / -1',
                gridRow: `${bottomOf(shownSpots) + 1} / span ${SPARE_ROWS * ROW_STEPS}`,
              }}
            />
          )}
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

        {/* On `document.body`: in „Post“ the board stands in the mail list, whose fade (a mask)
          cuts off anything fixed in it – the panel, the corner's cover, the lifted card. */}
        {createPortal(
          <>
            {editing && (
              <HomeCustomize
                kit={kit}
                layout={layout}
                picked={pickedWidget}
                columns={columns}
                sheet={sheet}
                available={available}
                onAdd={add}
                onShow={show}
                onChange={change}
                onRemove={remove}
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
              {drag && <DragGhost kit={kit} drag={drag} layout={shown} />}
            </DragOverlay>
          </>,
          document.body,
        )}
      </HomePageContext.Provider>
    </DndContext>
  );
}

/** What is dragged, as large as it was where it was picked up: its mark and its name. */
function DragGhost({ kit, drag, layout }: { kit: BoardKit; drag: Drag; layout: HomeLayout }) {
  const type =
    drag.kind === 'new' ? drag.type : layout.find((widget) => widget.id === drag.id)?.type;
  const info = type ? kit.info[type] : undefined;
  if (!info) return null;
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
  kit,
  widget,
  spot,
  columns,
  onMeasure,
  editing,
  widen,
  picked,
  dragged,
  boxRef,
  onPick,
  onCorner,
  onRemove,
}: {
  kit: BoardKit;
  widget: Widget;
  /** Where it stands on the field (none for a moment before it is placed). */
  spot: Spot | undefined;
  columns: number;
  /** Its height as the content, in the grid's steps (its gap below carried along). */
  onMeasure: (steps: number) => void;
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
  const info = kit.info[widget.type]!;
  const View = kit.views[widget.type]!;
  const frameRef = useRef<HTMLElement>(null);
  const fixed = widget.h !== 'auto';
  const report = useEffectEvent(onMeasure);
  // As high as its content: the grid's rows follow it, its gap below carried along.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (widget.h !== 'auto' || !frame) return;
    const measure = () => report(Math.max(1, Math.ceil((frame.offsetHeight + GAP_PX) / STEP_PX)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [widget.h]);
  const span = spot?.span ?? columns;
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
      style={
        spot
          ? {
              gridColumn: `${spot.col + 1} / span ${spot.span}`,
              gridRow: `${spot.top + 1} / span ${spot.steps}`,
            }
          : { display: 'none' }
      }
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
          value={{ widget, label: info.label, headingId, widen: (widen * span) / columns }}
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
