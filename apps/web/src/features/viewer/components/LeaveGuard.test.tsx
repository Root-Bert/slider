import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { replyDrafts } from '../comments/lib/reply-drafts';
import { unsavedWork } from '../lib/unsaved-work';
import { LeaveGuard } from './LeaveGuard';

let release: (() => void) | null = null;
const hold = () => {
  act(() => {
    release = unsavedWork.hold();
  });
};

afterEach(() => {
  act(() => {
    release?.();
    release = null;
    replyDrafts.set('t1', '');
  });
});

function setup() {
  const router = createMemoryRouter(
    [
      { path: '/d/:deckId', element: <LeaveGuard /> },
      { path: '/w/:workspaceId', element: <p>Workspace</p> },
    ],
    { initialEntries: ['/d/d1'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** Whether the browser would ask before closing or reloading the tab. */
function unloadAsks(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('LeaveGuard', () => {
  it('lets the review close without unsent work', async () => {
    const router = setup();
    await act(() => router.navigate('/w/w1'));
    expect(router.state.location.pathname).toBe('/w/w1');
    expect(unloadAsks()).toBe(false);
  });

  it('asks before leaving with unsent work – staying keeps it, confirming leaves', async () => {
    const router = setup();
    hold();
    await act(() => router.navigate('/w/w1'));
    expect(router.state.location.pathname).toBe('/d/d1');
    expect(screen.getByRole('dialog', { name: 'Entwurf verwerfen?' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Weiterschreiben' }));
    expect(router.state.location.pathname).toBe('/d/d1');
    expect(screen.queryByRole('dialog')).toBeNull();

    await act(() => router.navigate('/w/w1'));
    await userEvent.click(screen.getByRole('button', { name: 'Verwerfen und verlassen' }));
    expect(router.state.location.pathname).toBe('/w/w1');
  });

  it('never asks for moving between slides (only the query changes)', async () => {
    const router = setup();
    hold();
    await act(() => router.navigate('/d/d1?slide=s2'));
    expect(router.state.location.search).toBe('?slide=s2');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has the browser ask before closing the tab with unsent work or a typed reply', () => {
    setup();
    expect(unloadAsks()).toBe(false);
    hold();
    expect(unloadAsks()).toBe(true);
    act(() => {
      release?.();
      release = null;
    });
    expect(unloadAsks()).toBe(false);
    // A typed reply survives leaving within the app, but not a reload.
    act(() => replyDrafts.set('t1', 'Danke!'));
    expect(unloadAsks()).toBe(true);
  });

  it('lets a typed reply leave within the app – it is kept for the thread', async () => {
    const router = setup();
    act(() => replyDrafts.set('t1', 'Danke!'));
    await act(() => router.navigate('/w/w1'));
    expect(router.state.location.pathname).toBe('/w/w1');
  });
});
