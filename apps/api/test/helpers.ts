import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { CreateCommentInput, Shape } from '@slider/shared';
import type { ParsedPresentation, ParsedSlide } from '@slider/pptx';
import { createApp } from '../src/app';
import { MicrosoftTokens } from '../src/auth/microsoft';
import type { Clock } from '../src/clock';
import type { Config } from '../src/config';
import { openDatabase } from '../src/db/client';
import { decks, revisions, slides, slideVersions } from '../src/db/schema';
import type { AppDeps } from '../src/deps';
import { importDeck } from '../src/import/import-deck';
import type { OfficePdf } from '../src/import/office-pages';
import type { OpenPptx } from '../src/import/pptx';
import { InProcessQueue, type ImportJob } from '../src/import/queue';
import { silentLogger } from '../src/logger';
import { upsertUser } from '../src/services/users';
import type { FetchLike, LookupAll } from '../src/sources/safe-fetch';
import { createSourceAdapters, type SourceAdapters } from '../src/sources/source-adapter';
import { blobKeys } from '../src/storage/blob-storage';
import { FsBlobStorage } from '../src/storage/fs-blob-storage';
import { SyncService } from '../src/sync/sync-service';

export class TestClock implements Clock {
  private offsetMs = 0;
  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
  advance(ms: number): void {
    this.offsetMs += ms;
  }
}

export const testConfig = (overrides: Partial<Config> = {}): Config => ({
  env: 'test',
  port: 0,
  dataDir: '/unused',
  secret: 'test-secret-test-secret-test-secret!',
  webOrigin: 'http://localhost:5173',
  maxUploadBytes: 1024 * 1024,
  devOwner: { name: 'Robert Hofmann', email: 'robert@q4-team.de' },
  inviteRateLimit: 1000,
  microsoft: null,
  // Polling is driven by hand in tests (`SyncScheduler.tick`); the debounce default applies.
  sync: { pollIntervalMs: 0, debounceMs: 60_000 },
  ...overrides,
});

/** A parser stub: `slideCount` slides with one title shape each, no comments. */
export function stubPptx(presentation: Partial<ParsedPresentation> = {}, slideCount = 2): OpenPptx {
  const parsed: ParsedPresentation = {
    size: { cx: 12_192_000, cy: 6_858_000 },
    slides: Array.from({ length: slideCount }, (_, i) => parsedSlide(256 + i, i)),
    sections: [],
    comments: [],
    ...presentation,
  };
  return async () => ({
    presentation: parsed,
    renderSlideSvg: async (slide: ParsedSlide) =>
      `<svg xmlns="http://www.w3.org/2000/svg"><text>${slide.sldId}</text></svg>`,
  });
}

export function parsedSlide(sldId: number, index: number): ParsedSlide {
  return {
    sldId,
    index,
    path: `ppt/slides/slide${index + 1}.xml`,
    hidden: false,
    title: `Folie ${index + 1}`,
    layoutName: 'Titel und Inhalt',
    textHash: `hash${index}`,
    background: null,
    shapes: [
      {
        id: '2',
        name: 'Titel 1',
        kind: 'text',
        bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 },
        text: `Folie ${index + 1}`,
        paragraphs: [],
        imagePath: null,
        fill: null,
        placeholder: 'title',
      },
    ],
  };
}

export interface TestContext {
  app: ReturnType<typeof createApp>;
  deps: AppDeps;
  clock: TestClock;
  ownerId: string;
  blobsDir: string;
  request(
    path: string,
    init?: RequestInit & { json?: unknown; cookie?: string },
  ): Promise<Response>;
  cleanup(): Promise<void>;
}

export const MICROSOFT_TEST_CONFIG = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  tenant: 'common',
  redirectUri: 'http://localhost:5173/api/auth/microsoft/callback',
};

/** Outgoing requests in tests must be mocked: this one fails loudly instead of hitting the network. */
export const offlineFetch: FetchLike = async (input) => {
  throw new Error(`Unexpected network request in test: ${String(input)}`);
};

/** Every host resolves to a public documentation address (TEST-NET-3 is not private). */
export const publicLookup: LookupAll = async () => [{ address: '203.0.113.10' }];

