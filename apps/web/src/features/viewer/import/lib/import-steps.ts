import { IMPORT_STEPS, type ImportState, type ImportStep } from '@slider/shared';

export const IMPORT_STEP_LABELS: Record<ImportStep, string> = {
  received: 'Datei empfangen',
  parsing: 'Folien erkennen',
  rendering: 'Folien werden gerendert',
  comments: 'PowerPoint-Kommentare importieren',
};

export type StepStatus = 'done' | 'current' | 'pending';

export interface ImportStepView {
  step: ImportStep;
  label: string;
  status: StepStatus;
  progress: { done: number; total: number } | null;
}

/** Maps the deck's import state onto the four-step checklist of A2 (BER-97). */
export function importStepViews(state: ImportState): ImportStepView[] {
  const currentIndex =
    state.status === 'running'
      ? IMPORT_STEPS.indexOf(state.step)
      : state.status === 'ready'
        ? IMPORT_STEPS.length
        : -1;

  return IMPORT_STEPS.map((step, index) => ({
    step,
    label: queuedLabel(state, index) ?? IMPORT_STEP_LABELS[step],
    status: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'pending',
    progress: state.status === 'running' && index === currentIndex ? state.progress : null,
  }));
}

const queuedLabel = (state: ImportState, index: number) =>
  state.status === 'queued' && index === 0 ? 'In der Warteschlange…' : null;

/** Screen-reader summary, e.g. "Schritt 3 von 4: Folien werden gerendert". */
export function importStatusText(steps: readonly ImportStepView[]): string {
  const index = steps.findIndex((step) => step.status === 'current');
  const current = steps[index];
  if (!current)
    return steps.every((step) => step.status === 'done')
      ? 'Import abgeschlossen'
      : (steps[0]?.label ?? '');
  return `Schritt ${index + 1} von ${steps.length}: ${current.label}`;
}
