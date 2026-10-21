import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { SettingsLayout } from './SettingsLayout';

/** The legal links under the layout, seeded empty: no request, nothing rendered. */
function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient();
  client.setQueryData(['legal'], { privacy: null, imprint: null });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

// `header="app"` renders the AppHeader (account and workspace queries); it is covered by the
// pages. The logo header keeps this test free of data.
describe('SettingsLayout', () => {
  it('renders the page header, the sections and the toast region', () => {
    render(
      <Providers>
        <SettingsLayout
          header="logo"
          docTitle="Einrichtung | Slider"
          title="Slider einrichten"
          subtitle="Anmeldung und E-Mail-Versand."
          truncate={false}
          toast={null}
        >
          <section aria-label="Anmeldung">Inhalt</section>
        </SettingsLayout>
      </Providers>,
    );
    expect(screen.getByRole('banner')).toBeTruthy();
    const main = screen.getByRole('main');
    expect(screen.getByRole('heading', { level: 1, name: 'Slider einrichten' })).toBeTruthy();
    expect(main.textContent).toContain('Anmeldung und E-Mail-Versand.');
    expect(main.contains(screen.getByRole('region', { name: 'Anmeldung' }))).toBe(true);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('back link and truncating title by default; no toast region without toast', () => {
    render(
      <Providers>
        <SettingsLayout
          header="logo"
          docTitle="x"
          title="Acme"
          back={{ to: '/w/1' }}
          leading={<span data-testid="mark" />}
        >
          {null}
        </SettingsLayout>
      </Providers>,
    );
    expect(screen.getByRole('link', { name: 'Zurück zu den Reviews' }).getAttribute('href')).toBe(
      '/w/1',
    );
    expect(screen.getByRole('heading', { level: 1 }).className).toContain('truncate');
    expect(screen.getByTestId('mark')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('wide: the dashboard column, with actions in the title row', () => {
    render(
      <Providers>
        <SettingsLayout
          header="logo"
          docTitle="Instanz | Slider"
          title="Instanz"
          width="wide"
          actions={<button type="button">Einstellungen</button>}
        >
          {null}
        </SettingsLayout>
      </Providers>,
    );
    expect(screen.getByRole('main').firstElementChild?.className).toContain('max-w-[1280px]');
    expect(screen.getByRole('button', { name: 'Einstellungen' })).toBeTruthy();
  });
});
