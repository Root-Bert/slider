import { useSyncExternalStore } from 'react';
import { createStoredStore, type StoredStore } from '@/lib/storage';

/**
 * „Zuletzt“ as widgets (the user, 2026-11-25: „wie so Widgets … ähnlich wie das so bei Apple,
 * Samsung und Co.“): an ordered list, each widget as wide as some of twelve columns and as high
 * as its content or a number of rows, on the page bare or in a box. The grid packs them in
 * order (dense), so moving one is putting it elsewhere in the list – no places to collide.
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
export type WidgetHeight = number | 'auto';

/** Bare on the page, frosted glass, a quiet fill, or a line round it. */
export const WIDGET_LOOKS = ['none', 'glass', 'fill', 'line'] as const;
export type WidgetLook = (typeof WIDGET_LOOKS)[number];

export interface Widget {
  id: string;
  type: WidgetType;
  w: WidgetWidth;
  h: WidgetHeight;
  look: WidgetLook;
  /** Its heading shown. */
  title: boolean;
  /** A note's words. */
  text?: string;
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

export const WIDGET_DEFAULTS: Record<WidgetType, WidgetDefaults> = {
  today: { w: 4, h: 'auto', look: 'none', untitled: true },
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
  note: { w: 3, h: 3, look: 'fill', many: true },
};

/** Today's „Zuletzt“, as it stood before the widgets: what one starts with and gets back. */
const DEFAULT_TYPES: readonly WidgetType[] = [
  'order',
  'forYou',
  'continue',
  'since',
  'unread',
  'todos',
  'events',
  'changed',
  'activity',
];

export function newWidget(type: WidgetType, id: string = newWidgetId()): Widget {
  const { w, h, look, untitled } = WIDGET_DEFAULTS[type];
  return { id, type, w, h, look, title: !untitled, ...(type === 'note' ? { text: '' } : {}) };
}

let counter = 0;
const newWidgetId = () => `w${Date.now().toString(36)}${(counter++).toString(36)}`;

export const DEFAULT_LAYOUT: HomeLayout = DEFAULT_TYPES.map((type) => newWidget(type, type));

const isOneOf = <T>(list: readonly T[], value: unknown): value is T => list.includes(value as T);

/** Each widget on its own: an unknown kind goes, a missing or wrong field takes its default. */
export function parseLayout(value: unknown): HomeLayout {
  if (!Array.isArray(value)) return DEFAULT_LAYOUT;
  const seen = new Set<string>();
  const layout: Widget[] = [];
  for (const raw of value as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const stored = raw as Partial<Record<keyof Widget, unknown>>;
    if (!isOneOf(WIDGET_TYPES, stored.type)) continue;
    const type = stored.type;
    const id = typeof stored.id === 'string' && stored.id ? stored.id : newWidgetId();
    if (seen.has(id)) continue;
    // One of a kind stands once: a second (an old tab's) goes.
    if (!WIDGET_DEFAULTS[type].many && layout.some((each) => each.type === type)) continue;
    seen.add(id);
    const base = newWidget(type, id);
    layout.push({
      ...base,
      w: isOneOf(WIDGET_WIDTHS, stored.w) ? stored.w : base.w,
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
    });
  }
  return layout;
}

/** `widget` moved to stand at `index` of the list without it. */
export function moveWidget(layout: HomeLayout, id: string, index: number): HomeLayout {
  const from = layout.findIndex((each) => each.id === id);
  if (from < 0) return layout;
  const rest = layout.filter((each) => each.id !== id);
  const to = Math.max(0, Math.min(rest.length, index));
  if (to === from) return layout;
  return [...rest.slice(0, to), layout[from]!, ...rest.slice(to)];
}

/** A new widget put in at `index` (the end when beyond it); one of a kind already there stays. */
export function addWidget(layout: HomeLayout, widget: Widget, index = layout.length): HomeLayout {
  if (!WIDGET_DEFAULTS[widget.type].many && layout.some((each) => each.type === widget.type))
    return layout;
  const at = Math.max(0, Math.min(layout.length, index));
  return [...layout.slice(0, at), widget, ...layout.slice(at)];
}

export function changeWidget(
  layout: HomeLayout,
  id: string,
  change: Partial<Omit<Widget, 'id' | 'type'>>,
): HomeLayout {
  return layout.map((each) => (each.id === id ? { ...each, ...change } : each));
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

/** The widest of `WIDGET_WIDTHS` not past `columns` twelfths – a dragged edge snaps to it. */
export function nearestWidth(twelfths: number): WidgetWidth {
  let best: WidgetWidth = WIDGET_WIDTHS[0];
  for (const w of WIDGET_WIDTHS) if (Math.abs(w - twelfths) < Math.abs(best - twelfths)) best = w;
  return best;
}

/** One store per person and workspace – kept in this browser, followed across its tabs. */
const stores = new Map<string, StoredStore<HomeLayout>>();
function storeOf(userId: string, workspaceId: string) {
  const key = `slider.cloud.home.v1:${userId}:${workspaceId}`;
  let store = stores.get(key);
  if (!store) {
    store = createStoredStore({
      key,
      parse: parseLayout,
      fallback: DEFAULT_LAYOUT,
      crossTab: true,
    });
    stores.set(key, store);
  }
  return store;
}

export function useHomeLayout(userId: string, workspaceId: string) {
  const store = storeOf(userId, workspaceId);
  const layout = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return [layout, store.set] as const;
}

/** What a row of the panel hands a drag onto the page (dnd-kit's `data`), and its id. */
export type NewDragData = { type: WidgetType };
export const newDragId = (type: WidgetType) => `new:${type}`;
