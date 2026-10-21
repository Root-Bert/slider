import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Component as DataRequestFormPage } from './DataRequestFormPage';

const posted = vi.hoisted(() => [] as { path: string; body: unknown }[]);
vi.mock('@/lib/api-client', () => ({
  api: {
    post: (path: string, body: unknown) => {
      posted.push({ path, body });
      return Promise.resolve({ ok: true });
    },
  },
  apiRequest: () => Promise.resolve(undefined),
}));

describe('DataRequestFormPage (BER-146)', () => {
  it('asks for a deletion link and answers without telling whether the address is known', async () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <DataRequestFormPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText('Wie wird geprüft, dass du es bist?')).toBeTruthy();

    await userEvent.click(screen.getByRole('radio', { name: 'Daten löschen' }));
    await userEvent.type(screen.getByLabelText('E-Mail-Adresse'), 'anna@firma.de');
    await userEvent.click(screen.getByRole('button', { name: 'Link anfordern' }));

    expect(posted).toEqual([
      { path: '/data-requests', body: { email: 'anna@firma.de', purpose: 'delete' } },
    ]);
    expect(await screen.findByText('Schau in dein Postfach')).toBeTruthy();
    expect(screen.getByText(/Falls Slider Daten zu anna@firma.de speichert/)).toBeTruthy();
  });
});
