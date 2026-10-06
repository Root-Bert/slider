import { describe, expect, it } from 'vitest';
import { applyTransform, groupTransform, IDENTITY } from '../src/transform';
import { parseXml } from '../src/xml';
import {
  MASTER_BODY_BOX,
  MASTER_BODY_SIZE_PT,
  MASTER_TITLE_BOX,
  MASTER_TITLE_SIZE_PT,
  TITLE_LAYOUT_SUBTITLE_SIZE_PT,
  TITLE_LAYOUT_TITLE_BOX,
  TITLE_LAYOUT_TITLE_SIZE_PT,
} from './fixtures/ooxml';
import { SLIDE_SIZE_16_9 } from './fixtures/build-pptx';
import { defined, openDeck } from './helpers';

const { cx, cy } = SLIDE_SIZE_16_9;

/** Normalises an EMU box the way the parser does. */
const normalised = (box: { x: number; y: number; w: number; h: number }) => ({
  x: box.x / cx,
  y: box.y / cy,
  w: box.w / cx,
  h: box.h / cy,
});

const xfrm = (source: string) => parseXml(`<a:xfrm xmlns:a="a">${source}</a:xfrm>`);

describe('group transforms', () => {
  it('maps child coordinates onto the group box (translate + scale)', () => {
    const transform = groupTransform(
      xfrm(
        '<a:off x="1000" y="2000"/><a:ext cx="500" cy="400"/><a:chOff x="100" y="100"/><a:chExt cx="1000" cy="200"/>',
      ),
      IDENTITY,
    );

    expect(applyTransform(transform, { x: 100, y: 100, w: 1000, h: 200 })).toEqual({
      x: 1000,
      y: 2000,
      w: 500,
      h: 400,
    });
    expect(applyTransform(transform, { x: 600, y: 200, w: 200, h: 50 })).toEqual({
      x: 1250,
      y: 2200,
      w: 100,
      h: 100,
    });
  });

  it('composes nested groups', () => {
    const outer = groupTransform(
      xfrm(
        '<a:off x="0" y="0"/><a:ext cx="100" cy="100"/><a:chOff x="0" y="0"/><a:chExt cx="200" cy="200"/>',
      ),
      IDENTITY,
    );
    const inner = groupTransform(
      xfrm(
        '<a:off x="100" y="100"/><a:ext cx="100" cy="100"/><a:chOff x="0" y="0"/><a:chExt cx="50" cy="50"/>',
      ),
      outer,
    );

    // inner child (10,10) → inner parent (120,120) → slide (60,60); sizes scale by 2 × 0.5 = 1
    expect(applyTransform(inner, { x: 10, y: 10, w: 20, h: 20 })).toEqual({
      x: 60,
      y: 60,
      w: 20,
      h: 20,
    });
  });

  it('flattens grouped shapes into slide coordinates, in document order', async () => {
    const { presentation } = await openDeck({
      slides: [
        {
          shapes: [
            { type: 'rect', name: 'Before', box: { x: 0, y: 0, w: 100, h: 100 } },
            {
              type: 'group',
              name: 'Outer',
              box: { x: 1_000_000, y: 1_000_000, w: 2_000_000, h: 1_000_000 },
              childBox: { x: 0, y: 0, w: 4_000_000, h: 2_000_000 },
              shapes: [
                {
                  type: 'rect',
                  name: 'Half',
                  box: { x: 2_000_000, y: 0, w: 2_000_000, h: 1_000_000 },
                },
                {
                  type: 'group',
                  name: 'Inner',
                  box: { x: 0, y: 1_000_000, w: 2_000_000, h: 1_000_000 },
                  childBox: { x: 0, y: 0, w: 1_000_000, h: 500_000 },
                  shapes: [
                    {
                      type: 'rect',
                      name: 'Nested',
                      box: { x: 500_000, y: 0, w: 500_000, h: 500_000 },
                    },
                  ],
                },
              ],
            },
            { type: 'rect', name: 'After', box: { x: 0, y: 0, w: 100, h: 100 } },
          ],
        },
      ],
    });
    const shapes = defined(presentation.slides[0]).shapes;

    expect(shapes.map((shape) => shape.name)).toEqual(['Before', 'Half', 'Nested', 'After']);
    expect(shapes[1]?.bbox).toEqual(
      normalised({ x: 2_000_000, y: 1_000_000, w: 1_000_000, h: 500_000 }),
    );
    // Inner group: child (500k,0) → outer space (1M,1M) → slide (1.5M,1.5M); size 500k → 1M → 500k
    expect(shapes[2]?.bbox).toEqual(
      normalised({ x: 1_500_000, y: 1_500_000, w: 500_000, h: 500_000 }),
    );
  });
});

