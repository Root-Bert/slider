import type { Deck, DeckSource, ImportState } from '@slider/shared';
import { pluralize } from '@/lib/format';

const SOURCE_LABELS: Record<DeckSource, string> = {
  onedrive: 'OneDrive',
  sharepoint: 'SharePoint',
  upload: 'Upload',
};

export const sourceLabel = (source: DeckSource): string => SOURCE_LABELS[source];

export const slidesLabel = (count: number): string => pluralize(count, 'Folie', 'Folien');

export const isImporting = (deck: Pick<Deck, 'import'>): boolean =>
  deck.import.status === 'queued' || deck.import.status === 'running';

/** One-line description of a running import, as shown on the deck card overlay (G1). */
export function importActivityLabel(state: ImportState): string {
  if (state.status !== 'running') return 'In der Warteschlange…';
  switch (state.step) {
    case 'received':
      return 'Datei wird verarbeitet';
    case 'parsing':
      return 'Folien werden erkannt';
    case 'rendering':
      return 'Folien werden gerendert';
    case 'comments':
      return 'PowerPoint-Kommentare werden importiert';
  }
}

/** Fraction 0–1 of the current import step, or `null` when the API reports no progress. */
export function importFraction(state: ImportState): number | null {
  if (state.status !== 'running' || !state.progress || state.progress.total === 0) return null;
  return state.progress.done / state.progress.total;
}
