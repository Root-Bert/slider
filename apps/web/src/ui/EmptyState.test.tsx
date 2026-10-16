import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders title, message, action and an optional illustration', () => {
    render(
      <EmptyState
        title="Noch keine Reviews"
        message="Lade eine Präsentation hoch."
        action={<button type="button">Neue Review</button>}
        illustration={<svg data-testid="art" />}
      />,
    );
    const heading = screen.getByRole('heading', { level: 2, name: 'Noch keine Reviews' });
    expect(heading.className).toContain('text-base');
    expect(screen.getByText('Lade eine Präsentation hoch.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Neue Review' })).toBeTruthy();
    expect(screen.getByTestId('art')).toBeTruthy();
  });

  it('has no illustration by default', () => {
    const { container } = render(<EmptyState title="Leer" message="Nichts da." />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.firstElementChild!.className).toContain('py-20');
  });

  it('lg is a page-level message: h1, 24px, no own padding', () => {
    const { container } = render(<EmptyState size="lg" title="Fehler" message="Neu laden." />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Fehler' });
    expect(heading.className).toContain('text-2xl');
    expect(container.firstElementChild!.className).not.toContain('py-20');
  });

  it('heading level can be set', () => {
    render(<EmptyState title="Leer" message="x" headingLevel={3} />);
    expect(screen.getByRole('heading', { level: 3 })).toBeTruthy();
  });
});
