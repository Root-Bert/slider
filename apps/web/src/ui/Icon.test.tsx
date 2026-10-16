import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon } from './Icon';
import { ICON_SIZE, iconPx } from './icon-size';

describe('Icon', () => {
  it('takes a scale step or px', () => {
    expect(iconPx('lg')).toBe(18);
    expect(iconPx(13)).toBe(13);
    expect(Object.values(ICON_SIZE)).toEqual([12, 14, 16, 18, 20, 24]);
    const { container } = render(<Icon name="check" size="xl" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('is an image when labelled', () => {
    render(<Icon name="check" label="Erledigt" />);
    expect(screen.getByRole('img', { name: 'Erledigt' }).getAttribute('width')).toBe('24');
  });
});
