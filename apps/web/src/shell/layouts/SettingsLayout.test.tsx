import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { SettingsLayout } from './SettingsLayout';

// `header="app"` renders the AppHeader (account and workspace queries); it is covered by the
// pages. The logo header keeps this test free of data.
describe('SettingsLayout', () => {
  it('renders the page header, the sections and the toast region', () => {
    render(
      <MemoryRouter>
        <SettingsLayout
          header="logo"
          docTitle="Einrichtung · Slider"
          title="Slider einrichten"
          subtitle="Anmeldung und E-Mail-Versand."
          truncate={false}
          toast={null}
        >
          <section aria-label="Anmeldung">Inhalt</section>
        </SettingsLayout>
      </MemoryRouter>,
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
      <MemoryRouter>
        <SettingsLayout
          header="logo"
          docTitle="x"
          title="Acme"
          back={{ to: '/w/1' }}
          leading={<span data-testid="mark" />}
        >
          {null}
        </SettingsLayout>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Zurück zu den Reviews' }).getAttribute('href')).toBe(
      '/w/1',
    );
    expect(screen.getByRole('heading', { level: 1 }).className).toContain('truncate');
    expect(screen.getByTestId('mark')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
