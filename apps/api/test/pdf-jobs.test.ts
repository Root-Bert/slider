import { afterEach, describe, expect, it, vi } from 'vitest';
import { deckSchema } from '@slider/shared';
import { PptxError } from '@slider/pptx';
import { ConversionAborted } from '../src/import/libreoffice';
import { openPdfDeck } from '../src/import/pdf-deck';
import {
  configurePdfJobs,
  PdfTimedOut,
  resumePdfJobs,
  runningPdfJobs,
  runPdfTask,
  stopPdfJobs,
} from '../src/import/pdf-jobs';
import { rasterizePdf } from '../src/import/pdf-pages';
import { createTestContext, type TestContext } from './helpers';
import { makeSlidesPdf } from './pdf';

/*
 * The PDF worker machinery on Node: a plain JavaScript stand-in takes the place of pdf-worker.ts
 * (which needs Bun to start), so the deadline, the page hand-over, the errors and the shutdown
 * run for real – worker thread, transfer and termination included.
 */

const STAND_IN = new URL('./fixtures/pdf-worker-stand-in.mjs', import.meta.url);
const order = (text: string) => new TextEncoder().encode(text);

let ctx: TestContext | undefined;
let restore: ReturnType<typeof configurePdfJobs> | undefined;
afterEach(async () => {
  if (restore) configurePdfJobs(restore);
  restore = undefined;
  resumePdfJobs();
  await ctx?.cleanup();
  ctx = undefined;
});

const useStandIn = (timeoutMs = 10_000) => {
  restore = configurePdfJobs({ inProcess: false, workerUrl: STAND_IN, timeoutMs });
};

describe('PDF workers', () => {
  it('hands the pages over one at a time and leaves the caller its bytes', async () => {
    useStandIn();
    const bytes = order('pages:3');
    const seen: number[][] = [];
    const count = await rasterizePdf(bytes, async (page, index) => {
      // The next page is only drawn once this one is stored.
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push([index, ...page.image]);
    });
    expect(count).toBe(3);
    expect(seen).toEqual([
      [0, 0, 1, 2],
      [1, 1, 1, 2],
      [2, 2, 1, 2],
    ]);
    // The worker got a copy: the caller's bytes are not detached.
    expect(new TextDecoder().decode(bytes)).toBe('pages:3');
    expect(runningPdfJobs()).toBe(0);
  });

  it('cuts off a PDF that takes too long: the worker is terminated, the error says why', async () => {
    useStandIn(50);
    const started = Date.now();
    await expect(openPdfDeck(makeSlidesPdf([{ texts: [] }]))).rejects.toBeInstanceOf(PdfTimedOut);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(runningPdfJobs()).toBe(0);
    // The slots are free again: the next PDF runs.
    await expect(runPdfTask({ kind: 'pages', bytes: order('pages:1') })).resolves.toBe(1);
  });

  it('does not count the time the caller takes to store a page', async () => {
    useStandIn(200);
    const count = await rasterizePdf(order('pages:2'), async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(count).toBe(2);
  });

  it("gives back the PDF's own errors as what they are, and a crash as an error", async () => {
    useStandIn();
    await expect(openPdfDeck(order('encrypted'))).rejects.toSatisfy(
      (error) => error instanceof PptxError && error.code === 'encrypted',
    );
    await expect(openPdfDeck(order('crash'))).rejects.toThrow('stand-in crashed');
    expect(runningPdfJobs()).toBe(0);
  });

  it('stops running workers on shutdown, and starts no new ones', async () => {
    useStandIn();
    const running = openPdfDeck(order('hang'));
    await vi.waitFor(() => expect(runningPdfJobs()).toBe(1));
    stopPdfJobs();
    await expect(running).rejects.toBeInstanceOf(ConversionAborted);
    expect(runningPdfJobs()).toBe(0);
    await expect(openPdfDeck(order('pages:1'))).rejects.toBeInstanceOf(ConversionAborted);
  });

  it('fails the import of a PDF that takes too long, and says so', async () => {
    useStandIn(50);
    ctx = await createTestContext();
    const body = new FormData();
    body.append('file', new File([makeSlidesPdf([{ texts: [] }])], 'Schwer.pdf'));
    const res = await ctx.request('/api/decks/upload', { method: 'POST', body });
    expect(res.status).toBe(201);
    const deck = deckSchema.parse(await res.json());
    await ctx.deps.queue.idle();
    expect(
      deckSchema.parse(await (await ctx.request(`/api/decks/${deck.id}`)).json()).import,
    ).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/zu lange gedauert/),
    });
    expect(runningPdfJobs()).toBe(0);
  });
});
