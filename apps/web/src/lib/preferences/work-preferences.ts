import type { StatusFilter } from './comment-selectors';

/**
 * "Arbeiten" on `/konto`: how a deck opens. Per-browser, like the split and box mode – the
 * toolbar switches change only the open deck, these are what every deck starts with.
 */
export interface WorkPreferences {
  /** Hilfslinien on when a deck opens (G still toggles them). */
  showGuides: boolean;
  /** Slides hidden in PowerPoint on when a deck opens (H still toggles them). */
  showHiddenSlides: boolean;
  /** Badges of the latest revision on track and minimap. */
  showChanges: boolean;
  /** Comment filter a deck opens with; BER-101 hides done comments by default. */
  statusFilter: StatusFilter;
}

const STORAGE_KEY = 'slider.workPreferences.v1';

export const DEFAULT_WORK_PREFERENCES: WorkPreferences = {
  showGuides: false,
  showHiddenSlides: false,
  showChanges: true,
  statusFilter: 'open',
};

const STATUS_FILTERS: readonly StatusFilter[] = ['open', 'all', 'done'];

export function loadWorkPreferences(): WorkPreferences {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_WORK_PREFERENCES;
    const stored = parsed as Partial<Record<keyof WorkPreferences, unknown>>;
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
    };
  } catch {
    return DEFAULT_WORK_PREFERENCES;
  }
}

export function storeWorkPreferences(preferences: WorkPreferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Private mode or blocked storage: decks open with the defaults.
  }
}
