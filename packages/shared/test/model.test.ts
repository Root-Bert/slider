import { describe, expect, it } from 'vitest';
import {
  clampDrawingShift,
  isDrawing,
  isPathStroke,
  isTextStroke,
  moveDrawing,
  textStrokeSchema,
  type Anchor,
  type PathStroke,
  type Stroke,
  type TextStroke,
} from '../src/model';

const pen = (...points: [number, number][]): PathStroke => ({
  tool: 'pen',
  color: 'blue',
  points: points.map(([x, y]) => ({ x, y })),
});

const text: TextStroke = {
  tool: 'text',
  color: 'red',
  x: 0.1,
  y: 0.1,
  w: 0.3,
  h: 0.1,
  text: 'Hallo',
  fontSize: 0.04,
};

const slideAnchor: Anchor = { type: 'slide' };
const gapAnchor: Anchor = { type: 'gap', afterSlideId: 'a', beforeSlideId: null };
const pointAnchor = (x: number, y: number): Anchor => ({
  type: 'point',
  point: { x, y },
  shapeRef: null,
});

describe('stroke type guards', () => {
  it('tells text strokes and path strokes apart', () => {
    expect(isTextStroke(text)).toBe(true);
    expect(isPathStroke(text)).toBe(false);
    for (const tool of ['pen', 'arrow', 'highlighter', 'rect', 'ellipse'] as const) {
      const stroke: Stroke = { ...pen([0, 0], [1, 1]), tool };
      expect(isPathStroke(stroke)).toBe(true);
      expect(isTextStroke(stroke)).toBe(false);
    }
  });
});

describe('isDrawing', () => {
  it('is false without strokes', () => {
    expect(isDrawing({ strokes: [] })).toBe(false);
  });

  it('is true when every stroke is drawn', () => {
    expect(
      isDrawing({ strokes: [pen([0, 0], [1, 1]), { ...pen([0, 0], [1, 1]), tool: 'arrow' }] }),
    ).toBe(true);
  });

  it('is false as soon as text is written on the slide', () => {
    expect(isDrawing({ strokes: [text] })).toBe(false);
    expect(isDrawing({ strokes: [pen([0, 0], [1, 1]), text] })).toBe(false);
  });
});

describe('clampDrawingShift', () => {
  it('does not move anything without points (slide or gap anchor, text only)', () => {
    expect(clampDrawingShift({ anchor: slideAnchor, strokes: [] }, 0.3, 0.2)).toEqual({
      dx: 0,
      dy: 0,
    });
    expect(clampDrawingShift({ anchor: gapAnchor, strokes: [] }, 0.3, 0.2)).toEqual({
      dx: 0,
      dy: 0,
    });
    expect(clampDrawingShift({ anchor: slideAnchor, strokes: [text] }, 0.3, 0.2)).toEqual({
      dx: 0,
      dy: 0,
    });
  });

  it('passes a shift through that keeps everything on the slide', () => {
    const shift = clampDrawingShift(
      { anchor: slideAnchor, strokes: [pen([0.3, 0.3], [0.5, 0.6])] },
      0.1,
      -0.2,
    );
    expect(shift.dx).toBeCloseTo(0.1);
    expect(shift.dy).toBeCloseTo(-0.2);
  });

  it('stops a point anchor at the right edge', () => {
    const shift = clampDrawingShift({ anchor: pointAnchor(0.9, 0.5), strokes: [] }, 0.3, 0);
    expect(shift.dx).toBeCloseTo(0.1);
    expect(shift.dy).toBeCloseTo(0);
  });

  it('stops a negative shift at the left and top edges', () => {
    const shift = clampDrawingShift(
      { anchor: pointAnchor(0.5, 0.5), strokes: [pen([0.1, 0.2], [0.4, 0.6])] },
      -0.3,
      -0.5,
    );
    expect(shift.dx).toBeCloseTo(-0.1);
    expect(shift.dy).toBeCloseTo(-0.2);
  });

  it('bounds a rect anchor by both of its edges', () => {
    const anchor: Anchor = {
      type: 'rect',
      rect: { x: 0.2, y: 0.3, w: 0.5, h: 0.4 },
      shapeRef: null,
    };
    const right = clampDrawingShift({ anchor, strokes: [] }, 0.5, 1);
    expect(right.dx).toBeCloseTo(0.3);
    expect(right.dy).toBeCloseTo(0.3);
    const left = clampDrawingShift({ anchor, strokes: [] }, -0.5, -1);
    expect(left.dx).toBeCloseTo(-0.2);
    expect(left.dy).toBeCloseTo(-0.3);
  });

  it('takes the stroke points and the anchor together', () => {
    const shift = clampDrawingShift(
      { anchor: pointAnchor(0.5, 0.5), strokes: [pen([0.1, 0.1], [0.4, 0.6])] },
      -0.3,
      0.6,
    );
    expect(shift.dx).toBeCloseTo(-0.1);
    expect(shift.dy).toBeCloseTo(0.4);
  });

  it('ignores text boxes when bounding the shift', () => {
    const farText: TextStroke = { ...text, x: 0.9, w: 0.1 };
    const shift = clampDrawingShift(
      { anchor: slideAnchor, strokes: [pen([0.1, 0.1], [0.2, 0.2]), farText] },
      0.5,
      0,
    );
    expect(shift.dx).toBeCloseTo(0.5);
  });
});

