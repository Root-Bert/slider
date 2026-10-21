import type * as ApiClient from '@/lib/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Component as DataRequestPage } from './DataRequestPage';

const successors = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@/lib/api-client', async (importActual) => {
  const { ApiError } = await importActual<typeof ApiClient>();
  return {
    ApiError,
    api: {
      get: (path: string) => {
        if (!path.endsWith('/successors')) {
          return Promise.resolve({
            purpose: 'delete',
            email: 'anna@firma.de',
            hasAccount: true,
            expiresAt: '2026-10-20T12:00:00.000Z',
          });
        }
        // The other admin leaves between reading the choices and deleting: "Team" needs one.
        return Promise.resolve(
          successors.calls++ === 0
            ? []
            : [
                {
                  workspaceId: 'w1',
                  workspaceName: 'Team',
                  candidates: [{ userId: 'u2', name: 'Bob', role: 'member' }],
                },
              ],
        );
      },
      post: () =>
        Promise.reject(new ApiError(400, 'bad_request', 'Wähle für „Team“, wer dort Admin wird.')),
    },
    apiRequest: () => Promise.resolve(undefined),
  };
});

describe('DataRequestPage (BER-146)', () => {
  it('asks for a new admin when the server says one is needed now', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/daten/t1']}>
          <Routes>
            <Route path="/daten/:token" element={<DataRequestPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Endgültig löschen' }));

    expect(await screen.findByText('Wähle für „Team“, wer dort Admin wird.')).toBeTruthy();
    expect(await screen.findByText('Team')).toBeTruthy();
    expect(successors.calls).toBe(2);
    expect(
      (screen.getByRole('button', { name: 'Endgültig löschen' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
