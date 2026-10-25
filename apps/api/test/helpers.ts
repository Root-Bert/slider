import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { inject } from 'vitest';
import type { CreateCommentInput, Shape } from '@slider/shared';
import type { ParsedPresentation, ParsedSlide } from '@slider/pptx';
import { createApp } from '../src/app';
import { GoogleTokens } from '../src/auth/google';
import { MicrosoftTokens } from '../src/auth/microsoft';
import { NextcloudAccounts } from '../src/auth/nextcloud';
import { OidcClient } from '../src/auth/oidc';
import type { WebAuthn } from '../src/auth/passkeys';
import type { ResolveTxt } from '../src/auth/workspace-sso';
import { hashToken, newSecretToken, SESSION_COOKIE } from '../src/auth/session';
import type { Clock } from '../src/clock';
import type { Config } from '../src/config';
import {
  migratedSnapshot,
  migratePostgresAt,
  openDatabase,
  openSnapshot,
  type DatabaseHandle,
  type Executor,
} from '../src/db/client';
import { encryptToken } from '../src/auth/token-crypto';
import {
  decks,
  microsoftConnections,
  revisions,
  sessions,
  slides,
  slideVersions,
  users,
  type UserRow,
} from '../src/db/schema';
import type { BillingProvider } from '../src/billing/stripe-billing';
import type { AppDeps, InstanceControl } from '../src/deps';
import { importDeck } from '../src/import/import-deck';
import { createSlidesExtras, type SlidesExtrasReader } from '../src/import/slides-extras';
import type { DocumentToPdf, PptxToPdf } from '../src/import/libreoffice';
import type { OfficePdf } from '../src/import/office-pages';
import type { OpenPptx } from '../src/import/pptx';
import {
  importJobKey,
  importJobPriority,
  InProcessQueue,
  type ImportJob,
} from '../src/import/queue';
import { RenderProgress } from '../src/import/render-progress';
import { silentLogger } from '../src/logger';
import { NullMailer, type Mailer } from '../src/mail/mailer';
import type { LiveHub } from '../src/realtime/live-hub';
import { DEFAULT_PLAN_LIMITS } from '../src/services/plans';
import { upsertUser } from '../src/services/users';
import { ensurePersonalWorkspace } from '../src/services/workspaces';
import type { FetchLike, LookupAll } from '../src/sources/safe-fetch';
import { createSourceAdapters, type SourceAdapters } from '../src/sources/source-adapter';
import { blobKeys } from '../src/storage/blob-storage';
import { EncryptedBlobStorage } from '../src/storage/encrypted-blob-storage';
import { TEST_DATA_KEY } from './setup-data-key';
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
  devOwner: { name: 'Robert Hofmann', email: 'robert@example.org' },
  // Requests without a session act as the dev owner, like `bun run dev` without a login.
  auth: {
    devLogin: true,
    signup: 'invite',
    signupDomains: [],
    oidc: null,
    google: null,
    sessionTtlDays: 30,
  },
  smtp: null,
  contactEmail: null,
  retention: { deleteUnused: false },
  inviteRateLimit: 1000,
  microsoft: null,
  nextcloud: { server: null, login: null, loginAnyServer: false },
  googleDrive: null,
  // Polling is driven by hand in tests (`SyncScheduler.tick`); the debounce default applies.
  sync: { pollIntervalMs: 0, debounceMs: 60_000 },
  media: { dir: '/unused', maxBytes: 1024 * 1024 },
  // The real plans (free: 5 people, 3 decks, 2 GB); tests that need more pass `plans`.
  limited: true,
  plans: DEFAULT_PLAN_LIMITS,
  // Without Stripe; billing tests pass `billing` and a fake provider (`test/fakes/billing`).
  billing: null,
  ...overrides,
});

