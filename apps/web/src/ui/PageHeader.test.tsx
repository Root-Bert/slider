import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';

const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('PageHeader', () => {
  it('renders the title as the 28px page heading', () => {
    inRouter(<PageHeader title="Einstellungen" />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Einstellungen' });
    expect(heading.className).toContain('text-display');
    expect(heading.className).not.toContain('truncate');
  });

  it('shows a back link with the default label', () => {
    inRouter(<PageHeader title="Konto" back={{ to: '/reviews' }} />);
    const link = screen.getByRole('link', { name: 'Zurück zu den Reviews' });
    expect(link.getAttribute('href')).toBe('/reviews');
  });

  it('takes a custom back label', () => {
    inRouter(<PageHeader title="Konto" back={{ to: '/w/1', label: 'Zurück' }} />);
    expect(screen.getByRole('link', { name: 'Zurück' })).toBeTruthy();
  });

  it('puts leading and actions in the title row and can truncate', () => {
    inRouter(
      <PageHeader
        title="Sehr langer Workspace-Name"
        leading={<span data-testid="mark" />}
        actions={<button type="button">Neu</button>}
        truncate
      />,
    );
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.className).toContain('truncate');
    const row = heading.parentElement!;
    expect(row.contains(screen.getByTestId('mark'))).toBe(true);
    expect(row.contains(screen.getByRole('button', { name: 'Neu' }))).toBe(true);
  });

  it('groups title and subtitle; subtitle size is a prop', () => {
    const { rerender } = inRouter(<PageHeader title="Slider einrichten" subtitle="Anmeldung" />);
    const subtitle = screen.getByText('Anmeldung');
    expect(subtitle.className).toContain('text-sm');
    expect(subtitle.closest('hgroup')).toBeTruthy();
    rerender(
      <MemoryRouter>
        <PageHeader title="Neue Review" subtitle="Präsentation öffnen" subtitleSize="body" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Präsentation öffnen').className).toContain('text-body');
  });

  it('inline layout puts the subtitle on the title baseline', () => {
    inRouter(<PageHeader title="Reviews" subtitle="3 Reviews" layout="inline" />);
    expect(screen.getByText('3 Reviews').parentElement!.className).toContain('items-baseline');
  });

  it('centres the block', () => {
    inRouter(<PageHeader title="Willkommen" subtitle="Hallo" align="center" />);
    expect(screen.getByRole('heading').parentElement!.className).toContain('text-center');
  });
});
