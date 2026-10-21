import type * as ApiClient from '@/lib/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DeleteAccountSection } from './DataSections';

const choices = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@/lib/api-client', async (importActual) => {
  const { ApiError } = await importActual<typeof ApiClient>();
  return {
    ApiError,
    api: {
      // The other admin leaves between reading the choices and deleting: then "Team" needs one.
      get: () =>
        Promise.resolve(
          choices.calls++ === 0
            ? []
            : [
                {
                  workspaceId: 'w1',
                  workspaceName: 'Team',
                  candidates: [{ userId: 'u2', name: 'Bob', role: 'member' }],
                },
              ],
        ),
    },
    apiRequest: () =>
      Promise.reject(new ApiError(400, 'bad_request', 'Wähle für „Team“, wer dort Admin wird.')),
  };
});

describe('DeleteAccountSection (BER-145)', () => {
  it('asks for a new admin when the server says one is needed now', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DeleteAccountSection email="anna@firma.de" />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Konto löschen' }));
    await userEvent.type(screen.getByLabelText('E-Mail-Adresse'), 'anna@firma.de');
    const confirm = screen.getAllByRole('button', { name: 'Konto löschen' }).at(-1)!;
    await userEvent.click(confirm);

    expect(await screen.findByText('Wähle für „Team“, wer dort Admin wird.')).toBeTruthy();
    expect(await screen.findByText('Team')).toBeTruthy();
    expect(choices.calls).toBe(2);
    expect(
      (screen.getAllByRole('button', { name: 'Konto löschen' }).at(-1) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