/** A parser stub: `slideCount` slides with one title shape each, no comments. */
export function stubPptx(presentation: Partial<ParsedPresentation> = {}, slideCount = 2): OpenPptx {
  const parsed: ParsedPresentation = {
    size: { cx: 12_192_000, cy: 6_858_000 },
    slides: Array.from({ length: slideCount }, (_, i) => parsedSlide(256 + i, i)),
    sections: [],
    comments: [],
    author: null,
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
    guides: [],
    contentHash: '',
    creationId: null,
    groups: [],
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
  /** The dev owner's workspace ("Mein Workspace"); `createReadyDeck` puts decks here. */
  workspaceId: string;
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

/** Migrated once per run (`global-database.ts`), else once per test file; then copied per test. */
let snapshot: Promise<Blob> | undefined;
let template: Promise<string> | undefined;

const loadSnapshot = async () => {
  const file = inject('databaseSnapshot');
  return file ? new Blob([await readFile(file)]) : migratedSnapshot();
};

const databaseUrl = (serverUrl: string, name: string) => {
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return url.toString();
};

/**
 * An in-memory PGlite – or, with `TEST_DATABASE_URL` (CI's Postgres job), a fresh database on
 * that Postgres server, dropped again on close. That way the whole suite also runs on the
 * production driver (postgres-js) and its migrator, e.g.
 * `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres bun run test`.
 * Either way the migrations run once per test run (`global-database.ts`): PGlite starts from a
 * migrated snapshot, Postgres copies a migrated template database.
 */
export async function openTestDatabase(
  serverUrl = process.env.TEST_DATABASE_URL,
): Promise<DatabaseHandle> {
  if (!serverUrl) return openSnapshot(await (snapshot ??= loadSnapshot()));
  const admin = async (statement: string) => {
    const client = postgres(serverUrl, { max: 1, onnotice: () => {} });
    try {
      await client.unsafe(statement);
    } finally {
      await client.end();
    }
  };
  template ??= (async () => {
    const provided = inject('databaseTemplate');
    if (provided) return provided;
    const name = `slider_template_${crypto.randomUUID().replaceAll('-', '')}`;
    await admin(`create database ${name}`);
    await migratePostgresAt(databaseUrl(serverUrl, name));
    return name;
  })();
  const name = `slider_test_${crypto.randomUUID().replaceAll('-', '')}`;
  await admin(`create database ${name} template ${await template}`);
  const handle = await openDatabase(databaseUrl(serverUrl, name));
  return {
    db: handle.db,
    close: async () => {
      await handle.close();
      await admin(`drop database if exists ${name} with (force)`);
    },
  };
}

export async function createTestContext(
  options: {
    openPptx?: OpenPptx;
    /** Office's PDF of a deck (BER-94); without it every slide gets the SVG preview. */
    officePdf?: OfficePdf;
    /** LibreOffice's PDF of a PPTX (BER-94); a fake – LibreOffice is not needed for tests. */
    libreOfficePdf?: PptxToPdf;
    /** LibreOffice's PDF of a Word, Excel or text file; a fake too. Without it those are refused. */
    documentPdf?: DocumentToPdf;
    config?: Partial<Config>;
    fetch?: FetchLike;
    lookup?: LookupAll;
    /** DNS TXT records for workspaces' company logins (BER-162); none without it. */
    resolveTxt?: ResolveTxt;
    /** Replaces individual source adapters, e.g. with a fake OneDrive (no network). */
    sources?: Partial<SourceAdapters>;
    /** e.g. a `RecordingMailer` – invitations are only mailed with a configured mailer. */
    mailer?: Mailer;
    /** A fake Stripe (`test/fakes/billing`); needs `config.billing` too. */
    billing?: BillingProvider;
    /** Fake passkey verification (no real authenticator in tests). */
    webauthn?: WebAuthn;
    /** Environment and restart hook for the setup page; without it `/api/setup` is a 404. */
    instance?: InstanceControl;
    /** e.g. a hub with short stream timings; `createApp` makes a default one otherwise. */
    live?: LiveHub;
    /**
     * The dev owner is instance admin: the instance is claimed. Without the dev login, an
     * unclaimed instance lets signed-in accounts do nothing before the setup token
     * (`auth/instance-gate`) – tests of everything else start claimed.
     */
    instanceAdmin?: boolean;
  } = {},
): Promise<TestContext> {
  const { db, close } = await openTestDatabase();
  const blobsDir = await mkdtemp(path.join(tmpdir(), 'slider-api-test-'));
  // Encrypted at rest like in production (BER-149).
  const storage = new EncryptedBlobStorage(new FsBlobStorage(blobsDir), TEST_DATA_KEY);
  const media = new EncryptedBlobStorage(
    new FsBlobStorage(path.join(blobsDir, 'media-store')),
    TEST_DATA_KEY,
  );
  const clock = new TestClock();
  const owner = await upsertUser(db, {
    name: 'Robert Hofmann',
    email: 'robert@example.org',
    color: 'red',
  });
  if (options.instanceAdmin) {
    await db.update(users).set({ isInstanceAdmin: true }).where(eq(users.id, owner.id));
  }
  const workspaceId = await ensurePersonalWorkspace(db, owner.id);
  const openPptx = options.openPptx ?? stubPptx();
  const renderers = { officePdf: options.officePdf, libreOfficePdf: options.libreOfficePdf };
  const renderProgress = new RenderProgress();
  const config = testConfig(options.config);
  // Needs the source adapters, which are made below.
  let slidesExtras: SlidesExtrasReader = async () => null;
  const queue = new InProcessQueue<ImportJob>(
    (job) =>
      importDeck(
        {
          db,
          storage,
          openPptx,
          clock,
          log: silentLogger,
          ...renderers,
          slidesExtras: (deck, revision) => slidesExtras(deck, revision),
          renderProgress,
          syncPollMs: config.sync.pollIntervalMs,
        },
        job,
      ),
    silentLogger,
    { priority: importJobPriority, key: importJobKey },
  );
  const fetch = options.fetch ?? offlineFetch;
  const microsoft = new MicrosoftTokens({
    config: config.microsoft,
    secret: config.secret,
    db,
    clock,
    log: silentLogger,
    fetch,
  });
  const nextcloud = new NextcloudAccounts({
    db,
    secret: config.secret,
    clock,
    config: config.nextcloud,
    log: silentLogger,
    maxBytes: config.maxUploadBytes,
    webOrigin: config.webOrigin,
    fetch,
    lookup: options.lookup ?? publicLookup,
  });
  const googleDrive = new GoogleTokens({
    config: config.googleDrive,
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
      nextcloud,
      google: googleDrive,
    }),
    ...options.sources,
  };
  slidesExtras = createSlidesExtras(sources, silentLogger);
  const sync = new SyncService({
    db,
    storage,
    sources,
    queue,
    clock,
    log: silentLogger,
    config,
    connections: microsoft,
    documentPdf: options.documentPdf,
  });
  const deps: AppDeps = {
    config,
    db,
    storage,
    media,
    queue,
    sources,
    microsoft,
    nextcloud,
    googleDrive,
    clock,
    log: silentLogger,
    sync,
    rendering: { renderers, progress: renderProgress },
    documentPdf: options.documentPdf,
    oidc: config.auth.oidc ? new OidcClient(config.auth.oidc, clock, fetch) : null,
    google: config.auth.google ? new OidcClient(config.auth.google, clock, fetch) : null,
    webauthn: options.webauthn,
    ssoNetwork: {
      fetch,
      lookup: options.lookup ?? publicLookup,
      resolveTxt: options.resolveTxt ?? (async () => []),
    },
    billing: options.billing ?? null,
    mailer: options.mailer ?? new NullMailer(),
    instance: options.instance,
    ownerId: owner.id,
    live: options.live,
  };
  const app = createApp(deps);

  return {
    app,
    deps,
    clock,
    ownerId: owner.id,
    workspaceId,
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
    linkedById: ctx.ownerId,
    workspaceId: ctx.workspaceId,
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

/** A user with a login session (BER-129); `cookie` signs requests in as them. */
export async function signedInUser(
  ctx: TestContext,
  person: { name: string; email: string },
): Promise<{ user: UserRow; cookie: string }> {
  const user = await upsertUser(ctx.deps.db, { ...person, color: 'blue' });
  const token = newSecretToken();
  const now = ctx.clock.now();
  await ctx.deps.db.insert(sessions).values({
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash: hashToken(token),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  });
  return { user, cookie: `${SESSION_COOKIE}=${token}` };
}

/**
 * The `slider_session=…` pair a response sets (`__Host-slider_session` on an https production
 * instance), or `null` (deletions don't count).
 */
/** `name=value` of the cookie `name` a response sets (with or without `__Host-`), else `''`. */
export const cookiePair = (res: Response, name: string) =>
  res.headers
    .getSetCookie()
    .map((header) => header.split(';')[0] ?? '')
    .find((pair) => pair.startsWith(`${name}=`) || pair.startsWith(`__Host-${name}=`)) ?? '';

export function sessionCookieFrom(response: Response): string | null {
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(';')[0] ?? '';
    const name = pair.slice(0, pair.indexOf('='));
    const named = name === SESSION_COOKIE || name === `__Host-${SESSION_COOKIE}`;
    if (named && pair !== `${name}=`) return pair;
  }
  return null;
}

/** An unsigned JWT – the code flow takes ID tokens from the token endpoint unverified. */
export const fakeJwt = (claims: Record<string, unknown>) =>
  [
    Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    'signature',
  ].join('.');

/**
 * A Microsoft connection of `userId` straight in the database (its refresh token encrypted with
 * the test secret); returns its id. `refreshToken: null` → one Microsoft refused.
 */
export async function connectMicrosoft(
  db: Executor,
  userId: string,
  {
    refreshToken = 'rt-1',
    subject = `ms-${userId}`,
    account = null,
    lastUsedAt = null,
    createdAt = new Date(),
    identitySubject = null,
  }: {
    refreshToken?: string | null;
    subject?: string;
    account?: string | null;
    lastUsedAt?: Date | null;
    createdAt?: Date;
    identitySubject?: string | null;
  } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(microsoftConnections).values({
    id,
    userId,
    subject,
    account,
    identitySubject,
    refreshToken:
      refreshToken === null ? null : await encryptToken(testConfig().secret, refreshToken),
    lastUsedAt,
    createdAt,
  });
  return id;
}
