import { readJson, writeJson } from '../storage';

/**
 * Status filter of the comment list ("Alle", "Offen", "KI" – threads the AI edited, "Erledigt"),
 * or "Ausgeblendet": no comments at all – the slides alone, to just look at them.
 */
export type StatusFilter = 'hidden' | 'all' | 'open' | 'ai' | 'done';

/**
 * "Arbeiten" on `/konto`: how a deck opens. Per-browser, like the split and box mode – the
 * toolbar switches change only the open deck, these are what every deck starts with.
 */
export interface WorkPreferences {
  /** Hilfslinien on when a deck opens (G still toggles them). */
  showGuides: boolean;
  /** Slides hidden in PowerPoint on when a deck opens (H still toggles them). */
  showHiddenSlides: boolean;
  /** Änderungshinweise: badges of the latest revision on track and minimap – off by default. */
  showChanges: boolean;
  /** Comment filter a deck opens with; BER-101 hides done comments by default. */
  statusFilter: StatusFilter;
  /** Folienübersicht (minimap) hidden when a deck opens – shown by default; its button still toggles it. */
  hideMinimap: boolean;
  /** Editing: picking an element too small to work on zooms in on it, letting go zooms back – on by default. */
  autoZoom: boolean;
  /** Opening a comment on a small box zooms its slide in on it, closing it zooms back – on by default. */
  commentZoom: boolean;
}

const STORAGE_KEY = 'slider.workPreferences.v1';

export const DEFAULT_WORK_PREFERENCES: WorkPreferences = {
  showGuides: false,
  showHiddenSlides: false,
  showChanges: false,
  statusFilter: 'open',
  hideMinimap: false,
  autoZoom: true,
  commentZoom: true,
};

const STATUS_FILTERS: readonly StatusFilter[] = ['open', 'all', 'done', 'hidden'];

/** Each field on its own: a missing or invalid one takes its default. */
function parseWorkPreferences(value: unknown): WorkPreferences {
  if (typeof value !== 'object' || value === null) return DEFAULT_WORK_PREFERENCES;
  const stored = value as Partial<Record<keyof WorkPreferences, unknown>>;
  return {
    showGuides:
      typeof stored.showGuides === 'boolean'
        ? stored.showGuides
        : DEFAULT_WORK_PREFERENCES.showGuides,
    showHiddenSlides:
      typeof stored.showHiddenSlides === 'boolean'
        ? stored.showHiddenSlides
        : DEFAULT_WORK_PREFERENCES.showHiddenSlides,
    showChanges:
      typeof stored.showChanges === 'boolean'
        ? stored.showChanges
        : DEFAULT_WORK_PREFERENCES.showChanges,
    statusFilter: STATUS_FILTERS.includes(stored.statusFilter as StatusFilter)
      ? (stored.statusFilter as StatusFilter)
      : DEFAULT_WORK_PREFERENCES.statusFilter,
    hideMinimap:
      typeof stored.hideMinimap === 'boolean'
        ? stored.hideMinimap
        : DEFAULT_WORK_PREFERENCES.hideMinimap,
    autoZoom:
      typeof stored.autoZoom === 'boolean' ? stored.autoZoom : DEFAULT_WORK_PREFERENCES.autoZoom,
    commentZoom:
      typeof stored.commentZoom === 'boolean'
        ? stored.commentZoom
        : DEFAULT_WORK_PREFERENCES.commentZoom,
  };
}

/** Missing, corrupt or unreadable storage: the defaults. */
export function loadWorkPreferences(): WorkPreferences {
  return readJson(STORAGE_KEY, parseWorkPreferences, DEFAULT_WORK_PREFERENCES);
}

/** Private mode or blocked storage: decks open with the defaults. */
export function storeWorkPreferences(preferences: WorkPreferences): void {
  writeJson(STORAGE_KEY, preferences);
}
