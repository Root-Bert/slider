import { afterEach, describe, expect, it, vi } from 'vitest';
import { deckSchema, slideSchema } from '@slider/shared';
import type { DeckRow, RevisionRow } from '../src/db/schema';
import {
  createOfficePdf,
  hasPdfRenderer,
  OfficePdfUnavailable,
  renderSlidePages,
  type OfficePdf,
} from '../src/import/office-pages';
import type { PptxToPdf } from '../src/import/libreoffice';
import { PageCountMismatch, rasterizePdf, type PageImages } from '../src/import/pdf-pages';
import { silentLogger } from '../src/logger';
import {
  OFFICE_FILE_TOO_BIG,
  officeErrorCode,
  OfficePdfError,
} from '../src/sources/microsoft-graph';
import { sourceForbidden } from '../src/sources/errors';
import type { SourceAdapter, SourceAdapters } from '../src/sources/source-adapter';
import type { BlobStorage } from '../src/storage/blob-storage';
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

/** Blob storage in memory, for the page images {@link renderSlidePages} stores. */
function memoryStorage() {
  const blobs = new Map<string, Uint8Array>();
  const storage = {
    put: vi.fn(async (key: string, data: Uint8Array) => {
      blobs.set(key, data);
    }),
    get: async (key: string) => (blobs.get(key) as Uint8Array<ArrayBuffer> | undefined) ?? null,
    size: async (key: string) => blobs.get(key)?.length ?? null,
    stream: async () => null,
    delete: async (key: string) => {
      blobs.delete(key);
    },
    deletePrefix: async () => {},
    list: async (prefix: string) => [...blobs.keys()].filter((key) => key.startsWith(prefix)),
  } satisfies BlobStorage;
  return { storage, blobs };
}

describe('rasterizePdf', () => {
  it('renders every page to a full-size and a thumbnail WebP', async () => {
    const pages: PageImages[] = [];
    const count = await rasterizePdf(makePdf(2), async (page, index) => {
      expect(index).toBe(pages.length);
      pages.push(page);
    });
    expect(count).toBe(2);
    expect(pages).toHaveLength(2);
    for (const page of pages) {
      expect([...page.image.slice(0, 4)]).toEqual(WEBP_MAGIC);
      expect([...page.thumbnail.slice(0, 4)]).toEqual(WEBP_MAGIC);
      expect(page.thumbnail.length).toBeLessThan(page.image.length);
    }
  });
  it('hands each page over before drawing the next, and refuses a wrong page count up front', async () => {
    const order: string[] = [];
    await rasterizePdf(makePdf(3), async (_, index) => {
      order.push(`page ${index}`);
      await Promise.resolve();
      order.push(`stored ${index}`);
    });
    expect(order).toEqual(['page 0', 'stored 0', 'page 1', 'stored 1', 'page 2', 'stored 2']);

    const onPage = vi.fn(async () => {});
    await expect(rasterizePdf(makePdf(3), onPage, { expectedPages: 2 })).rejects.toBeInstanceOf(
      PageCountMismatch,
    );
    expect(onPage).not.toHaveBeenCalled();
  });

  it('refuses a page too tall to draw instead of allocating a giant canvas', async () => {
    const onPage = vi.fn(async () => {});
    // 1 × 1000 points: 2.4 million pixels tall at the page image width.
    await expect(rasterizePdf(makePdf(1, { width: 1, height: 1000 }), onPage)).rejects.toThrow(
      /too tall/,
    );
    expect(onPage).not.toHaveBeenCalled();
  });
});

