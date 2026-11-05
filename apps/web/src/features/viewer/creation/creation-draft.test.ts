import { beforeEach, describe, expect, it, vi } from 'vitest';
import { joinHeard } from '../voice/lib/heard-words';
import {
  clearCreationDraft,
  EMPTY_CREATION_DRAFT,
  loadCreationDraft,
  saveCreationDraft,
} from './creation-draft';

describe('Folie 1 prompt', () => {
  // No DOM here: a localStorage of its own.
  beforeEach(() => {
    const items = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    });
  });

  it('keeps its draft per deck until cleared, and takes words heard after what is typed', () => {
    expect(loadCreationDraft('d1')).toEqual(EMPTY_CREATION_DRAFT);
    const draft = { description: 'Pitch für', kind: 'pitch' as const, pages: 14, templateId: null };
    saveCreationDraft('d1', draft);
    // Another deck has its own; a reload reads it back.
    expect(loadCreationDraft('d2')).toEqual(EMPTY_CREATION_DRAFT);
    expect(loadCreationDraft('d1')).toEqual(draft);
    // Broken or foreign storage falls back, never throws.
    localStorage.setItem('slider.creationDraft.d3', '{"description":1');
    expect(loadCreationDraft('d3')).toEqual(EMPTY_CREATION_DRAFT);
    clearCreationDraft('d1');
    expect(loadCreationDraft('d1')).toEqual(EMPTY_CREATION_DRAFT);
    saveCreationDraft('d1', EMPTY_CREATION_DRAFT);
    expect(localStorage.getItem('slider.creationDraft.d1')).toBeNull();

    expect(joinHeard('', '  Investoren')).toBe('Investoren');
    expect(joinHeard('Pitch für', 'Investoren')).toBe('Pitch für Investoren');
    expect(joinHeard('Pitch für ', 'Investoren')).toBe('Pitch für Investoren');
    // The live stream hands over parts of words: they go on where the last stopped…
    expect(joinHeard('Pitch für Invest', 'oren', 'Pitch für Invest')).toBe('Pitch für Investoren');
    // …unless something was typed since.
    expect(joinHeard('Pitch für X', 'oren', 'Pitch für Invest')).toBe('Pitch für X oren');
  });
});
