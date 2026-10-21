import type { Guide, Shape, Slide } from '@slider/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GuideLayer } from './GuideLayer';

const MARGINS: Guide[] = [
  { orientation: 'vertical', position: 0.1 },
  { orientation: 'vertical', position: 0.9 },
];

const shape = (id: string, x: number, w: number): Shape =>
  ({ id, name: `Box ${id}`, text: '', bbox: { x, y: 0.3, w, h: 0.2 } }) as Shape;

const slide = (guides: Guide[] | undefined, shapes: Shape[] = []) =>
  ({ id: 's1', guides, shapes }) as unknown as Slide;

const renderLayer = (value: Slide) => render(<GuideLayer slide={value} />).container;

describe('GuideLayer', () => {
  it('says when the presentation has no guides', () => {
    renderLayer(slide(undefined));
    const chip = screen.getByText('Keine Hilfslinien');
    expect(chip.className).toContain('glass-dark');
  });

  it('draws every guide and says when everything is inside them', () => {
    const container = renderLayer(slide(MARGINS, [shape('a', 0.2, 0.3)]));
    expect(container.querySelector('[data-guide-layer]')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('.w-px')).toHaveLength(2);
    expect(screen.getByText('Alles innerhalb der Hilfslinien')).toBeTruthy();
    expect(container.querySelector('[data-shape-outline]')).toBeNull();
  });

  it('outlines a box that sticks out and counts it', () => {
    const container = renderLayer(slide(MARGINS, [shape('a', 0.05, 0.3), shape('b', 0.3, 0.2)]));
    const chip = screen.getByText('1 Box ragt über die Hilfslinien');
    expect(chip.className).toContain('text-white');
    expect(chip.style.backgroundColor).not.toBe('');
    expect(container.querySelectorAll('[data-shape-outline="emphasis"]')).toHaveLength(1);
  });

  it('counts several boxes in the plural', () => {
    renderLayer(slide(MARGINS, [shape('a', 0.05, 0.3), shape('b', 0.6, 0.35)]));
    expect(screen.getByText('2 Boxen ragen über die Hilfslinien')).toBeTruthy();
  });
});
