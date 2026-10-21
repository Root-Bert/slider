import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { iconButtonClasses } from './icon-button-classes';
import { IconButton } from './IconButton';

const classes = (element: Element) => element.getAttribute('class')!.split(/\s+/);
const tokens = (value: string) => value.split(/\s+/);

describe('IconButton', () => {
  it('is named by its label, which is also the tooltip', async () => {
    const onClick = vi.fn();
    render(<IconButton icon="close" label="Schließen" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Schließen' });
    expect(button.getAttribute('title')).toBe('Schließen');
    expect(button.getAttribute('type')).toBe('button');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('keeps a separate title, or none', () => {
    render(
      <>
        <IconButton icon="close" label="Verwerfen" title="Verwerfen (Esc)" />
        <IconButton icon="close" label="Abspielen" title={false} />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Verwerfen' }).getAttribute('title')).toBe(
      'Verwerfen (Esc)',
    );
    expect(screen.getByRole('button', { name: 'Abspielen' }).hasAttribute('title')).toBe(false);
  });

  it('marks active as pressed and selected', () => {
    render(<IconButton icon="add" label="Stift" active />);
    const button = screen.getByRole('button', { name: 'Stift' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(classes(button)).toEqual(expect.arrayContaining(['bg-selected', 'text-fg']));
    expect(classes(button)).not.toContain('text-fg-muted');
  });

  it('lets a two-state toggle set aria-pressed itself (the resolve check)', () => {
    render(
      <IconButton
        icon="check"
        label="Als erledigt markieren"
        variant="subtle"
        size="compact"
        iconTone="success"
        aria-pressed={false}
      />,
    );
    const button = screen.getByRole('button', { name: 'Als erledigt markieren' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(classes(button)).toEqual(expect.arrayContaining(['text-success', 'rounded-chip']));
    expect(classes(button)).not.toContain('text-fg-subtle');
  });

  it('marks expanded with aria-expanded but never aria-pressed', () => {
    render(<IconButton icon="add" label="Mehr" expanded />);
    const button = screen.getByRole('button', { name: 'Mehr' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.hasAttribute('aria-pressed')).toBe(false);
    expect(classes(button)).toContain('aria-expanded:bg-hover');
  });

  it('does not click when disabled', async () => {
    const onClick = vi.fn();
    render(<IconButton icon="add" label="Neu" disabled onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Neu' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('sizes the icon per size step unless overridden', () => {
    render(
      <>
        <IconButton icon="add" label="xs" size="xs" />
        <IconButton icon="add" label="sm" size="sm" />
        <IconButton icon="add" label="md" />
        <IconButton icon="add" label="custom" size="sm" iconSize="lg" />
      </>,
    );
    const width = (name: string) =>
      screen.getByRole('button', { name }).querySelector('svg')!.getAttribute('width');
    expect(width('xs')).toBe('18');
    expect(width('sm')).toBe('20');
    expect(width('md')).toBe('24');
    expect(width('custom')).toBe('18');
  });
});

describe('iconButtonClasses', () => {
  it('follows the concentric radius per size', () => {
    expect(tokens(iconButtonClasses({ size: 'xs' }))).toEqual(
      expect.arrayContaining(['size-6', 'rounded-badge']),
    );
    expect(tokens(iconButtonClasses({ size: 'compact' }))).toEqual(
      expect.arrayContaining(['size-7', 'rounded-chip']),
    );
    expect(tokens(iconButtonClasses({ size: 'sm' }))).toEqual(
      expect.arrayContaining(['size-8', 'rounded-control']),
    );
    expect(tokens(iconButtonClasses({ size: 'lg' }))).toContain('size-9');
    expect(tokens(iconButtonClasses({ size: 'md' }))).toContain('size-10');
  });

  it('swaps the radius for round', () => {
    const round = tokens(iconButtonClasses({ size: 'lg', shape: 'round' }));
    expect(round).toContain('rounded-full');
    expect(round).not.toContain('rounded-control');
  });

  it('maps variants to tokens', () => {
    expect(tokens(iconButtonClasses({ variant: 'subtle' }))).toContain('text-fg-subtle');
    expect(tokens(iconButtonClasses({ variant: 'glass' }))).toContain('glass-control');
    expect(tokens(iconButtonClasses({ variant: 'primary' }))).toEqual(
      expect.arrayContaining(['bg-primary', 'text-on-primary', 'hover:bg-primary-hover']),
    );
    expect(tokens(iconButtonClasses({ variant: 'danger' }))).toContain('bg-danger');
  });

  it('tints the icon and dims instead of fading', () => {
    const send = tokens(
      iconButtonClasses({ variant: 'subtle', iconTone: 'success', disabledStyle: 'dim' }),
    );
    expect(send).toEqual(expect.arrayContaining(['text-success', 'disabled:text-fg-faint']));
    expect(send).not.toContain('text-fg-subtle');
    expect(send).not.toContain('disabled:opacity-40');
    expect(tokens(iconButtonClasses())).toContain('disabled:opacity-40');
  });
});
