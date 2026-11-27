import { useSyncExternalStore } from 'react';
import { createStoredStore, type StoredStore } from '@/lib/storage';

/**
 * „Zuletzt“ as widgets (the user, 2026-11-25: „wie so Widgets … ähnlich wie das so bei Apple,
 * Samsung und Co.“): each widget as wide as some of twelve columns and as high as its content or
 * a number of rows, on the page bare or in a box. Placed freely on the field (the user,
 * 2026-11-26: „frei platzieren auf dem feld also auch reihen boxen frei lassen“): a cell of its
 * own (`x`, `y`), rows and cells left empty stay empty; one that would lie on another goes below
 * it. Never placed (what one starts with, kept from before): packed in order, as before.
 */
export const WIDGET_TYPES = [
  'today',
  'order',
  'forYou',
  'continue',
  'since',
  'unread',
  'todos',
  'events',
  'changed',
  'activity',
  'agents',
  'decks',
  'pins',
  'storage',
  'note',
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

/** Of twelve columns: a quarter, a third, half, two thirds, three quarters, all. */
export const WIDGET_WIDTHS = [3, 4, 6, 8, 9, 12] as const;
export type WidgetWidth = (typeof WIDGET_WIDTHS)[number];

/** Rows of the grid (`ROW_PX` each, `GAP_PX` between) – or as high as what it shows. */
export const MAX_ROWS = 12;
/** The field's fine steps (4 px) in a row (72 px): heights as the content are counted in these. */
export const ROW_STEPS = 18;
/** How far down one may be put (rows). */
const MAX_Y = 400;
export type WidgetHeight = number | 'auto';

/** Bare on the page, frosted glass, a quiet fill, or a line round it. */
export const WIDGET_LOOKS = ['none', 'glass', 'fill', 'line'] as const;
export type WidgetLook = (typeof WIDGET_LOOKS)[number];

export interface Widget {
  id: string;
  /** Of its board's kinds (`BoardSpec.types`) – on „Zuletzt“ a `WidgetType`. */
  type: string;
  w: WidgetWidth;
  h: WidgetHeight;
  look: WidgetLook;
  /** Its heading shown. */
  title: boolean;
  /** A note's words. */
  text?: string;
  /** Its cell, once put somewhere: column of twelve (0–11) and row. Both or neither. */
  x?: number;
  y?: number;
}

export type HomeLayout = readonly Widget[];

/** What a new widget of a type starts as – and which may stand more than once. */
export interface WidgetDefaults {
  w: WidgetWidth;
  h: WidgetHeight;
  look: WidgetLook;
  /** Several of it make sense (a note); the rest stand once. */
  many?: boolean;
  /** Its heading hidden at first – it says itself what it is (the order field, „Für dich“). */
  untitled?: boolean;
}

/**
 * What a page of widgets is (the user, 2026-11-25: „alle übersichts seiten sollen so widgety
 * customizable sein“): where it is kept, its kinds, what each starts as, what one starts with,
 * and which two stand one for the other (`rival`: the order field alone or with an overview).
 */
export interface BoardSpec {
  /** Kept per person and workspace under this (and the page's `scope`). */
  key: string;
  types: readonly string[];
  defaults: Readonly<Record<string, WidgetDefaults>>;
  defaultTypes: readonly string[];
  /** `{ a: b }`: a and b stand one for the other; kept both (from before), a goes. */
  rival?: Readonly<Record<string, string>>;
}

/** The kind a widget of `type` stands for, on its board (`BoardSpec.rival`, either way round). */
export const rivalOf = (spec: BoardSpec, type: string) =>
  spec.rival?.[type] ?? Object.entries(spec.rival ?? {}).find(([, other]) => other === type)?.[0];

/** On every board: the time and a greeting, a few lines of one's own. */
export const SHARED_DEFAULTS = {
  today: { w: 4, h: 'auto', look: 'none', untitled: true },
  note: { w: 3, h: 3, look: 'fill', many: true },
} as const satisfies Record<string, WidgetDefaults>;

export const WIDGET_DEFAULTS: Record<WidgetType, WidgetDefaults> = {
  today: SHARED_DEFAULTS.today,
  order: { w: 12, h: 'auto', look: 'none', untitled: true },
  forYou: { w: 12, h: 'auto', look: 'none', untitled: true },
  continue: { w: 8, h: 'auto', look: 'none' },
  since: { w: 4, h: 4, look: 'glass' },
  unread: { w: 4, h: 'auto', look: 'none' },
  todos: { w: 6, h: 'auto', look: 'none' },
  events: { w: 6, h: 'auto', look: 'none' },
  changed: { w: 8, h: 7, look: 'none' },
  activity: { w: 4, h: 7, look: 'glass' },
  agents: { w: 4, h: 'auto', look: 'glass' },
  decks: { w: 8, h: 'auto', look: 'none' },
  pins: { w: 4, h: 'auto', look: 'fill' },
  storage: { w: 3, h: 'auto', look: 'fill' },
  note: SHARED_DEFAULTS.note,
};

/**
 * The order field alone, or with what waits for one under it („Für dich“: the same field on top,
 * the user 2026-11-25: „ai leiste mit infos dazu oder ohne“) – one of the two on a page, never
 * two fields.
 */
const RIVAL: Readonly<Record<string, WidgetType>> = { order: 'forYou' };

/** Today's „Zuletzt“, as it stood before the widgets: what one starts with and gets back. */
const DEFAULT_TYPES: readonly WidgetType[] = [
  'forYou',
  'continue',
  'since',
  'unread',
  'todos',
  'events',
  'changed',
  'activity',
];

/** „Zuletzt“. */
export const CLOUD_BOARD: BoardSpec = {
  key: 'slider.cloud.home.v1',
  types: WIDGET_TYPES,
  defaults: WIDGET_DEFAULTS,
  defaultTypes: DEFAULT_TYPES,
  rival: RIVAL,
};

export function newWidget(spec: BoardSpec, type: string, id: string = newWidgetId()): Widget {
  const { w, h, look, untitled } = spec.defaults[type]!;
  return { id, type, w, h, look, title: !untitled, ...(type === 'note' ? { text: '' } : {}) };
}

let counter = 0;
const newWidgetId = () => `w${Date.now().toString(36)}${(counter++).toString(36)}`;

const defaultLayouts = new WeakMap<BoardSpec, HomeLayout>();
/** What the board starts with and gets back – the same list each time (one per spec). */
export function defaultLayout(spec: BoardSpec): HomeLayout {
  let layout = defaultLayouts.get(spec);
  if (!layout) {
    layout = spec.defaultTypes.map((type) => newWidget(spec, type, type));
    defaultLayouts.set(spec, layout);
  }
  return layout;
}

const isOneOf = <T>(list: readonly T[], value: unknown): value is T => list.includes(value as T);
const typeOf = (value: unknown) =>
  typeof value === 'object' && value !== null ? (value as { type?: unknown }).type : undefined;

/** Each widget on its own: an unknown kind goes, a missing or wrong field takes its default. */
export function parseLayout(spec: BoardSpec, value: unknown): HomeLayout {
  if (!Array.isArray(value)) return defaultLayout(spec);
  const seen = new Set<string>();
  const layout: Widget[] = [];
  for (const raw of value as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const stored = raw as Partial<Record<keyof Widget, unknown>>;
    if (!isOneOf(spec.types, stored.type)) continue;
    const type = stored.type;
    const id = typeof stored.id === 'string' && stored.id ? stored.id : newWidgetId();
    if (seen.has(id)) continue;
    // One of a kind stands once: a second (an old tab's) goes.
    if (!spec.defaults[type]!.many && layout.some((each) => each.type === type)) continue;
    // Both of two rivals kept (the order field beside „Für dich“, from before it carried the
    // field): the one named first goes (`order: 'forYou'`) – the field stays, on top of it.
    const yields = spec.rival?.[type];
    if (yields && (value as unknown[]).some((one) => typeOf(one) === yields)) continue;
    seen.add(id);
    const base = newWidget(spec, type, id);
    const w = isOneOf(WIDGET_WIDTHS, stored.w) ? stored.w : base.w;
    const placed = isCount(stored.x) && isCount(stored.y);
    layout.push({
      ...base,
      w,
      h:
        stored.h === 'auto' ||
        (typeof stored.h === 'number' && Number.isInteger(stored.h) && stored.h >= 1)
          ? stored.h === 'auto'
            ? 'auto'
            : Math.min(MAX_ROWS, stored.h as number)
          : base.h,
      look: isOneOf(WIDGET_LOOKS, stored.look) ? stored.look : base.look,
      title: typeof stored.title === 'boolean' ? stored.title : base.title,
      ...(type === 'note' ? { text: typeof stored.text === 'string' ? stored.text : '' } : {}),
      ...(placed
        ? { x: Math.min(stored.x as number, 12 - w), y: Math.min(stored.y as number, MAX_Y) }
        : {}),
    });
  }
  return layout;
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** Placed widgets in the order they stand, top down (stable: the first of a row stays first). */
const byRow = (layout: readonly Widget[]): HomeLayout =>
  [...layout].sort((a, b) => (a.y ?? MAX_Y + 1) - (b.y ?? MAX_Y + 1));

/**
 * `widget` put at a cell (`x` kept to the columns). It goes first of its row – a widget that
 * stood there yields and goes below it – and the list is kept in the order they stand.
 */
export function placeWidget(layout: HomeLayout, id: string, x: number, y: number): HomeLayout {
  const widget = layout.find((each) => each.id === id);
  if (!widget) return layout;
  const cell = {
    x: Math.max(0, Math.min(12 - widget.w, Math.round(x))),
    y: Math.max(0, Math.min(MAX_Y, Math.round(y))),
  };
  if (widget.x === cell.x && widget.y === cell.y) return layout;
  return byRow([{ ...widget, ...cell }, ...layout.filter((each) => each !== widget)]);
}

/**
 * A new widget put on the board – at `cell`, or (without one) where its rival stood, else last in
 * order; one of a kind already there stays. Its rival (`BoardSpec.rival`) goes.
 */
export function addWidget(
  spec: BoardSpec,
  layout: HomeLayout,
  widget: Widget,
  cell?: { x: number; y: number },
): HomeLayout {
  if (!spec.defaults[widget.type]!.many && layout.some((each) => each.type === widget.type))
    return layout;
  const rival = layout.find((each) => each.type === rivalOf(spec, widget.type));
  const rest = rival ? layout.filter((each) => each !== rival) : layout;
  if (cell)
    return byRow([
      {
        ...widget,
        x: Math.max(0, Math.min(12 - widget.w, Math.round(cell.x))),
        y: Math.max(0, Math.min(MAX_Y, Math.round(cell.y))),
      },
      ...rest,
    ]);
  if (rival) {
    const at = layout.indexOf(rival);
    const placed =
      rival.y === undefined
        ? widget
        : { ...widget, x: Math.min(rival.x ?? 0, 12 - widget.w), y: rival.y };
    return [...rest.slice(0, at), placed, ...rest.slice(at)];
  }
  return [...rest, widget];
}

/** A wider one stays on the field: it moves left as far as it must. */
export function changeWidget(
  layout: HomeLayout,
  id: string,
  change: Partial<Omit<Widget, 'id' | 'type'>>,
): HomeLayout {
  return layout.map((each) => {
    if (each.id !== id) return each;
    const next = { ...each, ...change };
    return next.x !== undefined && next.x + next.w > 12 ? { ...next, x: 12 - next.w } : next;
  });
}

export const removeWidget = (layout: HomeLayout, id: string): HomeLayout =>
  layout.filter((each) => each.id !== id);

/**
 * How many of twelve columns a widget takes where the grid has `columns` (12 wide, 6 on a
 * tablet, 1 on a phone): on six, up to half stays half, more takes all.
 */
export function spanOf(w: WidgetWidth, columns: number): number {
  if (columns >= 12) return w;
  if (columns <= 1) return 1;
  return w <= 6 ? columns / 2 : columns;
}

/** The nearest of `WIDGET_WIDTHS` (at most `max` twelfths) – a dragged edge snaps to it. */
export function nearestWidth(twelfths: number, max = 12): WidgetWidth {
  let best: WidgetWidth = WIDGET_WIDTHS[0];
  for (const w of WIDGET_WIDTHS)
    if (w <= max && Math.abs(w - twelfths) < Math.abs(best - twelfths)) best = w;
  return best;
}

/** Where a widget stands on the field now: column and columns spanned, top and height in steps. */
export interface Spot {
  col: number;
  span: number;
  top: number;
  steps: number;
}

/**
 * Where each widget stands where the grid has `columns`, `steps` its height (in `ROW_STEPS` of a
 * row). Placed ones first – `first` (the one being put somewhere) before all, so what is in its
 * way yields – then top down: at their row, or – something in the way – at the first free place
 * below it (never above: rows left empty stay empty); on fewer columns their column scales.
 * Then the never placed, in order, each at the first free place from the top – what the grid's
 * dense packing did, so a page never arranged looks as it always did.
 */
export function arrange(
  layout: HomeLayout,
  steps: (widget: Widget) => number,
  columns: number,
  first?: string,
): Map<string, Spot> {
  const spots = new Map<string, Spot>();
  const taken: Spot[] = [];
  const fits = (at: Spot) =>
    taken.every(
      (other) =>
        at.col >= other.col + other.span ||
        other.col >= at.col + at.span ||
        at.top >= other.top + other.steps ||
        other.top >= at.top + at.steps,
    );
  // The places worth trying: the top, and where each thing in the way ends.
  const tops = (from: number) =>
    [from, ...taken.map((other) => other.top + other.steps).filter((end) => end > from)].sort(
      (a, b) => a - b,
    );
  const put = (widget: Widget, spot: Spot) => {
    spots.set(widget.id, spot);
    taken.push(spot);
  };
  const colOf = (widget: Widget, span: number) =>
    Math.min(columns - span, Math.round(((widget.x ?? 0) * columns) / 12));
  const placed = [...byRow(layout.filter((each) => each.y !== undefined))];
  const lead = placed.findIndex((each) => each.id === first);
  let leadTop = 0;
  if (lead >= 0) {
    const widget = placed[lead]!;
    placed.unshift(...placed.splice(lead, 1));
    // Reaching less than a row into one above it (its row starts inside a widget as high as its
    // content, or it is dropped just under one): it goes snug below that one instead of pushing
    // it away – what it lies on further wins.
    const span = spanOf(widget.w, columns);
    const col = colOf(widget, span);
    const others = [
      ...arrange(
        layout.filter((each) => each !== widget),
        steps,
        columns,
      ).values(),
    ];
    leadTop = widget.y! * ROW_STEPS;
    for (let yielded = true; yielded;) {
      yielded = false;
      for (const other of others) {
        const end = other.top + other.steps;
        const across = col < other.col + other.span && other.col < col + span;
        if (across && other.top <= leadTop && leadTop < end && end - leadTop < ROW_STEPS) {
          leadTop = end;
          yielded = true;
        }
      }
    }
  }
  for (const widget of placed) {
    const span = spanOf(widget.w, columns);
    const col = colOf(widget, span);
    const height = Math.max(1, steps(widget));
    for (const top of tops(widget.id === first ? leadTop : widget.y! * ROW_STEPS)) {
      const spot = { col, span, top, steps: height };
      if (fits(spot)) {
        put(widget, spot);
        break;
      }
    }
  }
  for (const widget of layout.filter((each) => each.y === undefined)) {
    const span = spanOf(widget.w, columns);
    const height = Math.max(1, steps(widget));
    search: for (const top of tops(0)) {
      for (let col = 0; col + span <= columns; col++) {
        const spot = { col, span, top, steps: height };
        if (fits(spot)) {
          put(widget, spot);
          break search;
        }
      }
    }
  }
  return spots;
}

/**
 * `first` put somewhere, what it pushed down kept there: a row lower for each that `first` alone
 * moves (not for what grows above – that moves only while it is so high).
 */
export function settleWidgets(
  layout: HomeLayout,
  steps: (widget: Widget) => number,
  columns: number,
  first: string,
): HomeLayout {
  const before = arrange(layout, steps, columns);
  const after = arrange(layout, steps, columns, first);
  let moved = false;
  const next = layout.map((widget) => {
    const top = after.get(widget.id)?.top ?? 0;
    if (widget.id === first || widget.y === undefined || top <= (before.get(widget.id)?.top ?? 0))
      return widget;
    moved = true;
    return { ...widget, y: Math.max(widget.y, Math.floor(top / ROW_STEPS)) };
  });
  // `first` ahead of what it pushed into its own row, so it stays ahead.
  return moved
    ? byRow([...next.filter((w) => w.id === first), ...next.filter((w) => w.id !== first)])
    : layout;
}

/**
 * Every widget given the cell it stands at now (`spots`), the placed keep theirs – so putting one
 * somewhere leaves the others where they are seen (a never placed one would fill the gap left).
 * In the order they stand.
 */
export function pinWidgets(
  layout: HomeLayout,
  spots: ReadonlyMap<string, Spot>,
  columns: number,
): HomeLayout {
  if (layout.every((each) => each.y !== undefined)) return layout;
  const at = (widget: Widget) => spots.get(widget.id) ?? { col: 0, top: 0 };
  return [...layout]
    .sort((a, b) => at(a).top - at(b).top || at(a).col - at(b).col)
    .map((widget) =>
      widget.y !== undefined
        ? widget
        : {
            ...widget,
            x: Math.min(12 - widget.w, Math.round((at(widget).col * 12) / columns)),
            y: Math.floor(at(widget).top / ROW_STEPS),
          },
    );
}

/** One store per board, person and workspace – kept in this browser, followed across its tabs. */
const stores = new Map<string, StoredStore<HomeLayout>>();
function storeOf(spec: BoardSpec, userId: string, workspaceId: string) {
  const key = `${spec.key}:${userId}:${workspaceId}`;
  let store = stores.get(key);
  if (!store) {
    store = createStoredStore({
      key,
      parse: (value) => parseLayout(spec, value),
      fallback: defaultLayout(spec),
      crossTab: true,
    });
    stores.set(key, store);
  }
  return store;
}

export function useHomeLayout(spec: BoardSpec, userId: string, workspaceId: string) {
  const store = storeOf(spec, userId, workspaceId);
  const layout = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return [layout, store.set] as const;
}

/** What a row of the panel hands a drag onto the page (dnd-kit's `data`), and its id. */
export type NewDragData = { type: string };
export const newDragId = (type: string) => `new:${type}`;