describe('placeholder inheritance', () => {
  it('takes position and font size from the layout placeholder', async () => {
    const { presentation } = await openDeck({
      slides: [{ layout: 'title', title: 'Titel', body: 'Untertitel' }],
    });
    const [title, subtitle] = defined(presentation.slides[0]).shapes;

    expect(title?.placeholder).toBe('ctrTitle');
    expect(title?.bbox).toEqual(normalised(TITLE_LAYOUT_TITLE_BOX));
    expect(title?.paragraphs[0]?.runs[0]?.sizePt).toBe(TITLE_LAYOUT_TITLE_SIZE_PT);
    expect(title?.paragraphs[0]?.align).toBe('center');
    expect(subtitle?.placeholder).toBe('subTitle');
    expect(subtitle?.paragraphs[0]?.runs[0]?.sizePt).toBe(TITLE_LAYOUT_SUBTITLE_SIZE_PT);
  });

  it('falls back to the master when the layout placeholder has no position', async () => {
    const { presentation } = await openDeck({
      slides: [{ title: 'Agenda', body: ['Eins', 'Zwei'] }],
    });
    const [title, body] = defined(presentation.slides[0]).shapes;

    expect(title?.bbox).toEqual(normalised(MASTER_TITLE_BOX));
    expect(title?.paragraphs[0]?.runs[0]?.sizePt).toBe(MASTER_TITLE_SIZE_PT);
    // `<p:ph idx="1"/>` has no type: it is a body placeholder matched by idx.
    expect(body?.placeholder).toBe('body');
    expect(body?.bbox).toEqual(normalised(MASTER_BODY_BOX));
    expect(body?.text).toBe('Eins\nZwei');
    expect(body?.paragraphs.map((paragraph) => paragraph.runs[0]?.sizePt)).toEqual([
      MASTER_BODY_SIZE_PT,
      MASTER_BODY_SIZE_PT,
    ]);
  });
});

describe('shape content', () => {
  it('reads ids, fills and rich text runs', async () => {
    const { presentation } = await openDeck({
      slides: [
        {
          title: 'Formatierung',
          shapes: [
            {
              type: 'rect',
              id: 42,
              name: 'Callout',
              box: { x: 0, y: 0, w: cx / 2, h: cy / 2 },
              fill: '2563EB',
              text: 'Wichtig',
              font: { sizePt: 20, bold: true, italic: true, color: 'FFFFFF' },
              align: 'r',
            },
          ],
        },
      ],
    });
    const callout = defined(presentation.slides[0]?.shapes.find((shape) => shape.id === '42'));

    expect(callout).toMatchObject({
      name: 'Callout',
      kind: 'text',
      fill: '#2563eb',
      text: 'Wichtig',
      placeholder: null,
      bbox: { x: 0, y: 0, w: 0.5, h: 0.5 },
    });
    expect(callout.paragraphs).toEqual([
      {
        align: 'right',
        runs: [{ text: 'Wichtig', sizePt: 20, bold: true, italic: true, color: '#ffffff' }],
      },
    ]);
  });

  it('classifies shapes without text as "other"', async () => {
    const { presentation } = await openDeck({
      slides: [{ shapes: [{ type: 'rect', box: { x: 0, y: 0, w: 10, h: 10 }, fill: '000000' }] }],
    });

    expect(presentation.slides[0]?.shapes[0]?.kind).toBe('other');
  });

  it('resolves picture images through the slide relationships', async () => {
    const { presentation } = await openDeck({
      slides: [
        {
          shapes: [
            { type: 'picture', name: 'Logo', box: { x: 0, y: 0, w: 1_000_000, h: 1_000_000 } },
          ],
        },
        {
          shapes: [
            { type: 'picture', name: 'Foto', box: { x: 0, y: 0, w: 1_000_000, h: 1_000_000 } },
          ],
        },
      ],
    });

    expect(presentation.slides.map((slide) => slide.shapes[0])).toMatchObject([
      { kind: 'picture', name: 'Logo', imagePath: 'ppt/media/image1.png' },
      { kind: 'picture', name: 'Foto', imagePath: 'ppt/media/image2.png' },
    ]);
  });
});
