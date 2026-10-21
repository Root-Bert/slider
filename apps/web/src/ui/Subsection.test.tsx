import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Subsection } from './Subsection';

describe('Subsection', () => {
  it('is a region named by its h3, with icon, description, aside and content', () => {
    render(
      <Subsection
        title="Nextcloud"
        icon={<span data-testid="mark" />}
        description="Über das Konto auf demselben Server."
        aside={<button type="button">Verbinden</button>}
      >
        <p>Inhalt</p>
      </Subsection>,
    );
    const region = screen.getByRole('region', { name: 'Nextcloud' });
    expect(screen.getByRole('heading', { level: 3, name: 'Nextcloud' })).toBeTruthy();
    expect(screen.getByTestId('mark')).toBeTruthy();
    expect(region.textContent).toContain('Über das Konto auf demselben Server.');
    expect(screen.getByRole('button', { name: 'Verbinden' })).toBeTruthy();
    expect(region.textContent).toContain('Inhalt');
  });
});
