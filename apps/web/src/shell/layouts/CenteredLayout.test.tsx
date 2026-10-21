import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { CenteredCard, CenteredLayout } from './CenteredLayout';

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

describe('CenteredLayout', () => {
  it('renders the logo header, the main column and the header end', () => {
    render(
      <Providers>
        <CenteredLayout
          docTitle="Einladung | Slider"
          logoLink={{ to: '/', label: 'Slider' }}
          headerEnd={<button type="button">Konto</button>}
        >
          <p>Karte</p>
        </CenteredLayout>
      </Providers>,
    );
    expect(screen.getByRole('banner').contains(screen.getByRole('link', { name: 'Slider' }))).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Konto' })).toBeTruthy();
    expect(screen.getByRole('main').textContent).toContain('Karte');
  });

  it('logo is not a link without logoLink', () => {
    render(
      <Providers>
        <CenteredLayout docTitle="Anmelden | Slider">x</CenteredLayout>
      </Providers>,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('CenteredCard', () => {
  it('is a region named by its h1, with eyebrow, message and children', () => {
    render(
      <CenteredCard
        icon={<svg data-testid="icon" />}
        eyebrow="Einladung"
        title="Acme beitreten"
        message="Du wurdest eingeladen."
        titleId="join-title"
      >
        <button type="button">Beitreten</button>
      </CenteredCard>,
    );
    const region = screen.getByRole('region', { name: 'Acme beitreten' });
    expect(screen.getByRole('heading', { level: 1 }).id).toBe('join-title');
    expect(region.textContent).toContain('Einladung');
    expect(region.textContent).toContain('Du wurdest eingeladen.');
    expect(screen.getByTestId('icon').parentElement!.className).toContain('size-14');
  });

  it('compact density with an h2', () => {
    render(
      <CenteredCard icon="x" title="Kein Zugriff" message="m" headingLevel={2} density="compact" />,
    );
    expect(screen.getByRole('heading', { level: 2 })).toBeTruthy();
    expect(screen.getByRole('region').className).toContain('px-8');
  });
});
