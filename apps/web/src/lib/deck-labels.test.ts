import { describe, expect, it } from 'vitest';
import {
  importActivityLabel,
  importFraction,
  isImporting,
  slidesLabel,
  sourceLabel,
} from './deck-labels';

describe('deck labels', () => {
  it('names every source', () => {
    expect(sourceLabel('onedrive')).toBe('OneDrive');
    expect(sourceLabel('sharepoint')).toBe('SharePoint');
    expect(sourceLabel('url')).toBe('Link');
    expect(sourceLabel('upload')).toBe('Upload');
  });

  it('counts slides', () => {
    expect(slidesLabel(1)).toBe('1 Folie');
    expect(slidesLabel(3)).toBe('3 Folien');
  });
});

describe('import state', () => {
  it('is importing while queued or running', () => {
    expect(isImporting({ import: { status: 'queued' } })).toBe(true);
    expect(isImporting({ import: { status: 'running', step: 'parsing', progress: null } })).toBe(
      true,
    );
    expect(isImporting({ import: { status: 'ready' } })).toBe(false);
    expect(isImporting({ import: { status: 'failed', error: 'x' } })).toBe(false);
  });

  it('describes the running step', () => {
    expect(importActivityLabel({ status: 'queued' })).toBe('In der Warteschlange…');
    const running = (step: 'received' | 'parsing' | 'rendering' | 'comments') =>
      importActivityLabel({ status: 'running', step, progress: null });
    expect(running('received')).toBe('Datei wird verarbeitet');
    expect(running('parsing')).toBe('Folien werden erkannt');
    expect(running('rendering')).toBe('Folien werden gerendert');
    expect(running('comments')).toBe('PowerPoint-Kommentare werden importiert');
  });

  it('gives the fraction of the current step only when there is progress', () => {
    expect(importFraction({ status: 'queued' })).toBeNull();
    expect(importFraction({ status: 'running', step: 'rendering', progress: null })).toBeNull();
    expect(
      importFraction({ status: 'running', step: 'rendering', progress: { done: 0, total: 0 } }),
    ).toBeNull();
    expect(
      importFraction({ status: 'running', step: 'rendering', progress: { done: 2, total: 4 } }),
    ).toBe(0.5);
  });
});
