import { describe, expect, it } from 'vitest';
import { importStatusText, importStepViews } from './import-steps';

describe('importStepViews', () => {
  it('shows the queue on the first step while queued', () => {
    const steps = importStepViews({ status: 'queued' });
    expect(steps.map((step) => step.status)).toEqual(['pending', 'pending', 'pending', 'pending']);
    expect(steps[0]?.label).toBe('In der Warteschlange…');
  });

  it('marks earlier steps done and carries progress on the current one', () => {
    const steps = importStepViews({
      status: 'running',
      step: 'rendering',
      progress: { done: 7, total: 12 },
    });
    expect(steps.map((step) => step.status)).toEqual(['done', 'done', 'current', 'pending']);
    expect(steps[2]?.progress).toEqual({ done: 7, total: 12 });
    expect(importStatusText(steps)).toBe('Schritt 3 von 4: Folien werden gerendert');
  });

  it('is all done when ready', () => {
    const steps = importStepViews({ status: 'ready' });
    expect(steps.every((step) => step.status === 'done')).toBe(true);
    expect(importStatusText(steps)).toBe('Import abgeschlossen');
  });
});

describe('import step labels', () => {
  it('names each step', () => {
    const steps = importStepViews({ status: 'running', step: 'received', progress: null });
    expect(steps.map((step) => step.label)).toEqual([
      'Datei empfangen',
      'Folien erkennen',
      'Folien werden gerendert',
      'PowerPoint-Kommentare importieren',
    ]);
    expect(steps.map((step) => step.status)).toEqual(['current', 'pending', 'pending', 'pending']);
    expect(steps[0]?.progress).toBeNull();
  });

  it('only carries progress on the current step', () => {
    const steps = importStepViews({
      status: 'running',
      step: 'comments',
      progress: { done: 1, total: 2 },
    });
    expect(steps.map((step) => step.progress)).toEqual([null, null, null, { done: 1, total: 2 }]);
    expect(importStatusText(steps)).toBe('Schritt 4 von 4: PowerPoint-Kommentare importieren');
  });

  it('shows nothing as done after a failure; the status names the first step', () => {
    const steps = importStepViews({ status: 'failed', error: 'kaputt' });
    expect(steps.every((step) => step.status === 'pending')).toBe(true);
    expect(importStatusText(steps)).toBe('Datei empfangen');
    expect(importStatusText(importStepViews({ status: 'queued' }))).toBe('In der Warteschlange…');
    expect(importStatusText([])).toBe('Import abgeschlossen');
  });
});
