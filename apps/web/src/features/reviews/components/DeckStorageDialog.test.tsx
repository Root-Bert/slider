import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckStorage } from '@slider/shared';
import { makeDeck } from '../lib/deck-fixture';
import { DeckStorageDialog } from './DeckStorageDialog';

const MB = 1024 * 1024;

const storage = (overrides: Partial<DeckStorage> = {}): DeckStorage => ({
  totalBytes: 30 * MB,
  breakdown: { originals: 20 * MB, slideImages: 8 * MB, media: 2 * MB, other: 0 },
  originalCount: 3,
  reclaimableBytes: 12 * MB,
  olderVersionCount: 2,
  busy: false,
  ...overrides,
});

const api = vi.hoisted(() => ({
  query: {
    data: undefined as DeckStorage | undefined,
    isPending: false,
    isError: false,
    error: null as Error | null,
  },
  mutate: vi.fn(),
  reset: vi.fn(),
  prunePending: false,
  pruneError: null as Error | null,
}));

vi.mock('@/lib/api', () => ({
  useDeckStorage: () => api.query,
  usePruneDeckStorage: () => ({
    mutate: api.mutate,
    reset: api.reset,
    isPending: api.prunePending,
    error: api.pruneError,
  }),
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

const pruneButton = () =>
  screen.getByRole('button', { name: /Alles außer der neuesten Version löschen/, hidden: true });

function setup() {
  const onClose = vi.fn();
  const onPruned = vi.fn();
  render(<DeckStorageDialog deck={makeDeck()} onClose={onClose} onPruned={onPruned} />);
  return { onClose, onPruned };
}

describe('DeckStorageDialog', () => {
  beforeEach(() => {
    api.query = { data: storage(), isPending: false, isError: false, error: null };
    api.mutate.mockReset();
    api.reset.mockReset();
    api.prunePending = false;
    api.pruneError = null;
  });

  it('shows the total and the breakdown by kind', () => {
    setup();
    expect(
      screen.getByRole('dialog', { name: 'Speicherplatz von „Q4 Strategie“', hidden: true }),
    ).toBeTruthy();
    expect(screen.getByText('30 MB')).toBeTruthy();
    expect(screen.getByText('PowerPoint-Dateien')).toBeTruthy();
    expect(screen.getByText('20 MB')).toBeTruthy();
    // One PowerPoint file per stored version.
    expect(screen.getByText('3 History-Versionen')).toBeTruthy();
    expect(screen.getByText('Aufnahmen und Bilder in Kommentaren')).toBeTruthy();
    // Nothing else stored: no "Sonstiges" row.
    expect(screen.queryByText('Sonstiges')).toBeNull();
    // Closing is the × in the header; the action sits under the PowerPoint files.
    expect(screen.getAllByRole('button', { name: 'Schließen', hidden: true })).toHaveLength(1);
  });

  it('confirms with the amount to free, then reports it', async () => {
    const { onPruned } = setup();
    await userEvent.click(pruneButton());
    expect(
      screen.getByRole('dialog', { name: 'Ältere Versionen löschen?', hidden: true }),
    ).toBeTruthy();
    expect(screen.getByText(/Alle Kommentare, Threads und Aufnahmen bleiben/)).toBeTruthy();
    // A failure of an earlier attempt does not linger in a fresh confirmation.
    expect(api.reset).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole('button', { name: /12 MB freigeben/, hidden: true }));
    expect(api.mutate).toHaveBeenCalledOnce();
    const options = api.mutate.mock.calls[0]![1] as {
      onSuccess: (result: { freedBytes: number }) => void;
    };
    options.onSuccess({ freedBytes: 12 * MB });
    expect(onPruned).toHaveBeenCalledWith(12 * MB);
  });

  it('"Abbrechen" in the confirmation goes back to the overview without deleting', async () => {
    const { onClose } = setup();
    await userEvent.click(pruneButton());
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen', hidden: true }));
    expect(api.mutate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(pruneButton()).toBeTruthy();
  });

  it('shows why deleting failed', async () => {
    api.pruneError = new Error('Gerade wird eine Version verarbeitet');
    setup();
    await userEvent.click(pruneButton());
    expect(screen.getByRole('alert', { hidden: true }).textContent).toBe(
      'Gerade wird eine Version verarbeitet',
    );
  });

  it('nothing to free: the action is off', () => {
    api.query.data = storage({ reclaimableBytes: 0, olderVersionCount: 0 });
    setup();
    expect(pruneButton().hasAttribute('disabled')).toBe(true);
  });

  it('while a version is processed the action waits', () => {
    api.query.data = storage({ busy: true });
    setup();
    expect(pruneButton().hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/Gerade wird eine Version verarbeitet/)).toBeTruthy();
  });

  it('in the card thumbnail: a panel in the slot, closed by Escape; confirming stays a dialog', async () => {
    const slot = document.createElement('div');
    document.body.append(slot);
    const onClose = vi.fn();
    render(
      <DeckStorageDialog
        deck={makeDeck()}
        slot={{ element: slot, kind: 'thumbnail' }}
        onClose={onClose}
        onPruned={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    const panel = screen.getByRole('region', { name: 'Speicherplatz' });
    expect(slot.contains(panel)).toBe(true);
    expect(screen.getByText('3 History-Versionen')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /Ältere Versionen löschen/ }));
    expect(
      screen.getByRole('dialog', { name: 'Ältere Versionen löschen?', hidden: true }),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen', hidden: true }));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
    slot.remove();
  });

  it('loading and errors of the overview', () => {
    api.query = { data: undefined, isPending: false, isError: true, error: new Error('Kaputt') };
    setup();
    expect(screen.getByText('Kaputt')).toBeTruthy();
    expect(
      screen.queryByRole('button', {
        name: /Alles außer der neuesten Version löschen/,
        hidden: true,
      }),
    ).toBeNull();
  });
});
