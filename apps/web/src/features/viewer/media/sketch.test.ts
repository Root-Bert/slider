import { describe, expect, it } from 'vitest';
import { addPoint, eraserHits, hasInk, sketchPalette, type SketchStroke } from './sketch';

/** Measures every character 10px wide – enough for wrapping and hit tests. */
const context = {
  font: '',
  save() {},
  restore() {},
  measureText: (text: string) => ({ width: text.length * 10 }),
} as unknown as CanvasRenderingContext2D;

describe('sketch', () => {
  it('puts the own colour after the ink, without duplicates', () => {
    expect(sketchPalette('#0048ff').slice(0, 2)).toEqual(['#141414', '#0048ff']);
    expect(sketchPalette('#0048ff').filter((c) => c.toLowerCase() === '#0048ff')).toHaveLength(1);
  });

  it('drops points that barely moved', () => {
    expect(addPoint([[0.5, 0.5]], [0.5005, 0.5])).toHaveLength(1);
    expect(addPoint([[0.5, 0.5]], [0.6, 0.5])).toHaveLength(2);
  });

  it('counts any stroke as a drawing', () => {
    expect(hasInk([])).toBe(false);
    expect(hasInk([{ tool: 'pen', color: '#fff', width: 0.004, points: [[0, 0]] }])).toBe(true);
  });

  describe('eraser', () => {
    const at = (stroke: SketchStroke, x: number, y: number) =>
      eraserHits(context, stroke, [x, y], 1000, 500);

    it('touches freehand near its line only', () => {
      const pen: SketchStroke = {
        tool: 'pen',
        color: '#000',
        width: 0.004,
        points: [
          [0.1, 0.1],
          [0.5, 0.1],
        ],
      };
      expect(at(pen, 300, 52)).toBe(true);
      expect(at(pen, 300, 100)).toBe(false);
    });

    it('touches a box on its edges, not inside', () => {
      const box: SketchStroke = {
        tool: 'rect',
        color: '#000',
        width: 0.004,
        points: [
          [0.1, 0.1],
          [0.5, 0.9],
        ],
      };
      expect(at(box, 100, 250)).toBe(true);
      expect(at(box, 300, 250)).toBe(false);
    });

    it('touches an arrow along the straight line from start to end', () => {
      const arrow: SketchStroke = {
        tool: 'arrow',
        color: '#000',
        width: 0.004,
        points: [
          [0.1, 0.1],
          [0.3, 0.1],
          [0.5, 0.5],
        ],
      };
      expect(at(arrow, 300, 150)).toBe(true);
      expect(at(arrow, 300, 50)).toBe(false);
    });

    it('touches text within its wrapped box', () => {
      const text: SketchStroke = {
        tool: 'text',
        color: '#000',
        x: 0.1,
        y: 0.1,
        w: 0.08,
        text: 'hallo welt',
        fontSize: 0.04,
      };
      // Wrapped at 80px into two lines of 25px (20px font × 1.25).
      expect(at(text, 120, 90)).toBe(true);
      expect(at(text, 120, 120)).toBe(false);
    });
  });
});
