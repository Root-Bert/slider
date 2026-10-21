import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { buttonClasses } from './button-classes';
import { ButtonLink } from './ButtonLink';

const classes = (element: Element) => element.getAttribute('class')!.split(/\s+/);
const tokens = (value: string) => value.split(/\s+/);

describe('Button', () => {
  it('is a type=button that fires onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Speichern</Button>);
    const button = screen.getByRole('button', { name: 'Speichern' });
    expect(button.getAttribute('type')).toBe('button');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('disables while loading and reports busy', async () => {
    const onClick = vi.fn();
    render(
      <Button loading icon="add" onClick={onClick}>
        Hochladen
      </Button>,
    );
    const button = screen.getByRole('button', { name: /Hochladen/ });
    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status', { name: 'Lädt' })).toBeTruthy();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('fades to 40 % when disabled', () => {
    render(<Button disabled>Weg</Button>);
    expect(classes(screen.getByRole('button'))).toContain('disabled:opacity-40');
  });

  it('sets aria-expanded only when expanded is given', () => {
    const { rerender } = render(<Button>Menü</Button>);
    expect(screen.getByRole('button').hasAttribute('aria-expanded')).toBe(false);
    rerender(<Button expanded={false}>Menü</Button>);
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
    rerender(
      <Button variant="ghost" expanded>
        Menü
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(classes(button)).toContain('aria-expanded:bg-hover');
  });

  it('renders leading and trailing icons at the size step', () => {
    render(
      <Button size="xs" icon="check" trailingIcon="expandMore">
        Erledigt
      </Button>,
    );
    const icons = screen.getByRole('button').querySelectorAll('svg');
    expect(icons).toHaveLength(2);
    expect(icons[0]!.getAttribute('width')).toBe('14');
    expect(icons[1]!.getAttribute('width')).toBe('14');
  });

  it('uses 16px icons on the 20px 2xs pill', () => {
    render(
      <Button size="2xs" variant="ghost" trailingIcon="expandMore">
        Aufklappen
      </Button>,
    );
    expect(screen.getByRole('button').querySelector('svg')!.getAttribute('width')).toBe('16');
  });

  it('takes an explicit icon size by name or px', () => {
    render(
      <>
        <Button icon="check" iconSize="md">
          A
        </Button>
        <Button icon="check" iconSize={20}>
          B
        </Button>
      </>,
    );
    const [a, b] = screen.getAllByRole('button');
    expect(a!.querySelector('svg')!.getAttribute('width')).toBe('16');
    expect(b!.querySelector('svg')!.getAttribute('width')).toBe('20');
  });
});

describe('buttonClasses', () => {
  it('maps variants to state tokens', () => {
    expect(tokens(buttonClasses({ variant: 'primary' }))).toContain('hover:bg-primary-hover');
    expect(tokens(buttonClasses({ variant: 'secondary' }))).toContain('glass-control');
    expect(tokens(buttonClasses({ variant: 'soft' }))).toEqual(
      expect.arrayContaining(['bg-surface-2', 'hover:bg-selected']),
    );
    expect(tokens(buttonClasses({ variant: 'ghost' }))).toEqual(
      expect.arrayContaining(['text-fg-muted', 'hover:bg-hover']),
    );
    expect(tokens(buttonClasses({ variant: 'danger' }))).toContain('bg-danger/15');
  });

  it('applies tones in place of the variant colours', () => {
    const subtle = tokens(buttonClasses({ variant: 'ghost', tone: 'subtle' }));
    expect(subtle).toContain('text-fg-subtle');
    expect(subtle).not.toContain('text-fg-muted');
    const strong = tokens(buttonClasses({ variant: 'soft', tone: 'strong' }));
    expect(strong).toEqual(expect.arrayContaining(['bg-surface-3', 'hover:bg-surface-4']));
    expect(strong).not.toContain('bg-surface-2');
    expect(tokens(buttonClasses({ variant: 'soft', tone: 'warning' }))).toContain('bg-warning/15');
  });

  it('maps sizes to height, text and radius', () => {
    expect(tokens(buttonClasses({ size: '2xs' }))).toEqual(
      expect.arrayContaining(['h-5', 'text-xs', 'rounded-badge']),
    );
    expect(tokens(buttonClasses({ size: 'xs' }))).toEqual(
      expect.arrayContaining(['h-6', 'text-xs', 'rounded-badge']),
    );
    expect(tokens(buttonClasses({ size: 'sm' }))).toEqual(
      expect.arrayContaining(['h-8', 'text-body', 'rounded-control-sm']),
    );
    expect(tokens(buttonClasses({ size: 'field' }))).toEqual(
      expect.arrayContaining(['h-10', 'text-sm', 'rounded-control']),
    );
    expect(tokens(buttonClasses({ size: 'toolbar' }))).toContain('rounded-panel');
  });

  it('is medium weight unless normal is asked for', () => {
    expect(tokens(buttonClasses())).toContain('font-medium');
    expect(tokens(buttonClasses({ weight: 'normal' }))).not.toContain('font-medium');
  });
});

describe('ButtonLink', () => {
  it('is a link with the button look', () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/konto" variant="secondary" size="sm" icon="settings">
          Konto
        </ButtonLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Konto' });
    expect(link.getAttribute('href')).toBe('/konto');
    expect(classes(link)).toEqual(expect.arrayContaining(['glass-control', 'h-8']));
    expect(link.querySelector('svg')).toBeTruthy();
  });
});
