import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoadingState } from './LoadingState';

describe('LoadingState', () => {
  it('inline: busy block with a 20px spinner and md padding', () => {
    const { container } = render(<LoadingState />);
    const block = container.firstElementChild!;
    expect(block.tagName).toBe('DIV');
    expect(block.getAttribute('aria-busy')).toBe('true');
    expect(block.className).toContain('py-6');
    expect(screen.getByRole('status', { name: 'Lädt' }).getAttribute('width')).toBe('20');
  });

  it.each([
    ['sm', 'py-4'],
    ['lg', 'py-16'],
  ] as const)('padding %s is %s', (padding, cls) => {
    const { container } = render(<LoadingState padding={padding} />);
    expect(container.firstElementChild!.className).toContain(cls);
  });

  it('full page: main on the dot grid, 28px spinner, min-h-full', () => {
    render(<LoadingState fullPage />);
    const main = screen.getByRole('main');
    expect(main.getAttribute('aria-busy')).toBe('true');
    expect(main.className).toContain('dot-grid');
    expect(main.className).toContain('min-h-full');
    expect(screen.getByRole('status').getAttribute('width')).toBe('28');
  });

  it('full page with screen height and a custom size', () => {
    render(<LoadingState fullPage height="screen" size={24} />);
    expect(screen.getByRole('main').className).toContain('h-dvh');
    expect(screen.getByRole('status').getAttribute('width')).toBe('24');
  });
});
