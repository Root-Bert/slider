import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { storeSlideRender } from '../src/import/office-pages';
import { svgThumbnail } from '../src/import/svg-thumbnail';
import { FsBlobStorage } from '../src/storage/fs-blob-storage';

/** A noisy photo-like PNG (noise doesn't compress), as a data URI. */
async function photo(width: number, height: number): Promise<string> {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const pixels = context.createImageData(width, height);
  for (let i = 0; i < pixels.data.length; i++) {
    pixels.data[i] = i % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
  }
  context.putImageData(pixels, 0, 0);
  return `data:image/png;base64,${Buffer.from(await canvas.encode('png')).toString('base64')}`;
}

const slide = (href: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">` +
  `<rect width="1920" height="1080" fill="#ffffff"/>` +
  `<foreignObject x="0" y="0" width="1920" height="200"><div xmlns="http://www.w3.org/1999/xhtml">Titel</div></foreignObject>` +
  `<image x="132" y="266" width="1080" height="607.5" preserveAspectRatio="none" href="${href}"/></svg>`;

describe('svgThumbnail', () => {
  it('scales embedded photos down to what the thumbnail shows; text stays vector', async () => {
    const svg = slide(await photo(1600, 900));
    const thumbnail = await svgThumbnail(svg);
    expect(thumbnail.length).toBeLessThan(svg.length / 5);
    expect(thumbnail).toContain('<foreignObject x="0" y="0" width="1920" height="200">');
    expect(thumbnail).toContain(
      '<image x="132" y="266" width="1080" height="607.5" preserveAspectRatio="none" href="data:image/webp;base64,',
    );
    const href = /href="data:image\/webp;base64,([^"]+)"/.exec(thumbnail)?.[1] ?? '';
    const image = await loadImage(Buffer.from(href, 'base64'));
    // 1080 × 607.5 of 1920 units at 640 px thumbnail width: about 360 × 203 px.
    expect(image.width).toBeGreaterThanOrEqual(360);
    expect(image.width).toBeLessThanOrEqual(362);
    expect(image.height).toBeGreaterThanOrEqual(203);
    expect(image.height).toBeLessThanOrEqual(204);
  });

  it('leaves small pictures, SVG pictures and slides without pictures alone', async () => {
    const small = slide(await photo(300, 160));
    expect(await svgThumbnail(small)).toBe(small);
    const vector = slide('data:image/svg+xml;base64,PHN2Zy8+');
    expect(await svgThumbnail(vector)).toBe(vector);
    const broken = slide(`data:image/png;base64,${'A'.repeat(64 * 1024)}`);
    expect(await svgThumbnail(broken)).toBe(broken);
  });

  it('storeSlideRender keeps the full SVG and stores the light one as thumbnail', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'slider-thumb-'));
    try {
      const storage = new FsBlobStorage(root);
      const svg = slide(await photo(1600, 900));
      const keys = await storeSlideRender(storage, 'd1', 'r1', svg, null);
      expect(keys.thumbnailKey).not.toBe(keys.imageKey);
      expect((await storage.get(keys.imageKey))?.byteLength).toBe(Buffer.byteLength(svg));
      expect((await storage.size(keys.thumbnailKey)) ?? Infinity).toBeLessThan(svg.length / 5);

      const plain = slide('data:image/svg+xml;base64,PHN2Zy8+');
      const same = await storeSlideRender(storage, 'd1', 'r1', plain, null);
      expect(same.thumbnailKey).toBe(same.imageKey);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
