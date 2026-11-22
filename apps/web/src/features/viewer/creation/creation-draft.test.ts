import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetDrafts } from '@/lib/offline';
import { draftFor, draftOf, hasWords, mergeDrafts, setDraft } from '@/lib/drafts';
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
      key: (index: number) => [...items.keys()][index] ?? null,
      get length() {
        return items.size;
      },
    });
    // The account this browser is on (`accountKey`).
    items.set('slider-last-account', 'u1');
  });

  it('keeps its draft per deck and account until cleared, and takes words heard after what is typed', () => {
    expect(loadCreationDraft('d1')).toEqual(EMPTY_CREATION_DRAFT);
    const draft = { description: 'Pitch für', kind: 'pitch' as const, pages: 14, templateId: null };
    saveCreationDraft('d1', draft);
    // Another deck has its own; a reload reads it back.
    expect(loadCreationDraft('d2')).toEqual(EMPTY_CREATION_DRAFT);
    expect(loadCreationDraft('d1')).toEqual(draft);
    // „Automatisch“ from older drafts is kept as well.
    saveCreationDraft('d1', { ...draft, pages: 'ai' });
    expect(loadCreationDraft('d1').pages).toBe('ai');
    // Broken or foreign storage falls back, never throws.
    localStorage.setItem('slider.creationDraft.d3:u1', '{"description":1');
    expect(loadCreationDraft('d3')).toEqual(EMPTY_CREATION_DRAFT);
    clearCreationDraft('d1');
    expect(loadCreationDraft('d1')).toEqual(EMPTY_CREATION_DRAFT);
    saveCreationDraft('d1', EMPTY_CREATION_DRAFT);
    expect(localStorage.getItem('slider.creationDraft.d1:u1')).toBeNull();

    // Another account on this browser never sees the first one's unsent text (here and in
    // Sender); a switch keeps each one's, signing out drops the account's, older bare keys go.
    saveCreationDraft('d1', draft);
    setDraft('c1', 'Hallo Team');
    localStorage.setItem('slider-last-account', 'u2');
    expect(loadCreationDraft('d1')).toEqual(EMPTY_CREATION_DRAFT);
    expect(draftOf('c1')).toBe('');
    setDraft('c1', 'Servus');
    localStorage.setItem('slider.sender.drafts', '{"c1":{"text":"alt","at":"x"}}');
    forgetDrafts(null);
    expect(localStorage.getItem('slider.sender.drafts')).toBeNull();
    localStorage.setItem('slider-last-account', 'u1');
    expect(loadCreationDraft('d1')).toEqual(draft);
    expect(draftOf('c1')).toBe('Hallo Team');
    forgetDrafts({ userId: 'u1' });
    expect(loadCreationDraft('d1')).toEqual(EMPTY_CREATION_DRAFT);
    expect(localStorage.getItem('slider.sender.drafts:u1')).toBeNull();
    expect(localStorage.getItem('slider.sender.drafts:u2')).toContain('Servus');
    forgetDrafts('everyone');
    expect(localStorage.getItem('slider.sender.drafts:u2')).toBeNull();

    // Drafts are the account's on the server too; its list laid over this browser's: an older
    // one of this browser for a conversation of the workspace gets its place (and goes up), a
    // new mail with only an address is a draft, the newer wins, one the server no longer has
    // (sent or thrown away elsewhere) goes – unless it still waits to go up.
    vi.useFakeTimers();
    localStorage.setItem('slider-last-account', 'u3');
    const old = '2026-01-01T00:00:00.000Z';
    localStorage.setItem(
      'slider.sender.drafts:u3',
      JSON.stringify({ c9: { text: 'alt', at: old }, other: { text: 'fremd', at: old } }),
    );
    const newMail = {
      key: 'mail-new:w1',
      text: '',
      target: { kind: 'mail-new' as const, accountId: '', to: 'a@b.de', subject: 'Zahlen' },
      at: '2026-01-02T00:00:00.000Z',
    };
    mergeDrafts('w1', [newMail], Date.now(), new Set(['c9']));
    expect(draftFor('c9')).toMatchObject({
      text: 'alt',
      target: { kind: 'conversation', workspaceId: 'w1' },
    });
    expect(draftFor('c9')?.synced).toBeUndefined();
    expect(draftFor('other')?.target).toBeUndefined();
    expect(hasWords(draftFor('mail-new:w1'))).toBe(true);
    expect(draftFor('mail-new:w1')?.synced).toBe(true);
    setDraft('mail-new:w1', 'Hallo');
    mergeDrafts('w1', [newMail], Date.now(), new Set());
    expect(draftOf('mail-new:w1')).toBe('Hallo');
    const later = {
      key: 'c9',
      text: 'neu',
      target: { kind: 'conversation' as const },
      at: '2099-01-01T00:00:00.000Z',
    };
    mergeDrafts('w1', [later], Date.now(), new Set());
    expect(draftFor('c9')).toMatchObject({ text: 'neu', synced: true });
    mergeDrafts('w1', [], Date.now(), new Set());
    expect(draftFor('c9')).toBeUndefined();
    expect(draftOf('mail-new:w1')).toBe('Hallo');
    expect(draftOf('other')).toBe('fremd');
    vi.useRealTimers();

    expect(joinHeard('', '  Investoren')).toBe('Investoren');
    expect(joinHeard('Pitch für', 'Investoren')).toBe('Pitch für Investoren');
    expect(joinHeard('Pitch für ', 'Investoren')).toBe('Pitch für Investoren');
    // The live stream hands over parts of words: they go on where the last stopped…
    expect(joinHeard('Pitch für Invest', 'oren', 'Pitch für Invest')).toBe('Pitch für Investoren');
    // …unless something was typed since.
    expect(joinHeard('Pitch für X', 'oren', 'Pitch für Invest')).toBe('Pitch für X oren');
  });
});
