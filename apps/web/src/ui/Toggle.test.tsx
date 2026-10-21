import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Toggle } from './Toggle';

const classes = (element: Element) => element.getAttribute('class')!.split(/\s+/);

describe('Toggle', () => {
  it('is a switch named by its label that flips on click', async () => {
    const onChange = vi.fn();
    render(<Toggle label="Benachrichtigungen" checked={false} onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Benachrichtigungen' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('flips from the label too, and with the keyboard', async () => {
    const onChange = vi.fn();
    render(<Toggle label="Töne" description="Beim Aufnehmen" checked onChange={onChange} />);
    await userEvent.click(screen.getByText('Töne'));
    expect(onChange).toHaveBeenLastCalledWith(false);
    screen.getByRole('switch').focus();
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('does nothing when disabled', async () => {
    const onChange = vi.fn();
    render(<Toggle label="Töne" checked={false} disabled onChange={onChange} />);
    const toggle = screen.getByRole('switch');
    expect(classes(toggle)).toContain('disabled:opacity-40');
    await userEvent.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('has md and sm tracks', () => {
    const { rerender } = render(<Toggle label="A" checked onChange={() => {}} />);
    expect(classes(screen.getByRole('switch'))).toEqual(
      expect.arrayContaining(['h-5', 'w-9', 'bg-primary']),
    );
    rerender(<Toggle label="A" checked={false} size="sm" onChange={() => {}} />);
    expect(classes(screen.getByRole('switch'))).toEqual(
      expect.arrayContaining(['h-4', 'w-7', 'bg-surface-4']),
    );
  });

  it('shows an icon before the label when given one, without changing the name', () => {
    const { container } = render(
      <Toggle label="Hilfslinien zeigen" icon="guides" checked={false} onChange={() => {}} />,
    );
    expect(container.querySelector('label svg')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Hilfslinien zeigen' })).toBeTruthy();
  });
});
