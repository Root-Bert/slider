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
