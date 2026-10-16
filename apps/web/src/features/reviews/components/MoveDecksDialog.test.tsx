import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDeck } from '../lib/deck-fixture';
import { MoveDecksDialog } from './MoveDecksDialog';

const api = vi.hoisted(() => ({
  update: vi.fn(),
  create: vi.fn(),
  pending: false,
}));

vi.mock('@/lib/api', () => ({
  useFolders: () => ({
    data: [
      { id: 'f1', name: 'Kunden' },
      { id: 'f2', name: 'Intern' },
    ],
  }),
  useCreateFolder: () => ({ mutate: api.create, isPending: false, error: null }),
  useUpdateDecks: () => ({ mutate: api.update, isPending: api.pending, error: null }),
}));

beforeAll(() => {
  // happy-dom may lack the modal API; the behaviour under test doesn't depend on the top layer.
  const proto = HTMLDialogElement.prototype;
  if (!proto.showModal) {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  }
  if (!proto.close) {
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  }
});

const option = (name: string | RegExp) => screen.getByRole('button', { name, hidden: true });

function setup(decks = [makeDeck({ folderId: 'f1' })]) {
  const onMoved = vi.fn();
  render(<MoveDecksDialog decks={decks} workspaceId="w1" onClose={vi.fn()} onMoved={onMoved} />);
  return { onMoved };
}

describe('MoveDecksDialog', () => {
  beforeEach(() => {
    api.update.mockReset();
    api.create.mockReset();
    api.pending = false;
  });

  it('names the deck and marks its current folder, which cannot be picked', () => {
    setup();
    expect(
      screen.getByRole('dialog', { name: '„Q4 Strategie“ verschieben', hidden: true }),
    ).toBeTruthy();
    const current = option(/Kunden/);
    expect(current.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('img', { name: 'Aktueller Ort', hidden: true })).toBeTruthy();
    // Shown with a check at full strength, not dimmed like a switched-off row.
    expect(current.className).not.toContain('opacity-40');
    expect(option('Intern').hasAttribute('disabled')).toBe(false);
  });

  it('moves every deck to the picked folder and reports its name', async () => {
    const { onMoved } = setup([makeDeck({ id: 'a' }), makeDeck({ id: 'b', folderId: 'f2' })]);
    expect(
      screen.getByRole('dialog', { name: '2 Reviews verschieben', hidden: true }),
    ).toBeTruthy();
    // Mixed origins: no current location, every target is available.
    expect(option('Kein Ordner').hasAttribute('disabled')).toBe(false);

    await userEvent.click(option('Intern'));
    expect(api.update).toHaveBeenCalledWith(
      { deckIds: ['a', 'b'], input: { folderId: 'f2' } },
      expect.anything(),
    );
    const { onSuccess } = api.update.mock.calls[0]![1] as { onSuccess: (r: unknown) => void };
    onSuccess({ succeeded: [], failed: [] });
    expect(onMoved).toHaveBeenCalledWith({ succeeded: [], failed: [] }, 'Intern');
  });

  it('"Kein Ordner" moves out of any folder', async () => {
    setup();
    await userEvent.click(option('Kein Ordner'));
    expect(api.update).toHaveBeenCalledWith(
      { deckIds: ['d1'], input: { folderId: null } },
      expect.anything(),
    );
  });

  it('blocks every option while a move runs', () => {
    api.pending = true;
    setup();
    expect(option('Intern').hasAttribute('disabled')).toBe(true);
    expect(option('Kein Ordner').hasAttribute('disabled')).toBe(true);
  });

  it('creates a new folder on submit and moves into it', async () => {
    setup();
    const add = option('Anlegen');
    expect(add.hasAttribute('disabled')).toBe(true);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Neuer Ordner', hidden: true }),
      '  Archiv 2026 {Enter}',
    );
    expect(api.create).toHaveBeenCalledWith('Archiv 2026', expect.anything());
    const { onSuccess } = api.create.mock.calls[0]![1] as {
      onSuccess: (folder: { id: string; name: string }) => void;
    };
    onSuccess({ id: 'f3', name: 'Archiv 2026' });
    expect(api.update).toHaveBeenCalledWith(
      { deckIds: ['d1'], input: { folderId: 'f3' } },
      expect.anything(),
    );
  });
});
