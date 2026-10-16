import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProgressBar } from './ProgressBar';

const classes = (element: Element) => element.getAttribute('class')!.split(/\s+/);

describe('ProgressBar', () => {
  it('reports its value on a token track', () => {
    render(<ProgressBar value={0.426} label="Import" />);
    const bar = screen.getByRole('progressbar', { name: 'Import' });
    expect(bar.getAttribute('aria-valuenow')).toBe('43');
    expect(classes(bar)).toContain('bg-hover');
  });

  it('is indeterminate without a value', () => {
    render(<ProgressBar value={null} label="Import" />);
    expect(screen.getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false);
  });
});
