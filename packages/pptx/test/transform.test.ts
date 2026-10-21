import { describe, expect, it } from 'vitest';
import { walkShapeTree } from '../src/shape-tree';
import { parseXml } from '../src/xml';

/** `rot` is in 60 000ths of a degree. */
const ROT_90 = 90 * 60_000;

const xfrm = (box: string, attrs = '') => `<a:xfrm${attrs}>${box}</a:xfrm>`;
const off = (x: number, y: number, cx: number, cy: number) =>
  `<a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/>`;
const ch = (x: number, y: number, cx: number, cy: number) =>
  `<a:chOff x="${x}" y="${y}"/><a:chExt cx="${cx}" cy="${cy}"/>`;

const shape = (name: string, box: string, attrs = '') =>
  `<p:sp><p:nvSpPr><p:cNvPr id="1" name="${name}"/></p:nvSpPr>` +
  `<p:spPr>${xfrm(box, attrs)}</p:spPr></p:sp>`;
const group = (groupXfrm: string, children: string) =>
  `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="Group"/></p:nvGrpSpPr>` +
  `<p:grpSpPr>${groupXfrm}</p:grpSpPr>${children}</p:grpSp>`;

const boxes = (content: string) =>
  Object.fromEntries(
    [...walkShapeTree(parseXml(`<p:spTree>${content}</p:spTree>`))].map((node) => [
      node.name,
      node.box,
    ]),
  );

describe('xfrm rotation and flips', () => {
  it('turns a 90° rotated shape into a tall bounding box about its centre', () => {
    // 400×100 centred on (300, 250) → 100×400 around the same centre
    expect(boxes(shape('Rotated', off(100, 200, 400, 100), ` rot="${ROT_90}"`))).toEqual({
      Rotated: { x: 250, y: 50, w: 100, h: 400 },
    });
  });

  it('grows the bounding box of a 45° rotated square', () => {
    const { Square } = boxes(shape('Square', off(0, 0, 100, 100), ` rot="${45 * 60_000}"`));
    const diagonal = 100 * Math.SQRT2;
    expect(Square?.x).toBeCloseTo(50 - diagonal / 2);
    expect(Square?.y).toBeCloseTo(50 - diagonal / 2);
    expect(Square?.w).toBeCloseTo(diagonal);
    expect(Square?.h).toBeCloseTo(diagonal);
  });

  it('ignores flips on a leaf shape (same bounding box)', () => {
    expect(boxes(shape('Flipped', off(10, 20, 30, 40), ' flipH="1" flipV="1"'))).toEqual({
      Flipped: { x: 10, y: 20, w: 30, h: 40 },
    });
  });

  it('mirrors children inside a flipped group', () => {
    const groupBox = off(0, 0, 1000, 1000) + ch(0, 0, 1000, 1000);
    expect(
      boxes(
        group(xfrm(groupBox, ' flipH="1"'), shape('Left', off(0, 0, 100, 100))) +
          group(xfrm(groupBox, ' flipV="1"'), shape('Top', off(0, 0, 100, 100))),
      ),
    ).toEqual({
      Left: { x: 900, y: 0, w: 100, h: 100 },
      Top: { x: 0, y: 900, w: 100, h: 100 },
    });
  });

  it('rotates children about the centre of a rotated group', () => {
    // group centre (1000, 500); clockwise 90° maps offset (dx, dy) → (−dy, dx)
    const groupXfrm = xfrm(off(0, 0, 2000, 1000) + ch(0, 0, 2000, 1000), ` rot="${ROT_90}"`);
    expect(boxes(group(groupXfrm, shape('Corner', off(0, 0, 200, 100))))).toEqual({
      Corner: { x: 1400, y: -500, w: 100, h: 200 },
    });
  });

  it('composes scale, rotation and flips through nested groups', () => {
    // inner: child space scaled by ½, rotated 90° about (250, 250) → (450, 0, 50, 100);
    // outer: mirrored about x = 500 → (500, 0, 50, 100)
    const inner = group(
      xfrm(off(0, 0, 500, 500) + ch(0, 0, 1000, 1000), ` rot="${ROT_90}"`),
      shape('Nested', off(0, 0, 200, 100)),
    );
    const outer = group(xfrm(off(0, 0, 1000, 1000) + ch(0, 0, 1000, 1000), ' flipH="1"'), inner);
    expect(boxes(outer)).toEqual({ Nested: { x: 500, y: 0, w: 50, h: 100 } });
  });

  it('cancels a rotated shape inside a counter-rotated group', () => {
    const groupXfrm = xfrm(off(0, 0, 1000, 1000) + ch(0, 0, 1000, 1000), ` rot="${ROT_90}"`);
    // centred on the group centre (500, 500): the shape's −90° is undone by the group's +90°
    const tilted = shape('Upright', off(400, 300, 200, 400), ` rot="${270 * 60_000}"`);
    expect(boxes(group(groupXfrm, tilted))).toEqual({
      Upright: { x: 400, y: 300, w: 200, h: 400 },
    });
  });
});
