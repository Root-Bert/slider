import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { DeckFolder } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { useOpenFolder } from './useOpenFolder';

const folder = { id: 'f1', name: 'Kunde A' } as DeckFolder;

function Probe({ loaded }: { loaded: boolean }) {
  const { openFolder, openFolderById } = useOpenFolder([folder], loaded);
  return (
    <>
      <p>{openFolder?.name ?? 'oben'}</p>
      <button onClick={() => openFolderById('f1')}>öffnen</button>
    </>
  );
}

function setup(entries: string[], loaded = true) {
  const router = createMemoryRouter(
    [
      { path: '/start', element: <p>Start</p> },
      { path: '/reviews', element: <Probe loaded={loaded} /> },
    ],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('useOpenFolder', () => {
  it('a stale ?ordner= is replaced, so Back leaves the page instead of coming back', async () => {
    const router = setup(['/start', '/reviews?ordner=geloescht']);
    expect(router.state.location.search).toBe('');
    expect(router.state.historyAction).toBe('REPLACE');

    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/start');
  });

  it('waits for the folders before dropping an unknown one', () => {
    const router = setup(['/reviews?ordner=neu'], false);
    expect(router.state.location.search).toBe('?ordner=neu');
  });

  it('opening a folder adds a history entry', async () => {
    const router = setup(['/reviews']);
    await userEvent.click(screen.getByRole('button', { name: 'öffnen' }));
    expect(router.state.location.search).toBe('?ordner=f1');
    expect(router.state.historyAction).toBe('PUSH');
    expect(screen.getByText('Kunde A')).toBeTruthy();
  });
});
