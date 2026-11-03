import { createCanvas, loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { bakeTilt } from '../src/services/tilt-pictures';

describe('bakeTilt', () => {
  it('draws an element tilted in perspective about its centre, flat as it is, see-through around it', async () => {
    const flat = createCanvas(200, 100);
    const context = flat.getContext('2d');
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 200, 100);
    const bytes = new Uint8Array(await flat.encode('png'));
    const box = { x: 0.4, y: 0.4, w: 0.2, h: 0.1 * (16 / 9) };
    const centre = { x: 0.5, y: 0.4 + box.h / 2 };
    const pixel = async (png: Uint8Array, x: number, y: number) => {
      const image = await loadImage(Buffer.from(png));
      const canvas = createCanvas(image.width, image.height);
      const drawn = canvas.getContext('2d');
      drawn.drawImage(image, 0, 0);
      return [
        ...drawn.getImageData(Math.round(x * image.width), Math.round(y * image.height), 1, 1).data,
      ];
    };

    // Not tilted: where it was, as it was.
    const same = await bakeTilt({ bytes, box, centre, tilt: { x: 0, y: 0 }, aspect: 16 / 9 });
    expect(same.box.x).toBeCloseTo(box.x, 2);
    expect(same.box.w).toBeCloseTo(box.w, 2);
    expect(same.box.h).toBeCloseTo(box.h, 2);
    expect(await pixel(same.bytes, 0.5, 0.5)).toEqual([255, 0, 0, 255]);

    // Its right side away: narrower, the near (left) side taller than the far one.
    const turned = await bakeTilt({ bytes, box, centre, tilt: { x: 0, y: 40 }, aspect: 16 / 9 });
    expect(turned.box.w).toBeLessThan(box.w);
    expect(turned.box.h).toBeGreaterThan(box.h);
    expect(turned.box.x + turned.box.w / 2).toBeLessThan(0.5 + 0.01);
    expect(await pixel(turned.bytes, 0.5, 0.5)).toEqual([255, 0, 0, 255]);
    // The far side's corners are outside the picture: see-through.
    expect((await pixel(turned.bytes, 0.99, 0.01))[3]).toBe(0);
    expect((await pixel(turned.bytes, 0.01, 0.5))[3]).toBeGreaterThan(200);
  });
});
