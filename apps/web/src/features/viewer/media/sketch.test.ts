import type { Stroke } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { eraserHits, frameOf, hasInk, placeStroke, sketchPalette, wrapText } from './sketch';

const pen: Stroke = {
  tool: 'pen',
  color: 'blue',
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.5, y: 0.1 },
  ],
};
const box: Stroke = {
  tool: 'rect',
  color: 'red',
  points: [
    { x: 0.5, y: 0.9 },
    { x: 0.1, y: 0.1 },
  ],
};

describe('sketch', () => {
  it('starts the colours with one’s own, without duplicates', () => {
    const palette = sketchPalette('green');
    expect(palette[0]).toBe('green');
    expect(palette.filter((color) => color === 'green')).toHaveLength(1);
  });

  it('counts any stroke as a drawing', () => {
    expect(hasInk([])).toBe(false);
    expect(hasInk([pen])).toBe(true);
  });

  describe('eraser', () => {
    const at = (stroke: Stroke, x: number, y: number) => eraserHits(stroke, { x, y }, 1000, 500);

    it('touches a drawing near its line only', () => {
      expect(at(pen, 300, 54)).toBe(true);
      expect(at(pen, 300, 100)).toBe(false);
    });

    it('touches a box on its border, not inside', () => {
      expect(at(box, 100, 250)).toBe(true);
      expect(at(box, 300, 250)).toBe(false);
    });

    it('leaves text alone (it is deleted, as on the slide)', () => {
      const text: Stroke = {
        tool: 'text',
        color: 'blue',
        x: 0.1,
        y: 0.1,
        w: 0.2,
        h: 0.1,
        text: 'Logo',
        fontSize: 0.04,
      };
      expect(at(text, 150, 70)).toBe(false);
    });
  });

  it('frames a box by its corners, a drawing with some room', () => {
    expect(frameOf(box)).toEqual({ x: 0.1, y: 0.1, w: 0.4, h: 0.8 });
    expect(frameOf(pen)).toMatchObject({ x: 0.085, y: 0.085 });
  });

  it('moves and scales a drawing from one frame to another', () => {
    const moved = placeStroke(
      pen,
      { x: 0.1, y: 0.1, w: 0.4, h: 0.2 },
      { x: 0.2, y: 0.3, w: 0.8, h: 0.2 },
    );
    expect(moved).toMatchObject({
      points: [
        { x: 0.2, y: 0.3 },
        { x: 1, y: 0.3 },
      ],
    });
  });

  it('wraps text at word gaps and breaks words that do not fit', () => {
    // Every character 10px wide.
    const context = { measureText: (text: string) => ({ width: text.length * 10 }) };
    expect(wrapText(context as CanvasRenderingContext2D, 'hallo welt', 60)).toEqual([
      'hallo',
      'welt',
    ]);
    expect(wrapText(context as CanvasRenderingContext2D, 'abcdefgh', 50)).toEqual(['abcde', 'fgh']);
  });
});
