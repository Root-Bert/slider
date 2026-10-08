import { afterEach, describe, expect, it, vi } from 'vitest';
import { deckSchema, slideSchema } from '@slider/shared';
import type { DeckRow, RevisionRow } from '../src/db/schema';
import { createOfficePdf, renderSlidePages, type OfficePdf } from '../src/import/office-pages';
import type { PptxToPdf } from '../src/import/libreoffice';
import { rasterizePdf } from '../src/import/pdf-pages';
import { silentLogger } from '../src/logger';
import type { SourceAdapter, SourceAdapters } from '../src/sources/source-adapter';
import { createTestContext, parsedSlide, stubPptx, type TestContext } from './helpers';
import { makePdf } from './pdf';

const WEBP_MAGIC = [0x52, 0x49, 0x46, 0x46]; // "RIFF"

const deckRow = (overrides: Partial<DeckRow> = {}) =>
  ({
    id: 'deck-1',
    ownerId: 'user-1',
    fileName: 'Deck.pptx',
    source: 'onedrive',
    sourceRef: 'drives/d1/items/i1',
    ...overrides,
  }) as DeckRow;
const revisionRow = (overrides: Partial<RevisionRow> = {}) =>
  ({ id: 'rev-1', sourceChangeToken: 'ctag-1', ...overrides }) as RevisionRow;

const slides = (hidden: boolean[]) =>
  hidden.map((isHidden, i) => ({ ...parsedSlide(256 + i, i), hidden: isHidden }));
const pdfOf =
  (pages: number): OfficePdf =>
  async () =>
    makePdf(pages);

describe('rasterizePdf', () => {
  it('renders every page to a full-size and a thumbnail WebP', async () => {
    const pages = await rasterizePdf(makePdf(2));
    expect(pages).toHaveLength(2);
    for (const page of pages) {
      expect([...page.image.slice(0, 4)]).toEqual(WEBP_MAGIC);
      expect([...page.thumbnail.slice(0, 4)]).toEqual(WEBP_MAGIC);
      expect(page.thumbnail.length).toBeLessThan(page.image.length);
    }
  });
});

describe('renderSlidePages (BER-94)', () => {
  const deps = (officePdf?: OfficePdf, libreOfficePdf?: PptxToPdf | null) => ({
    officePdf,
    libreOfficePdf,
    log: silentLogger,
  });
  const pptx = new Uint8Array([80, 75, 3, 4]);
  const upload = deckRow({ source: 'upload', sourceRef: null });

  it('maps pages onto the visible slides and leaves hidden ones to the preview', async () => {
    const result = await renderSlidePages(
      deps(pdfOf(2)),
      deckRow(),
      revisionRow(),
      pptx,
      slides([false, true, false]),
    );
    expect(result.renderer).toBe('office');
    expect(result.pages.map((page) => page !== null)).toEqual([true, false, true]);
  });

  it('uses no page at all when the page count does not match the visible slides', async () => {
    const result = await renderSlidePages(
      deps(pdfOf(2)),
      deckRow(),
      revisionRow(),
      pptx,
      slides([false, false, false]),
    );
    expect(result).toEqual({ renderer: 'svg', pages: [null, null, null] });
  });

  it('falls back to the preview without a PDF or with a broken one', async () => {
    expect(await renderSlidePages(deps(), deckRow(), revisionRow(), pptx, slides([false]))).toEqual(
      { renderer: null, pages: [null] },
    );
    const broken: OfficePdf = async () => new TextEncoder().encode('%PDF-1.4 nonsense');
    expect(
      await renderSlidePages(deps(broken), deckRow(), revisionRow(), pptx, slides([false])),
    ).toEqual({ renderer: 'svg', pages: [null] });
  });

  it("renders uploads with LibreOffice, from the revision's own file", async () => {
    const libreOffice = vi.fn<PptxToPdf>(async () => makePdf(2));
    const result = await renderSlidePages(
      deps(pdfOf(5), libreOffice),
      upload,
      revisionRow(),
      pptx,
      slides([false, false]),
    );
    expect(result.renderer).toBe('libreoffice');
    expect(result.pages.every((page) => page !== null)).toBe(true);
    expect(libreOffice).toHaveBeenCalledWith(pptx);
  });

  it('falls back to LibreOffice when Office has no PDF, and to the preview when it fails', async () => {
    const noOffice: OfficePdf = async () => null;
    const viaLibreOffice = await renderSlidePages(
      deps(noOffice, async () => makePdf(1)),
      deckRow(),
      revisionRow(),
      pptx,
      slides([false]),
    );
    expect(viaLibreOffice.renderer).toBe('libreoffice');

    const failing = await renderSlidePages(
      deps(noOffice, async () => {
        throw new Error('soffice crashed');
      }),
      upload,
      revisionRow(),
      pptx,
      slides([false]),
    );
    expect(failing).toEqual({ renderer: 'svg', pages: [null] });
  });

  it('prefers Office over LibreOffice for linked decks', async () => {
    const libreOffice = vi.fn<PptxToPdf>(async () => makePdf(1));
    const result = await renderSlidePages(
      deps(pdfOf(1), libreOffice),
      deckRow(),
      revisionRow(),
      pptx,
      slides([false]),
    );
    expect(result.renderer).toBe('office');
    expect(libreOffice).not.toHaveBeenCalled();
  });
});

