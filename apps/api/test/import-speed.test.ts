import { describe, expect, it } from 'vitest';
import { rasterizePdf, type PageImages } from '../src/import/pdf-pages';
import { InProcessQueue, isUrgentImportJob, type ImportJob } from '../src/import/queue';
import { silentLogger } from '../src/logger';
import { makeSlidesPdf, type PdfPage } from './pdf';

describe('import queue', () => {
  it('starts a first import while a re-render holds every slot', async () => {
    const started: string[] = [];
    const finish = new Map<string, () => void>();
    const queue = new InProcessQueue<ImportJob>(
      (job) =>
        new Promise<void>((resolve) => {
          started.push(job.deckId);
          finish.set(job.deckId, resolve);
        }),
      silentLogger,
      { concurrency: 1, urgent: isUrgentImportJob },
    );
    queue.enqueue({ deckId: 'old', revisionId: 'r1', kind: 'rerender' });
    queue.enqueue({ deckId: 'linked', revisionId: 'r2', kind: 'sync' });
    await Promise.resolve();
    expect(started).toEqual(['old']);

    queue.enqueue({ deckId: 'upload', revisionId: 'r3' });
    await Promise.resolve();
    // The upload does not wait for the re-render; the sync still does.
    expect(started).toEqual(['old', 'upload']);

    queue.enqueue({ deckId: 'upload-2', revisionId: 'r4', kind: 'initial' });
    await Promise.resolve();
    // Uploads wait for each other, one lane of `concurrency` slots.
    expect(started).toEqual(['old', 'upload']);

    finish.get('upload')!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(['old', 'upload', 'upload-2']);

    finish.get('old')!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(['old', 'upload', 'upload-2', 'linked']);
    finish.get('upload-2')!();
    finish.get('linked')!();
    await queue.idle();
  });
});

describe('rasterizePdf', () => {
  const page = (rgb: [number, number, number]): PdfPage => ({
    texts: [],
    boxes: [{ x: 100, y: 100, w: 400, h: 200, rgb }],
  });

  it('hands every page over in order, as drawn alone, though several are encoded at once', async () => {
    const pages = [page([255, 0, 0]), page([0, 160, 0]), page([0, 0, 255]), page([90, 90, 90])];
    const together: { index: number; images: PageImages }[] = [];
    const count = await rasterizePdf(makeSlidesPdf(pages), async (images, index) => {
      together.push({ index, images });
    });
    expect(count).toBe(pages.length);
    expect(together.map(({ index }) => index)).toEqual([0, 1, 2, 3]);
    for (const [i, alone] of pages.entries()) {
      let single: PageImages | null = null;
      await rasterizePdf(makeSlidesPdf([alone]), async (images) => {
        single = images;
      });
      expect(Buffer.from(together[i]!.images.image).equals(Buffer.from(single!.image))).toBe(true);
      expect(
        Buffer.from(together[i]!.images.thumbnail).equals(Buffer.from(single!.thumbnail)),
      ).toBe(true);
    }
  }, 60_000);
});
