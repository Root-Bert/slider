import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
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
