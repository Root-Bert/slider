import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CountBubble } from './CountBubble';

const classes = (element: Element) => element.getAttribute('class')!.split(/\s+/);

describe('CountBubble', () => {
  it('shows the count, is named by its label and clicks', async () => {
    const onClick = vi.fn();
    render(
      <CountBubble
        count={3}
        color="blue"
        aria-label="3 Kommentare zwischen den Folien"
        data-gap-marker
        onClick={onClick}
      />,
    );
    const bubble = screen.getByRole('button', { name: '3 Kommentare zwischen den Folien' });
    expect(bubble.textContent).toBe('3');
    expect(bubble.getAttribute('type')).toBe('button');
    expect(bubble.hasAttribute('data-gap-marker')).toBe(true);
    expect(bubble.style.backgroundColor).toContain('--color-accent-blue');
    await userEvent.click(bubble);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('dims to half opacity and has two sizes', () => {
    const { rerender } = render(<CountBubble count={1} color="red" aria-label="1" dim />);
    const bubble = () => screen.getByRole('button');
    expect(bubble().style.opacity).toBe('0.5');
    expect(classes(bubble())).toEqual(expect.arrayContaining(['h-5', 'min-w-5']));
    rerender(<CountBubble count={1} color="red" aria-label="1" size="md" />);
    expect(bubble().style.opacity).toBe('1');
    expect(classes(bubble())).toEqual(expect.arrayContaining(['h-6', 'min-w-6']));
  });
});
