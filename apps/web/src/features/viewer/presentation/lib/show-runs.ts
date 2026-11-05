import type { Slide } from '@slider/shared';
import { showSummaryRows, type SlideMark } from './show-times';

/** Completed runs live on the server; the deck menu shares the query with the presenter. */
export type { ShowRun, ShowRunRow } from '@slider/shared';
import type { ShowRun, ShowRunRow, SavedShowRun } from '@slider/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { sendInParts } from '@/lib/upload-in-parts';
const isRow = (row: unknown): row is ShowRunRow => {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.slideId === 'string' &&
    typeof r.number === 'number' &&
    (typeof r.title === 'string' || r.title === null) &&
    typeof r.thumbnailUrl === 'string' &&
    typeof r.aspectRatio === 'number' &&
    r.aspectRatio > 0 &&
    typeof r.ms === 'number' &&
    r.ms >= 0 &&
    typeof r.skipped === 'boolean'
  );
};

/** A run from the slides shown, the marks on the stopwatch and its end. */
export function showRunOf(
  slides: readonly Slide[],
  marks: readonly SlideMark[],
  total: number,
  at: Date,
): ShowRun {
  return {
    at: at.toISOString(),
    total,
    rows: showSummaryRows(slides, marks, total).map(({ slide, number, ms, skipped }) => ({
      slideId: slide.id,
      number,
      title: slide.title,
      thumbnailUrl: slide.thumbnailUrl,
      aspectRatio: slide.aspectRatio,
      ms,
      skipped,
    })),
  };
}

export function parseShowRun(raw: string | null): ShowRun | null {
  if (!raw) return null;
  try {
    const run = JSON.parse(raw) as Record<string, unknown> | null;
    if (
      !run ||
      typeof run.at !== 'string' ||
      typeof run.total !== 'number' ||
      !Array.isArray(run.rows) ||
      !run.rows.every(isRow)
    )
      return null;
    return { at: run.at, total: run.total, rows: run.rows };
  } catch {
    return null;
  }
}

const runsKey = (deckId: string) => ['show-runs', deckId] as const;
export function useShowRuns(deckId: string): SavedShowRun[] {
  return (
    useQuery({
      queryKey: runsKey(deckId),
      queryFn: () => api.get<SavedShowRun[]>(`/decks/${deckId}/runs`),
    }).data ?? []
  );
}
export function useShowRun(deckId: string): SavedShowRun | null {
  return useShowRuns(deckId)[0] ?? null;
}
/** Only called on a completed show; tab closure never sends unfinished recordings. */
export function useSaveShowRun(deckId: string) {
  const client = useQueryClient();
  return async (run: ShowRun, recording: Blob | null) => {
    const id = crypto.randomUUID();
    const upload = recording
      ? await sendInParts(
          new File([recording], `Aufnahme.${recording.type.includes('mp4') ? 'mp4' : 'webm'}`, {
            type: recording.type,
          }),
          { purpose: 'recording', deckId },
          () => undefined,
          new AbortController().signal,
        )
      : undefined;
    const saved = await api.post<SavedShowRun>(`/decks/${deckId}/runs`, {
      id,
      run,
      ...(upload && { upload }),
    });
    client.setQueryData<SavedShowRun[]>(runsKey(deckId), (before = []) =>
      [saved, ...before.filter((each) => each.id !== id)].slice(0, 5),
    );
  };
}
