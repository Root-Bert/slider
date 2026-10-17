import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDeck } from '../lib/deck-fixture';
import { DeleteDeckDialog } from './DeleteDeckDialog';

const api = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  data: undefined as { succeeded: string[]; failed: { id: string; message: string }[] } | undefined,
}));

vi.mock('@/lib/api', () => ({
  useDeleteDecks: () => ({ mutate: api.mutate, isPending: api.isPending, data: api.data }),
}));

beforeAll(() => {
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

const confirm = () => screen.getByRole('button', { name: /Endgültig löschen/, hidden: true });

function setup(decks = [makeDeck()]) {
  const onClose = vi.fn();
  const onDeleted = vi.fn();
  render(<DeleteDeckDialog decks={decks} onClose={onClose} onDeleted={onDeleted} />);
  return { onClose, onDeleted };
}

type Options = { onSuccess: (result: { succeeded: string[]; failed: unknown[] }) => void };
const lastOptions = () => api.mutate.mock.calls.at(-1)![1] as Options;

describe('DeleteDeckDialog', () => {
  beforeEach(() => {
    api.mutate.mockReset();
    api.isPending = false;
    api.data = undefined;
  });

  it('a single deck: named in the title, closes only when it really went', async () => {
    const { onDeleted } = setup();
    expect(
      screen.getByRole('dialog', { name: '„Q4 Strategie“ löschen?', hidden: true }),
    ).toBeTruthy();
    expect(screen.getByText('Hochgeladene Datei')).toBeTruthy();

    await userEvent.click(confirm());
    expect(api.mutate).toHaveBeenCalledWith(['d1'], expect.anything());
    lastOptions().onSuccess({ succeeded: [], failed: [{ id: 'd1' }] });
    expect(onDeleted).not.toHaveBeenCalled();
    lastOptions().onSuccess({ succeeded: ['d1'], failed: [] });
    expect(onDeleted).toHaveBeenCalledOnce();
  });

  it('several decks: lists five titles and the rest; partial failures go to the caller', async () => {
    const decks = Array.from({ length: 7 }, (_, index) =>
      makeDeck({ id: `d${index}`, title: `Deck ${index}` }),
    );
    const { onDeleted } = setup(decks);
    expect(screen.getByRole('dialog', { name: '7 Reviews löschen?', hidden: true })).toBeTruthy();
    expect(screen.getByText('„Deck 4“')).toBeTruthy();
    expect(screen.queryByText('„Deck 5“')).toBeNull();
    expect(screen.getByText('und 2 weitere')).toBeTruthy();
    expect(screen.getByText('Hochgeladene Dateien')).toBeTruthy();

    await userEvent.click(confirm());
    expect(api.mutate).toHaveBeenCalledWith(
      decks.map((deck) => deck.id),
      expect.anything(),
    );
    lastOptions().onSuccess({ succeeded: ['d0'], failed: [{ id: 'd1' }] });
    expect(onDeleted).toHaveBeenCalledOnce();
  });

  it('shows the reason a deck could not be deleted as an alert', () => {
    api.data = { succeeded: [], failed: [{ id: 'd1', message: 'Keine Berechtigung' }] };
    setup();
    expect(screen.getByRole('alert', { hidden: true }).textContent).toBe('Keine Berechtigung');
  });

  it('busy while deleting; "Abbrechen" closes', async () => {
    api.isPending = true;
    const { onClose } = setup();
    expect(confirm().hasAttribute('disabled')).toBe(true);
    expect(confirm().getAttribute('aria-busy')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen', hidden: true }));
    expect(onClose).toHaveBeenCalled();
  });
});
