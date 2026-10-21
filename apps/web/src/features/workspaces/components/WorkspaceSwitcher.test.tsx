import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

const api = vi.hoisted(() => ({ me: null as unknown }));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  useMe: () => ({ data: api.me }),
  useAcceptInvite: () => ({
    isPending: false,
    mutate: (_id: string, options: { onSuccess: (result: unknown) => void }) =>
      options.onSuccess({ workspace: { id: 'B' }, deckId: null }),
  }),
}));

const workspace = (id: string, name: string) => ({
  id,
  name,
  logoUrl: null,
  role: 'admin',
});

// jsdom has no matchMedia; a wide screen puts the "Neue Organisation" choices beside the menu.
beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

describe('WorkspaceSwitcher – pending invites', () => {
  it('"Beitreten" closes the menu before going to the new organisation', async () => {
    api.me = {
      user: { id: 'u1', name: 'Anna' },
      workspaces: [workspace('A', 'Alpha')],
      pendingInvites: [
        {
          id: 'i1',
          workspaceId: 'B',
          workspaceName: 'Beta',
          inviterName: null,
          role: 'member',
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          deck: null,
        },
      ],
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/w/A']}>
          <Routes>
            {/* /w/A → /w/B keeps this element (and the header) mounted, as in the app. */}
            <Route
              path="/w/:workspaceId"
              element={
                <>
                  <WorkspaceSwitcher />
                  <Where />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Organisation: Alpha/ }));
    await user.click(screen.getByRole('button', { name: 'Beitreten' }));
    expect(screen.getByTestId('where').textContent).toBe('/w/B');
    expect(screen.queryByRole('button', { name: 'Beitreten' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mit Einladung beitreten' })).toBeNull();
  });
});

describe('WorkspaceSwitcher – settings per organisation', () => {
  it('every row has its own settings button; the bottom "Organisation verwalten" row is gone', async () => {
    api.me = {
      user: { id: 'u1', name: 'Anna' },
      workspaces: [workspace('A', 'Alpha'), workspace('B', 'Beta')],
      pendingInvites: [],
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/w/A']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <WorkspaceSwitcher />
                  <Where />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Organisation: Alpha/ }));
    expect(screen.getByRole('button', { name: 'Alpha verwalten' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Organisation verwalten' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Beta verwalten' }));
    expect(screen.getByTestId('where').textContent).toBe('/w/B/einstellungen');
    expect(screen.queryByRole('button', { name: 'Alpha verwalten' })).toBeNull();
  });
});

function renderSwitcher() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/w/A']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <WorkspaceSwitcher />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

describe('WorkspaceSwitcher – invite and new organisation', () => {
  it('members of an organisation get no invite button', async () => {
    api.me = {
      user: { id: 'u1', name: 'Anna' },
      workspaces: [{ ...workspace('A', 'Alpha'), role: 'member' }],
      pendingInvites: [],
    };
    const user = renderSwitcher();
    await user.click(screen.getByRole('button', { name: /^Organisation: Alpha/ }));
    expect(screen.queryByRole('button', { name: 'Mitglieder zu Alpha einladen' })).toBeNull();
  });

  it('every organisation the user administers has an invite button in its row', async () => {
    api.me = {
      user: { id: 'u1', name: 'Anna' },
      workspaces: [workspace('A', 'Alpha'), workspace('B', 'Beta')],
      pendingInvites: [],
    };
    const user = renderSwitcher();
    await user.click(screen.getByRole('button', { name: /^Organisation: Alpha/ }));
    expect(screen.getByRole('button', { name: 'Mitglieder zu Alpha einladen' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Mitglieder zu Beta einladen' }));
    expect(screen.getByTestId('where').textContent).toBe('/w/B/einstellungen');
  });

  it('"Neue Organisation" folds out joining first, then creating', async () => {
    api.me = {
      user: { id: 'u1', name: 'Anna' },
      workspaces: [workspace('A', 'Alpha')],
      pendingInvites: [],
    };
    const user = renderSwitcher();
    await user.click(screen.getByRole('button', { name: /^Organisation: Alpha/ }));
    expect(screen.queryByRole('button', { name: 'Mit Einladung beitreten' })).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Neue Organisation' });
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const join = screen.getByRole('button', { name: 'Mit Einladung beitreten' });
    const create = screen.getByRole('button', { name: 'Eigene erstellen' });
    expect(join.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(toggle);
    expect(screen.queryByRole('button', { name: 'Mit Einladung beitreten' })).toBeNull();
  });
});
