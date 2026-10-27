import { createCanvas, loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { drawLayers, LAYER_IMAGE_WIDTH } from '../src/import/pdf-pages';
import { makeSlidesPdf, type PdfPage } from './pdf';

/* A slide taken apart for the layers view: each element alone from its pages on white and black. */

const full = (rgb: [number, number, number]) => ({ x: 0, y: 0, w: 960, h: 540, rgb });
const on = (color: [number, number, number], ...boxes: NonNullable<PdfPage['boxes']>): PdfPage => ({
  texts: [],
  boxes: [full(color), ...boxes],
});

describe('drawLayers', () => {
  it('draws the slide without its elements, and each element alone, cut to what it covers', async () => {
    const red = { x: 96, y: 108, w: 192, h: 108, rgb: [255, 0, 0] as [number, number, number] };
    const pdf = makeSlidesPdf([
      on([200, 200, 200]),
      on([255, 255, 255], red),
      on([0, 0, 0], red),
      // An element that draws nothing.
      on([255, 255, 255]),
      on([0, 0, 0]),
    ]);
    const drawn = await drawLayers(pdf);
    expect(drawn.layers).toHaveLength(2);
    const background = await loadImage(Buffer.from(drawn.background!));
    expect(background.width).toBe(LAYER_IMAGE_WIDTH);

    const [element, nothing] = drawn.layers;
    expect(nothing).toEqual({ image: null, box: null });
    // A couple of pixels of margin around it.
    expect(element!.box!.x).toBeCloseTo(0.1, 2);
    expect(element!.box!.y).toBeCloseTo(0.2, 2);
    expect(element!.box!.w).toBeCloseTo(0.2, 2);
    expect(element!.box!.h).toBeCloseTo(0.2, 2);
    const image = await loadImage(Buffer.from(element!.image!));
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const middle = context.getImageData(image.width / 2, image.height / 2, 1, 1).data;
    expect([...middle]).toEqual([255, 0, 0, 255]);
    // The margin shows through.
    expect(context.getImageData(0, 0, 1, 1).data[3]).toBe(0);
  });

  it('draws only the elements when the slide without them is not asked for', async () => {
    const red = { x: 96, y: 108, w: 192, h: 108, rgb: [255, 0, 0] as [number, number, number] };
    const pdf = makeSlidesPdf([on([255, 255, 255], red), on([0, 0, 0], red)]);
    const drawn = await drawLayers(pdf, { background: false });
    expect(drawn.background).toBeNull();
    expect(drawn.layers).toHaveLength(1);
    expect(drawn.layers[0]!.box!.x).toBeCloseTo(0.1, 2);
  });
});
