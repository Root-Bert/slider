import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type * as Canvas from '@napi-rs/canvas';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { describe, expect, it, vi } from 'vitest';
import { storeSlideRender } from '../src/import/office-pages';
import { rasterSize, svgThumbnail } from '../src/import/svg-thumbnail';
import { FsBlobStorage } from '../src/storage/fs-blob-storage';

// The real decoder, counted.
vi.mock('@napi-rs/canvas', async (importOriginal) => {
  const canvas = await importOriginal<typeof Canvas>();
  return { ...canvas, loadImage: vi.fn(canvas.loadImage) };
});

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

  it('never decodes a picture whose header names more pixels than it may take', async () => {
    // A PNG header claiming 20000 × 20000 px (1.6 GB once decoded), padded past the size floor.
    const header = Buffer.alloc(64 * 1024);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
    header.writeUInt32BE(13, 8);
    header.write('IHDR', 12, 'latin1');
    header.writeUInt32BE(20_000, 16);
    header.writeUInt32BE(20_000, 20);
    expect(rasterSize(header)).toEqual({ width: 20_000, height: 20_000 });
    const bomb = slide(`data:image/png;base64,${header.toString('base64')}`);
    expect(await svgThumbnail(bomb)).toBe(bomb);
  });

  it('decodes a picture repeated on the slide once', async () => {
    const href = await photo(1600, 900);
    const repeated = slide(href).replace(/<image [^>]*>/, (tag) => tag.repeat(21));
    vi.mocked(loadImage).mockClear();
    const thumbnail = await svgThumbnail(repeated);

    expect(vi.mocked(loadImage)).toHaveBeenCalledTimes(1);
    expect(thumbnail.match(/href="data:image\/webp;base64,/g)).toHaveLength(21);
    expect(new Set(thumbnail.match(/href="[^"]+"/g)).size).toBe(1);
  });

  it('decodes at most a bounded number of pixels per slide', async () => {
    // Distinct pictures whose headers name 8000 × 8000 px each: only four are decoded.
    const pictures = Array.from({ length: 6 }, (_, index) => {
      const header = Buffer.alloc(64 * 1024, index);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
      header.writeUInt32BE(13, 8);
      header.write('IHDR', 12, 'latin1');
      header.writeUInt32BE(8000, 16);
      header.writeUInt32BE(8000, 20);
      return slide(`data:image/png;base64,${header.toString('base64')}`).match(
        /<image [^>]*>/,
      )?.[0];
    });
    const svg = slide('').replace(/<image [^>]*>/, pictures.join(''));
    vi.mocked(loadImage).mockClear();

    expect(await svgThumbnail(svg)).toBe(svg);
    expect(vi.mocked(loadImage)).toHaveBeenCalledTimes(4);
  });

  it('reads the size of PNG, JPEG, WebP, GIF and BMP pictures from their header', async () => {
    const canvas = createCanvas(321, 123);
    for (const encoded of [
      await canvas.encode('png'),
      await canvas.encode('jpeg', 80),
      await canvas.encode('webp', 80),
      await canvas.encode('webp', 100),
    ]) {
      expect(rasterSize(encoded)).toEqual({ width: 321, height: 123 });
    }
    const gif = Buffer.from('GIF89a\x41\x01\x7b\x00', 'latin1');
    expect(rasterSize(gif)).toEqual({ width: 321, height: 123 });
    const bmp = Buffer.alloc(54);
    bmp.write('BM', 0, 'latin1');
    bmp.writeUInt32LE(40, 14);
    bmp.writeInt32LE(321, 18);
    bmp.writeInt32LE(-123, 22);
    expect(rasterSize(bmp)).toEqual({ width: 321, height: 123 });
    expect(rasterSize(Buffer.from('<svg/>'))).toBeNull();
    expect(rasterSize(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
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

      // A photo far bigger than the full slide shows it: the full SVG carries it at most at
      // page resolution (2400 px wide), not at its original size.
      const small = (href: string) =>
        `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">` +
        `<image x="0" y="0" width="480" height="270" preserveAspectRatio="none" href="${href}"/></svg>`;
      const big = small(await photo(1600, 900));
      const scaled = await storeSlideRender(storage, 'd1', 'r1', big, null);
      const stored = new TextDecoder().decode((await storage.get(scaled.imageKey)) ?? undefined);
      expect(stored.length).toBeLessThan(big.length / 2);
      const fullHref = /href="data:image\/webp;base64,([^"]+)"/.exec(stored)?.[1] ?? '';
      // 480 of 1920 units at 2400 px: 600 px wide.
      expect((await loadImage(Buffer.from(fullHref, 'base64'))).width).toBeLessThanOrEqual(602);

      const plain = slide('data:image/svg+xml;base64,PHN2Zy8+');
      const same = await storeSlideRender(storage, 'd1', 'r1', plain, null);
      expect(same.thumbnailKey).toBe(same.imageKey);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
