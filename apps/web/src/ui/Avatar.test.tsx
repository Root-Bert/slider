import type { Author } from '@slider/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar, AvatarOverflow, AvatarStack } from './Avatar';

const person = (id: string, name: string): Author =>
  ({ id, name, color: 'blue', type: 'owner' }) as Author;

describe('Avatar', () => {
  it('shows the name as native tooltip and the PowerPoint badge', () => {
    render(<Avatar author={person('1', 'Ada')} showPowerPointBadge />);
    expect(screen.getByTitle('Ada')).toBeTruthy();
    expect(screen.getByLabelText('aus PowerPoint').className).toContain('bg-powerpoint');
  });
});

describe('AvatarOverflow', () => {
  it('shows +n on the raised surface at the given size', () => {
    render(<AvatarOverflow count={3} size={32} title="Bo, Cy, Di" />);
    const chip = screen.getByText('+3');
    expect(chip.className).toContain('bg-surface-raised');
    expect(chip.className).toContain('text-tiny');
    expect(chip.getAttribute('title')).toBe('Bo, Cy, Di');
    expect(chip.style.width).toBe('32px');
  });
});

describe('AvatarStack', () => {
  const people = ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Fu'].map((name, i) => person(String(i), name));

  it('labels the stack with all names and ends with the overflow chip', () => {
    render(<AvatarStack authors={people} max={4} />);
    expect(screen.getByLabelText('Ada, Bo, Cy, Di, Ed, Fu')).toBeTruthy();
    expect(screen.getByText('+2').className).toContain('bg-surface-raised');
  });

  it('shows the fifth avatar instead of a "+1" chip', () => {
    render(<AvatarStack authors={people.slice(0, 5)} max={4} />);
    expect(screen.queryByText('+1')).toBeNull();
  });

  it('interactive: the overflow chip lists the hidden names in a tooltip', () => {
    render(<AvatarStack authors={people} max={4} interactive />);
    const tooltips = screen.getAllByRole('tooltip', { hidden: true });
    expect(tooltips.at(-1)!.textContent).toBe('Ed, Fu');
  });

  it('renders nothing without authors', () => {
    const { container } = render(<AvatarStack authors={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