export async function createTestContext(
  options: {
    openPptx?: OpenPptx;
    /** Office's PDF of a deck (BER-94); without it every slide gets the SVG preview. */
    officePdf?: OfficePdf;
    config?: Partial<Config>;
    fetch?: FetchLike;
    lookup?: LookupAll;
    /** Replaces individual source adapters, e.g. with a fake OneDrive (no network). */
    sources?: Partial<SourceAdapters>;
  } = {},
): Promise<TestContext> {
  const { db, close } = await openDatabase();
  const blobsDir = await mkdtemp(path.join(tmpdir(), 'slider-api-test-'));
  const storage = new FsBlobStorage(blobsDir);
  const clock = new TestClock();
  const owner = await upsertUser(db, {
    name: 'Robert Hofmann',
    email: 'robert@q4-team.de',
    color: 'red',
  });
  const openPptx = options.openPptx ?? stubPptx();
  const queue = new InProcessQueue<ImportJob>(
    (job) =>
      importDeck(
        { db, storage, openPptx, clock, log: silentLogger, officePdf: options.officePdf },
        job,
      ),
    silentLogger,
  );
  const config = testConfig(options.config);
  const fetch = options.fetch ?? offlineFetch;
  const microsoft = new MicrosoftTokens({
    config: config.microsoft,
    secret: config.secret,
    db,
    clock,
    log: silentLogger,
    fetch,
  });
  const sources: SourceAdapters = {
    ...createSourceAdapters({
      config,
      tokens: microsoft,
      fetch,
      lookup: options.lookup ?? publicLookup,
    }),
    ...options.sources,
  };
  const sync = new SyncService({ db, storage, sources, queue, clock, log: silentLogger, config });
  const deps: AppDeps = {
    config,
    db,
    storage,
    queue,
    sources,
    microsoft,
    clock,
    log: silentLogger,
    sync,
    ownerId: owner.id,
  };
  const app = createApp(deps);

  return {
    app,
    deps,
    clock,
    ownerId: owner.id,
    blobsDir,
    request: async (url, init = {}) => {
      const { json, cookie, ...rest } = init;
      const headers = new Headers(rest.headers);
      if (json !== undefined) headers.set('Content-Type', 'application/json');
      if (cookie) headers.set('Cookie', cookie);
      return app.request(url, {
        ...rest,
        headers,
        body: json !== undefined ? JSON.stringify(json) : rest.body,
      });
    },
    cleanup: async () => {
      await queue.idle();
      await close();
      await rm(blobsDir, { recursive: true, force: true });
    },
  };
}

export interface DeckFixture {
  deckId: string;
  revisionId: string;
  slideIds: string[];
  imageKeys: string[];
}

/** Inserts a ready deck with `slideCount` slides (and stored renders) straight into the database. */
export async function createReadyDeck(
  ctx: TestContext,
  { title = 'Testdeck', slideCount = 3, shapes = [] as Shape[] } = {},
): Promise<DeckFixture> {
  const { db, storage } = ctx.deps;
  const deckId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const slideIds = Array.from({ length: slideCount }, () => crypto.randomUUID());
  const imageKeys = slideIds.map(() => blobKeys.slideRender(deckId, revisionId, 'svg'));

  await db.insert(decks).values({
    id: deckId,
    ownerId: ctx.ownerId,
    title,
    fileName: `${title}.pptx`,
    source: 'upload',
    importState: { status: 'ready' },
  });
  await db.insert(revisions).values({ id: revisionId, deckId, number: 1, pptxKey: null });
  await db.update(decks).set({ currentRevisionId: revisionId }).where(eq(decks.id, deckId));
  await db.insert(slides).values(slideIds.map((id) => ({ id, deckId })));
  await db.insert(slideVersions).values(
    slideIds.map((slideId, position) => ({
      id: crypto.randomUUID(),
      slideId,
      revisionId,
      position,
      imageKey: imageKeys[position] ?? '',
      thumbnailKey: imageKeys[position] ?? '',
      aspectRatio: 16 / 9,
      shapes,
    })),
  );
  for (const key of imageKeys) await storage.put(key, new TextEncoder().encode('<svg/>'));
  return { deckId, revisionId, slideIds, imageKeys };
}

export const pinComment = (slideId: string, body = 'Bitte prüfen.'): CreateCommentInput => ({
  slideId,
  body,
  anchor: { type: 'point', point: { x: 0.5, y: 0.5 }, shapeRef: null },
});

/** The `name=value` pair of a Set-Cookie header, ready to send back as `Cookie`. */
export function cookieFrom(response: Response): string {
  const header = response.headers.get('set-cookie');
  if (!header) throw new Error('Response sets no cookie');
  return header.split(';')[0] ?? '';
}
