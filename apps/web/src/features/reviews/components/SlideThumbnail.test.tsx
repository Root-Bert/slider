import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SlideThumbnail } from './SlideThumbnail';

describe('SlideThumbnail', () => {
  it('loads the glow copy lazily too, so offscreen cards fetch nothing', () => {
    const { container } = render(<SlideThumbnail src="/files/thumb.png" glow />);
    const images = [...container.querySelectorAll('img')];
    expect(images).toHaveLength(2);
    for (const image of images) expect(image.getAttribute('loading')).toBe('lazy');
  });
});
