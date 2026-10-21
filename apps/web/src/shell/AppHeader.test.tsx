import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppHeader } from './AppHeader';

// The switcher and account menu need account and workspace queries; the logo doesn't.
vi.mock('@/features/workspaces', () => ({
  AccountMenu: () => null,
  WorkspaceSwitcher: () => null,
}));

function logoMark() {
  const link = screen.getByRole('link', { name: 'Slider – Reviews' });
  return link.firstElementChild as HTMLElement;
}

describe('AppHeader', () => {
  it('logo click at home plays a random animation, never the same one twice in a row', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppHeader />
      </MemoryRouter>,
    );
    expect(logoMark().dataset.logoAnim).toBeUndefined();

    let last: string | undefined;
    for (let i = 0; i < 20; i++) {
      fireEvent.click(screen.getByRole('link', { name: 'Slider – Reviews' }));
      const name = logoMark().dataset.logoAnim;
      expect(name).toBeTruthy();
      expect(name).not.toBe(last);
      last = name;
    }

    // A letter's animation ending is not the end; the root's is.
    fireEvent.animationEnd(logoMark().querySelector('[aria-hidden]:not(svg)')!);
    expect(logoMark().dataset.logoAnim).toBe(last);
    fireEvent.animationEnd(logoMark());
    expect(logoMark().dataset.logoAnim).toBeUndefined();
  });

  it('logo still reads as one word', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppHeader />
      </MemoryRouter>,
    );
    expect(logoMark().textContent).toContain('Slider');
    expect(screen.getByText('Slider', { selector: '.sr-only' })).toBeTruthy();
  });
});