describe('renderSlidePages (BER-94)', () => {
  const deps = (officePdf?: OfficePdf, libreOfficePdf?: PptxToPdf | null) => ({
    storage: memoryStorage().storage,
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

  it('stores each page as it is drawn and keeps only its keys', async () => {
    const { storage, blobs } = memoryStorage();
    const result = await renderSlidePages(
      { ...deps(pdfOf(2)), storage },
      deckRow(),
      revisionRow(),
      pptx,
      slides([false, false]),
    );
    expect(result.pages).toEqual([
      {
        imageKey: expect.stringMatching(/^decks\/deck-1\/rev-1\/slides\/.+\.webp$/),
        thumbnailKey: expect.any(String),
      },
      { imageKey: expect.any(String), thumbnailKey: expect.any(String) },
    ]);
    for (const page of result.pages) {
      expect([...(blobs.get(page!.imageKey) ?? []).slice(0, 4)]).toEqual(WEBP_MAGIC);
      expect([...(blobs.get(page!.thumbnailKey) ?? []).slice(0, 4)]).toEqual(WEBP_MAGIC);
    }
  });

  it('draws no page of a PDF with the wrong page count, then tries the next renderer', async () => {
    const { storage, blobs } = memoryStorage();
    const result = await renderSlidePages(
      { ...deps(pdfOf(3), async () => makePdf(2)), storage },
      deckRow(),
      revisionRow(),
      pptx,
      slides([false, false]),
    );
    expect(result.renderer).toBe('libreoffice');
    // Only LibreOffice's two pages were drawn and stored – none of Office's three.
    expect(storage.put).toHaveBeenCalledTimes(4);
    expect(blobs.size).toBe(4);
  });

  it('uses no page at all when the page count does not match the visible slides', async () => {
    const result = await renderSlidePages(
      deps(pdfOf(2)),
      deckRow(),
      revisionRow(),
      pptx,
      slides([false, false, false]),
    );
    expect(result).toEqual({
      renderer: 'svg',
      pages: [null, null, null],
      officeFailure: 'Das PDF von Microsoft hat 2 Seiten für 3 sichtbare Folien.',
    });
  });

  it('falls back to the preview without a PDF or with a broken one', async () => {
    expect(await renderSlidePages(deps(), deckRow(), revisionRow(), pptx, slides([false]))).toEqual(
      { renderer: null, pages: [null], officeFailure: null },
    );
    const broken: OfficePdf = async () => new TextEncoder().encode('%PDF-1.4 nonsense');
    expect(
      await renderSlidePages(deps(broken), deckRow(), revisionRow(), pptx, slides([false])),
    ).toEqual({
      renderer: 'svg',
      pages: [null],
      officeFailure: 'Das PDF von Microsoft ist nicht lesbar.',
    });
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
    expect(failing).toEqual({ renderer: 'svg', pages: [null], officeFailure: null });
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

  it('exports the PDF of an unchanged Graph file through the deck’s Microsoft connection', async () => {
    const { sources, adapter } = sourcesWith({});
    const pdf = await createOfficePdf(sources, silentLogger)(
      deckRow({ microsoftConnectionId: 'conn-1' }),
      revisionRow(),
    );
    expect(pdf).not.toBeNull();
    expect(adapter.exportPdf).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'drives/d1/items/i1' }),
      expect.objectContaining({ userId: 'user-1', connectionId: 'conn-1' }),
    );
  });

  it('without a connection of its own, tries the owner’s accounts until one has access', async () => {
    const tried: (string | null | undefined)[] = [];
    const { sources } = sourcesWith({
      exportPdf: vi.fn(async (_file, context) => {
        tried.push(context.connectionId);
        context.connectionUsed = true;
        if (context.connectionId !== 'conn-b') throw sourceForbidden();
        return makePdf(1);
      }),
    });
    const connections = {
      connectionIds: vi.fn(async () => ['conn-a', 'conn-b']),
      markUsed: vi.fn(async () => {}),
    };
    const pdf = await createOfficePdf(
      sources,
      silentLogger,
      connections,
    )(deckRow({ microsoftConnectionId: null }), revisionRow());
    expect(pdf).not.toBeNull();
    expect(tried).toEqual(['conn-a', 'conn-b']);
    expect(connections.connectionIds).toHaveBeenCalledWith('user-1');
  });

  it('skips uploads and files that changed since the revision', async () => {
    const { sources, adapter } = sourcesWith({ getChangeToken: vi.fn(async () => 'ctag-2') });
    const officePdf = createOfficePdf(sources, silentLogger);
    expect(await officePdf(deckRow({ source: 'upload', sourceRef: null }), revisionRow())).toBe(
      null,
    );
    await expect(officePdf(deckRow(), revisionRow())).rejects.toThrow(
      'Die Datei wurde seit dieser Version geändert.',
    );
    expect(adapter.exportPdf).not.toHaveBeenCalled();
  });

  it('cannot compare anonymous SharePoint links and exports them as they are', async () => {
    const { sources, adapter } = sourcesWith({});
    const deck = deckRow({ source: 'sharepoint', sourceRef: 'https://q4.sharepoint.com/:p:/s/x' });
    expect(await createOfficePdf(sources, silentLogger)(deck, revisionRow())).not.toBeNull();
    expect(adapter.getChangeToken).not.toHaveBeenCalled();
  });

  it('turns export errors into OfficePdfUnavailable with the reason', async () => {
    const { sources } = sourcesWith({
      exportPdf: vi.fn(async () => {
        throw new OfficePdfError(400, OFFICE_FILE_TOO_BIG);
      }),
    });
    const error: unknown = await createOfficePdf(sources, silentLogger)(
      deckRow(),
      revisionRow(),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OfficePdfUnavailable);
    expect(error).toMatchObject({
      message: 'Die Datei ist zu groß für die PDF-Umwandlung von Microsoft.',
      officeCode: OFFICE_FILE_TOO_BIG,
    });
  });

  it('names the size of a file too big for Office on the deck', async () => {
    const tooBig: OfficePdf = async () => {
      throw new OfficePdfUnavailable(
        'Die Datei ist zu groß für die PDF-Umwandlung von Microsoft.',
        OFFICE_FILE_TOO_BIG,
      );
    };
    const result = await renderSlidePages(
      {
        storage: memoryStorage().storage,
        officePdf: tooBig,
        libreOfficePdf: async () => makePdf(1),
        log: silentLogger,
      },
      deckRow(),
      revisionRow(),
      new Uint8Array(153_600_000),
      slides([false]),
    );
    expect(result.renderer).toBe('libreoffice');
    expect(result.officeFailure).toBe(
      'Die Datei ist zu groß für die PDF-Umwandlung von Microsoft (154 MB).',
    );
  });
});

describe('hasPdfRenderer', () => {
  const graph = { exportPdf: vi.fn() } as unknown as SourceAdapter;
  const sources = { onedrive: graph, sharepoint: graph, url: {}, nextcloud: {} } as SourceAdapters;
  const officePdf = createOfficePdf(sources, silentLogger);
  const nextcloudDeck = deckRow({ source: 'nextcloud', sourceRef: 'https://cloud.example.de/f/1' });

  it('counts Office only for sources that export PDFs', () => {
    expect(hasPdfRenderer({ officePdf }, deckRow())).toBe(true);
    // Without LibreOffice a Nextcloud deck stays SVG: syncs keep its images, no re-render.
    expect(hasPdfRenderer({ officePdf }, nextcloudDeck)).toBe(false);
    expect(hasPdfRenderer({ officePdf }, deckRow({ source: 'url', sourceRef: 'https://x' }))).toBe(
      false,
    );
    expect(hasPdfRenderer({ officePdf }, deckRow({ source: 'upload', sourceRef: null }))).toBe(
      false,
    );
  });

  it('counts LibreOffice for every deck', () => {
    const libreOfficePdf: PptxToPdf = async () => makePdf(1);
    expect(hasPdfRenderer({ officePdf, libreOfficePdf }, nextcloudDeck)).toBe(true);
  });
});

describe('officeErrorCode', () => {
  it("reads the conversion service's code from a problem+json answer", () => {
    const body = JSON.stringify({
      title: 'BadRequest',
      detail:
        'Error from Office Service. HttpCode=BadRequest ErrorCategory=BadRequest ' +
        'ErrorCode=Service_InvalidInput_FileTooBigToConvert Url=https://example.test/pdf',
    });
    expect(officeErrorCode(body)).toBe(OFFICE_FILE_TOO_BIG);
  });

  it("falls back to Graph's error code, and to null", () => {
    expect(officeErrorCode('{"error":{"code":"notSupported","message":"x"}}')).toBe('notSupported');
    expect(officeErrorCode('<html>bad gateway</html>')).toBeNull();
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