describe('createOfficePdf', () => {
  function sourcesWith(adapter: Partial<SourceAdapter>) {
    const full: SourceAdapter = {
      resolve: vi.fn(),
      download: vi.fn(),
      getChangeToken: vi.fn(async () => 'ctag-1'),
      exportPdf: vi.fn(async () => makePdf(1)),
      ...adapter,
    };
    const sources = { onedrive: full, sharepoint: full, url: full } as SourceAdapters;
    return { sources, adapter: full };
  }

  it('exports the PDF of an unchanged Graph file as the deck owner', async () => {
    const { sources, adapter } = sourcesWith({});
    const pdf = await createOfficePdf(sources, silentLogger)(deckRow(), revisionRow());
    expect(pdf).not.toBeNull();
    expect(adapter.exportPdf).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'drives/d1/items/i1' }),
      { userId: 'user-1' },
    );
  });

  it('skips uploads and files that changed since the revision', async () => {
    const { sources, adapter } = sourcesWith({ getChangeToken: vi.fn(async () => 'ctag-2') });
    const officePdf = createOfficePdf(sources, silentLogger);
    expect(await officePdf(deckRow({ source: 'upload', sourceRef: null }), revisionRow())).toBe(
      null,
    );
    expect(await officePdf(deckRow(), revisionRow())).toBeNull();
    expect(adapter.exportPdf).not.toHaveBeenCalled();
  });

  it('cannot compare anonymous SharePoint links and exports them as they are', async () => {
    const { sources, adapter } = sourcesWith({});
    const deck = deckRow({ source: 'sharepoint', sourceRef: 'https://q4.sharepoint.com/:p:/s/x' });
    expect(await createOfficePdf(sources, silentLogger)(deck, revisionRow())).not.toBeNull();
    expect(adapter.getChangeToken).not.toHaveBeenCalled();
  });

  it('turns export errors into "no PDF"', async () => {
    const { sources } = sourcesWith({
      exportPdf: vi.fn(async () => {
        throw new Error('Graph down');
      }),
    });
    expect(await createOfficePdf(sources, silentLogger)(deckRow(), revisionRow())).toBeNull();
  });
});

describe('import with Office pages', () => {
  let ctx: TestContext | undefined;
  afterEach(async () => {
    await ctx?.cleanup();
    ctx = undefined;
  });

  it('stores WebP images and thumbnails for visible slides, SVG for hidden ones', async () => {
    const parsed = slides([false, true, false]);
    ctx = await createTestContext({
      openPptx: stubPptx({ slides: parsed }),
      officePdf: pdfOf(2),
    });
    const form = new FormData();
    form.append('file', new File([new Uint8Array([80, 75, 3, 4])], 'Deck.pptx'));
    const created = deckSchema.parse(
      await (await ctx.request('/api/decks/upload', { method: 'POST', body: form })).json(),
    );
    await ctx.deps.queue.idle();

    const list = slideSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${created.id}/slides`)).json());
    expect(list).toHaveLength(3);
    const types = await Promise.all(
      list.map(async (slide) => [
        (await ctx!.request(slide.imageUrl)).headers.get('content-type'),
        (await ctx!.request(slide.thumbnailUrl)).headers.get('content-type'),
      ]),
    );
    expect(types).toEqual([
      ['image/webp', 'image/webp'],
      ['image/svg+xml', 'image/svg+xml'],
      ['image/webp', 'image/webp'],
    ]);
    expect(list[0]?.imageUrl).not.toBe(list[0]?.thumbnailUrl);

    const deck = deckSchema.parse(await (await ctx.request(`/api/decks/${created.id}`)).json());
    expect(deck.thumbnailRenderer).toBe('office');
  });
});
