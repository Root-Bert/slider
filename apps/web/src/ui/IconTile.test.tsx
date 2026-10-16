import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IconTile } from './IconTile';

const tile = () => screen.getByTestId('child').parentElement!;

describe('IconTile', () => {
  it.each([
    [32, 'size-8', 'rounded-chip'],
    [36, 'size-9', 'rounded-control'],
    [40, 'size-10', 'rounded-control'],
    [56, 'size-14', 'rounded-panel'],
  ] as const)('size %i is %s with %s', (size, sizeClass, radius) => {
    render(
      <IconTile size={size}>
        <span data-testid="child" />
      </IconTile>,
    );
    expect(tile().className.split(' ')).toEqual(expect.arrayContaining([sizeClass, radius]));
  });

  it('defaults to a 36px muted tile on surface-1', () => {
    render(
      <IconTile>
        <span data-testid="child" />
      </IconTile>,
    );
    expect(tile().className.split(' ')).toEqual(
      expect.arrayContaining(['size-9', 'bg-surface-1', 'text-fg-muted']),
    );
  });

  it('tint hover and tone fg', () => {
    render(
      <IconTile tint="hover" tone="fg">
        <span data-testid="child" />
      </IconTile>,
    );
    expect(tile().className.split(' ')).toEqual(expect.arrayContaining(['bg-hover', 'text-fg']));
  });

  it('danger tone replaces the tint', () => {
    render(
      <IconTile tone="danger" tint="hover">
        <span data-testid="child" />
      </IconTile>,
    );
    expect(tile().className).toContain('bg-danger/15');
    expect(tile().className).not.toContain('bg-hover');
  });

  it('inherit keeps the colour; dimmed fades', () => {
    render(
      <IconTile tone="inherit" dimmed>
        <span data-testid="child" />
      </IconTile>,
    );
    expect(tile().className).not.toMatch(/\btext-/);
    expect(tile().className).toContain('opacity-60');
  });
});
