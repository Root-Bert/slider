import { describe, expect, it } from 'vitest';
import type { BulkResult } from '@/lib/api';
import { failureMessage, movedMessage, withCount } from './bulk-messages';

const result = (done: number, failed: string[] = []): BulkResult<unknown> => ({
  done: Array.from({ length: done }, (_, index) => ({ deckId: `d${index}`, result: null })),
  failed: failed.map((message, index) => ({ deckId: `f${index}`, message })),
});

describe('withCount', () => {
  it('adds the count only when the action covers part of the selection', () => {
    expect(withCount('Archivieren', 2, 3)).toBe('Archivieren (2)');
    expect(withCount('Archivieren', 3, 3)).toBe('Archivieren');
  });
});

describe('failureMessage', () => {
  it('is null when everything went through', () => {
    expect(failureMessage(result(2), 'archiviert')).toBeNull();
  });

  it('names the failures with the first reason', () => {
    expect(failureMessage(result(0, ['Kein Zugriff']), 'gelöscht')).toBe(
      '1 Review konnte nicht gelöscht werden: Kein Zugriff',
    );
    expect(failureMessage(result(1, ['A', 'B']), 'archiviert')).toBe(
      '2 Reviews konnten nicht archiviert werden: A',
    );
  });
});

describe('movedMessage', () => {
  it('reports failures as danger', () => {
    expect(movedMessage(result(1, ['Ordner fehlt', 'x']), 'Q4')).toEqual({
      text: '2 Reviews konnten nicht verschoben werden: Ordner fehlt',
      tone: 'danger',
    });
  });

  it('says where the decks went', () => {
    expect(movedMessage(result(2), 'Q4')).toEqual({ text: '2 Reviews nach „Q4“ verschoben' });
    expect(movedMessage(result(1), null)).toEqual({ text: '1 Review aus dem Ordner genommen' });
  });
});