describe('moveDrawing', () => {
  it('shifts path points and the point anchor, keeping other fields', () => {
    const comment = {
      id: 'c1',
      anchor: pointAnchor(0.5, 0.5),
      strokes: [pen([0.2, 0.2], [0.4, 0.3])] as Stroke[],
    };
    const moved = moveDrawing(comment, 0.1, 0.2);
    expect(moved.id).toBe('c1');
    const [stroke] = moved.strokes;
    expect(stroke && isPathStroke(stroke)).toBe(true);
    if (!stroke || !isPathStroke(stroke)) return;
    expect(stroke.points[0]?.x).toBeCloseTo(0.3);
    expect(stroke.points[0]?.y).toBeCloseTo(0.4);
    expect(stroke.points[1]?.x).toBeCloseTo(0.5);
    expect(stroke.points[1]?.y).toBeCloseTo(0.5);
    expect(moved.anchor.type).toBe('point');
    if (moved.anchor.type !== 'point') return;
    expect(moved.anchor.point.x).toBeCloseTo(0.6);
    expect(moved.anchor.point.y).toBeCloseTo(0.7);
  });

  it('does not change the original comment', () => {
    const comment = {
      anchor: pointAnchor(0.5, 0.5),
      strokes: [pen([0.2, 0.2], [0.4, 0.3])] as Stroke[],
    };
    moveDrawing(comment, 0.1, 0.1);
    expect(comment.anchor).toEqual(pointAnchor(0.5, 0.5));
    expect(comment.strokes).toEqual([pen([0.2, 0.2], [0.4, 0.3])]);
  });

  it('keeps everything on the slide when the shift goes too far', () => {
    const moved = moveDrawing(
      { anchor: slideAnchor, strokes: [pen([0.7, 0.1], [0.9, 0.2])] },
      0.5,
      -0.5,
    );
    const [stroke] = moved.strokes;
    if (!stroke || !isPathStroke(stroke)) throw new Error('expected a path stroke');
    for (const point of stroke.points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
    }
    expect(stroke.points[1]?.x).toBeCloseTo(1);
    expect(stroke.points[0]?.y).toBeCloseTo(0);
  });

  it('moves a rect anchor without resizing it', () => {
    const anchor: Anchor = {
      type: 'rect',
      rect: { x: 0.2, y: 0.3, w: 0.5, h: 0.4 },
      shapeRef: null,
    };
    const moved = moveDrawing({ anchor, strokes: [] }, 0.1, -0.1);
    expect(moved.anchor.type).toBe('rect');
    if (moved.anchor.type !== 'rect') return;
    expect(moved.anchor.rect.x).toBeCloseTo(0.3);
    expect(moved.anchor.rect.y).toBeCloseTo(0.2);
    expect(moved.anchor.rect.w).toBe(0.5);
    expect(moved.anchor.rect.h).toBe(0.4);
    expect(moved.anchor.shapeRef).toBeNull();
  });

  it('leaves text strokes and slide/gap anchors as they are', () => {
    const moved = moveDrawing(
      { anchor: gapAnchor, strokes: [pen([0.2, 0.2], [0.3, 0.3]), text] },
      0.1,
      0.1,
    );
    expect(moved.anchor).toBe(gapAnchor);
    expect(moved.strokes[1]).toBe(text);
  });
});

describe('textStrokeSchema', () => {
  it('accepts a box that ends on the slide edge within rounding', () => {
    expect(textStrokeSchema.safeParse({ ...text, x: 0.7, w: 0.3 + 1e-7 }).success).toBe(true);
  });

  it('rejects a box that runs off the slide', () => {
    const result = textStrokeSchema.safeParse({ ...text, x: 0.8, w: 0.3 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Das Textfeld muss auf der Folie liegen.');
  });

  it('trims the text and rejects blank text', () => {
    expect(textStrokeSchema.parse({ ...text, text: '  Hallo  ' }).text).toBe('Hallo');
    expect(textStrokeSchema.safeParse({ ...text, text: '   ' }).success).toBe(false);
  });
});
