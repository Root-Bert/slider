import { mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { API_PREFIX, DECK_TUS_PATH, type ErrorCode } from '@slider/shared';
import { requireDeckAccess, requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { Clock } from '../clock';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, fileTooLarge, notFound } from '../http/errors';
import { deckUploadSlot, importLimit } from '../http/import-limit';
import { loadComment } from '../services/comments';
import { assertDeckSlot } from '../services/plans';
import { resolveUploadWorkspace } from '../services/workspaces';
import { createUploadedDeck } from './decks';
import { assertNewVersionAllowed, importNewVersion } from './sync';

/*
 * Deck files in parts over tus 1.0.0 (creation, termination, expiration), so no single request
 * is bigger than a part – Cloudflare's proxy refuses requests over 100 MB. The parts go straight
 * into a file in `<dataDir>/tmp/uploads` (an upload outlives an API restart; `tus-js-client`
 * goes on where it stopped); `POST …/:id/finish` then makes the deck exactly as
 * `POST /decks/upload` does (or a new version, as `POST /decks/:id/revisions`). A recording
 * (`purpose recording`, of a voice or video comment) is named by its id in the comment's own
 * request instead (`media.ts`, `takeRecordingUpload`). Each upload belongs to the account that
 * began it – to anyone else it does not exist.
 */

const TUS_VERSION = '1.0.0';
/** Unfinished uploads one account keeps: a further one drops its oldest (a tab closed midway). */
export const TUS_UPLOADS_PER_USER = 3;
/** All accounts together: bounds the disk the unfinished uploads take. */
export const TUS_UPLOADS_TOTAL = 20;
/** An upload untouched this long is gone, file and all. */
export const TUS_UPLOAD_EXPIRY_MS = 24 * 60 * 60_000;
const SWEEP_EVERY_MS = 60 * 60_000;
/** How long a finished upload's answer is given again. */
export const FINISHED_KEPT_MS = 60 * 60_000;
/** Failures of a finish that the person can fix without sending the file again. */
const RETRYABLE_CODES = new Set<ErrorCode>([
  'rate_limited',
  'plan_limit',
  'plan_over_limit',
  'quota_exceeded',
  'storage_busy',
]);

interface TusUpload {
  id: string;
  userId: string;
  fileName: string;
  size: number;
  /** A deck file (absent in uploads of an earlier run: one), a recording or a board's file. */
  purpose?: TusPurpose;
  /** A new deck in this workspace … */
  workspaceId: string | null;
  /** … or a new version of this deck (a recording: a new comment on it; a material: its board). */
  deckId: string | null;
  /** A recording replacing this comment's own. */
  commentId?: string | null;
  touchedAt: number;
}

/** A deck file, a voice/video comment's recording, or a file put on a deck's board (Folie 0). */
type TusPurpose = 'deck' | 'recording' | 'material';

const ID_PATTERN = /^[0-9a-f-]{36}$/;

/** The unfinished uploads: a file of the bytes received and a `.json` beside it for each. */
export class TusUploads {
  private loaded: Promise<Map<string, TusUpload>> | null = null;
  /** Uploads a request writes or finishes right now: a second one at once is refused. */
  readonly busy = new Set<string>();
  /** Answers of finished uploads, so a finish retried (its answer lost on the way) gets it again. */
  private readonly finished = new Map<
    string,
    { userId: string; status: 200 | 201; body: unknown; at: number }
  >();

  constructor(
    readonly dir: string,
    private readonly clock: Clock,
  ) {}

  /** Read from disk once: what an earlier run left. */
  all(): Promise<Map<string, TusUpload>> {
    this.loaded ??= (async () => {
      await mkdir(this.dir, { recursive: true });
      const uploads = new Map<string, TusUpload>();
      for (const name of await readdir(this.dir)) {
        if (!name.endsWith('.json')) continue;
        try {
          const upload = JSON.parse(await readFile(path.join(this.dir, name), 'utf8')) as TusUpload;
          if (ID_PATTERN.test(upload.id)) uploads.set(upload.id, upload);
        } catch {
          // Written halfway when the server stopped: its upload starts again.
        }
      }
      return uploads;
    })();
    return this.loaded;
  }

  file = (id: string) => path.join(this.dir, id);

  async get(id: string, userId: string): Promise<TusUpload> {
    const upload = ID_PATTERN.test(id) ? (await this.all()).get(id) : undefined;
    if (!upload || upload.userId !== userId) throw notFound('Diesen Upload gibt es nicht (mehr).');
    return upload;
  }

  /** Bytes received so far: what is in the file. */
  async offset(upload: TusUpload): Promise<number> {
    return (await stat(this.file(upload.id)).catch(() => ({ size: 0 }))).size;
  }

  async save(upload: TusUpload): Promise<void> {
    upload.touchedAt = this.clock.now().getTime();
    await writeFile(`${this.file(upload.id)}.json`, JSON.stringify(upload));
  }

  async create(upload: TusUpload): Promise<void> {
    await writeFile(this.file(upload.id), new Uint8Array());
    await this.save(upload);
    (await this.all()).set(upload.id, upload);
  }

  rememberFinished(upload: TusUpload, status: 200 | 201, body: unknown): void {
    const now = this.clock.now().getTime();
    for (const [id, done] of this.finished) {
      if (now - done.at > FINISHED_KEPT_MS) this.finished.delete(id);
    }
    this.finished.set(upload.id, { userId: upload.userId, status, body, at: now });
  }

  finishedAnswer(id: string, userId: string) {
    const done = this.finished.get(id);
    if (!done || done.userId !== userId) return null;
    return this.clock.now().getTime() - done.at > FINISHED_KEPT_MS ? null : done;
  }

  /**
   * Lets go of an upload taken by a finish: gone after success – and after a failure only when
   * a retry could not help (the file itself refused). Busy slots, a full plan or a server
   * problem keep it, so the finish can be asked again without sending the file anew.
   */
  async release(upload: TusUpload, error?: unknown): Promise<void> {
    this.busy.delete(upload.id);
    const retryable =
      error !== undefined &&
      (!(error instanceof ApiError) || error.status >= 500 || RETRYABLE_CODES.has(error.code));
    if (!retryable) await this.remove(upload.id);
  }

  async remove(id: string): Promise<void> {
    (await this.all()).delete(id);
    await Promise.all([
      rm(this.file(id), { force: true }),
      rm(`${this.file(id)}.json`, { force: true }),
    ]);
  }

  /** Drops expired uploads – only once something read the folder (not in every test app). */
  async sweep(): Promise<void> {
    if (!this.loaded) return;
    const now = this.clock.now().getTime();
    for (const upload of [...(await this.all()).values()]) {
      if (now - upload.touchedAt > TUS_UPLOAD_EXPIRY_MS && !this.busy.has(upload.id)) {
        await this.remove(upload.id);
      }
    }
  }
}

const stores = new WeakMap<AppDeps, TusUploads>();

/** One store per app, in `<dataDir>/tmp/uploads`, swept for expired uploads every hour. */
export function tusUploads(deps: AppDeps): TusUploads {
  let store = stores.get(deps);
  if (!store) {
    const made = new TusUploads(path.join(deps.config.dataDir, 'tmp', 'uploads'), deps.clock);
    setInterval(() => void made.sweep().catch(() => {}), SWEEP_EVERY_MS).unref?.();
    stores.set(deps, made);
    store = made;
  }
  return store;
}

/** `Upload-Metadata`: `key base64,key base64` (a key may come without a value). */
function readMetadata(header: string | undefined): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const pair of (header ?? '').split(',')) {
    const [key, value] = pair.trim().split(' ');
    if (!key) continue;
    metadata[key] = value ? Buffer.from(value, 'base64').toString('utf8') : '';
  }
  return metadata;
}

export const recordingTooLarge = (maxBytes: number) =>
  new ApiError(
    413,
    'file_too_large',
    `Die Aufnahme ist zu groß (maximal ${Math.floor(maxBytes / 1024 / 1024)} MB).`,
  );

const conflict = (message: string) => new ApiError(409, 'bad_request', message);

/** Marks a complete upload as taken; refused while it is running or bytes are missing. */
async function claimComplete(store: TusUploads, upload: TusUpload): Promise<void> {
  if (store.busy.has(upload.id)) throw conflict('Dieser Upload läuft noch.');
  if ((await store.offset(upload)) !== upload.size) {
    throw conflict('Die Datei ist noch nicht vollständig hochgeladen.');
  }
  store.busy.add(upload.id);
}

/**
 * A recording sent over tus (`upload` instead of the `file` field of `media.ts`): its bytes, and
 * `done(error?)` to let go of it once the comment is made or failed (`release`). Only its uploader's, only
 * for the deck or comment it was begun for.
 */
export async function takeRecordingUpload(
  deps: AppDeps,
  id: string,
  userId: string,
  target: { deckId: string } | { commentId: string },
): Promise<{ bytes: Uint8Array<ArrayBuffer>; done: (error?: unknown) => Promise<void> }> {
  const store = tusUploads(deps);
  const upload = await store.get(id, userId);
  const matches =
    upload.purpose === 'recording' &&
    ('deckId' in target
      ? upload.deckId === target.deckId && !upload.commentId
      : upload.commentId === target.commentId);
  if (!matches) throw badRequest('Dieser Upload ist keine Aufnahme für diesen Kommentar.');
  await claimComplete(store, upload);
  const done = (error?: unknown) => store.release(upload, error);
  try {
    const file = await readFile(store.file(upload.id));
    return { bytes: new Uint8Array(file.buffer, file.byteOffset, file.byteLength), done };
  } catch (error) {
    await done(error);
    throw error;
  }
}

/**
 * A file for a deck's board sent over tus (`purpose material`): its bytes, its name, and
 * `done(error?)` as for a recording. Only its uploader's, only for the deck it was begun for.
 */
export async function takeMaterialUpload(
  deps: AppDeps,
  id: string,
  userId: string,
  deckId: string,
): Promise<{
  bytes: Uint8Array<ArrayBuffer>;
  fileName: string;
  done: (error?: unknown) => Promise<void>;
}> {
  const store = tusUploads(deps);
  const upload = await store.get(id, userId);
  if (upload.purpose !== 'material' || upload.deckId !== deckId) {
    throw badRequest('Dieser Upload ist kein Material dieser Präsentation.');
  }
  await claimComplete(store, upload);
  const done = (error?: unknown) => store.release(upload, error);
  try {
    const file = await readFile(store.file(upload.id));
    return {
      bytes: new Uint8Array(file.buffer, file.byteOffset, file.byteLength),
      fileName: upload.fileName,
      done,
    };
  } catch (error) {
    await done(error);
    throw error;
  }
}

export function deckTusRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const imports = importLimit(deps);
  const uploads = deckUploadSlot(deps);
  const maxBytes = deps.config.maxUploadBytes;
  const maxMediaBytes = deps.config.media.maxBytes;
  const store = tusUploads(deps);
  // A deck counts in the hourly import budget; a recording in the media budget, when it is sent;
  // a board's file in the deck's storage.
  const deckImports = createMiddleware<ViewerEnv>((c, next) =>
    purposeOf(c) === 'deck' ? imports(c, next) : next(),
  );
  const purposeOf = (c: Context): TusPurpose => {
    const { purpose } = readMetadata(c.req.header('upload-metadata'));
    return purpose === 'recording' || purpose === 'material' ? purpose : 'deck';
  };

  // Every answer names the protocol; a client of another version is refused (OPTIONS aside).
  const tus = createMiddleware(async (c, next) => {
    c.header('Tus-Resumable', TUS_VERSION);
    if (c.req.method !== 'OPTIONS' && c.req.header('tus-resumable') !== TUS_VERSION) {
      c.header('Tus-Version', TUS_VERSION);
      throw new ApiError(412, 'bad_request', 'Diese Upload-Version kennt der Server nicht.');
    }
    await next();
  });

  // Before anything is stored: may this account create the deck (or the version) at all?
  // A recording: may this account comment on the deck (or edit the comment's recording)?
  const mayCreate = createMiddleware<ViewerEnv>(async (c, next) => {
    const size = Number(c.req.header('upload-length'));
    if (!Number.isSafeInteger(size) || size < 0) throw badRequest('Upload-Length fehlt.');
    if (size === 0) throw badRequest('Die Datei ist leer.');
    const { filename, workspaceId, deckId, commentId } = readMetadata(
      c.req.header('upload-metadata'),
    );
    if (purposeOf(c) === 'recording') {
      if (size > maxMediaBytes) throw recordingTooLarge(maxMediaBytes);
      const commented = commentId ? (await loadComment(deps, commentId)).deckId : deckId;
      if (!commented) throw badRequest('Zu welcher Präsentation gehört die Aufnahme?');
      await requireDeckAccess(deps, c.var.viewer, commented, 'comment');
      return next();
    }
    if (purposeOf(c) === 'material') {
      if (size > maxBytes) throw fileTooLarge(maxBytes);
      if (!deckId) throw badRequest('Zu welcher Präsentation gehört das Material?');
      if (!filename) throw badRequest('Der Dateiname fehlt.');
      // Who may comment may put material on the board.
      await requireDeckAccess(deps, c.var.viewer, deckId, 'comment');
      return next();
    }
    requireOwner(c.var.viewer);
    if (size > maxBytes) throw fileTooLarge(maxBytes);
    if (deckId) await assertNewVersionAllowed(deps, c.var.viewer, deckId);
    else {
      const resolved = await resolveUploadWorkspace(deps, c.var.viewer.author.id, workspaceId);
      if (workspaceId) await assertDeckSlot(deps.db, deps.config, resolved);
    }
    if (!filename) throw badRequest('Der Dateiname fehlt.');
    await next();
  });

  return (
    new Hono<ViewerEnv>()
      .use(`${DECK_TUS_PATH}/*`, tus)
      .use(DECK_TUS_PATH, tus)
      .options(DECK_TUS_PATH, (c) => {
        c.header('Tus-Version', TUS_VERSION);
        c.header('Tus-Extension', 'creation,termination,expiration');
        c.header('Tus-Max-Size', String(maxBytes));
        return c.body(null, 204);
      })

      .post(DECK_TUS_PATH, viewer, mayCreate, deckImports, async (c) => {
        const userId = c.var.viewer.author.id;
        const { filename, workspaceId, deckId, commentId } = readMetadata(
          c.req.header('upload-metadata'),
        );
        const purpose = purposeOf(c);
        await store.sweep();
        const open = [...(await store.all()).values()];
        const mine = open.filter((upload) => upload.userId === userId);
        if (mine.length >= TUS_UPLOADS_PER_USER) {
          const oldest = mine.sort((a, b) => a.touchedAt - b.touchedAt)[0];
          if (oldest && !store.busy.has(oldest.id)) await store.remove(oldest.id);
        } else if (open.length >= TUS_UPLOADS_TOTAL) {
          c.header('Retry-After', '60');
          throw new ApiError(
            429,
            'rate_limited',
            'Gerade werden viele Präsentationen gleichzeitig hochgeladen. Bitte versuch es gleich noch einmal.',
          );
        }
        const upload: TusUpload = {
          id: crypto.randomUUID(),
          userId,
          fileName: filename ?? '',
          purpose,
          size: Number(c.req.header('upload-length')),
          workspaceId: deckId || purpose !== 'deck' ? null : workspaceId || null,
          deckId: purpose === 'recording' && commentId ? null : deckId || null,
          commentId: purpose === 'recording' ? commentId || null : null,
          touchedAt: 0,
        };
        await store.create(upload);
        c.header('Location', `${API_PREFIX}${DECK_TUS_PATH}/${upload.id}`);
        c.header('Upload-Expires', new Date(upload.touchedAt + TUS_UPLOAD_EXPIRY_MS).toUTCString());
        return c.body(null, 201);
      })

      // Hono answers HEAD from this route, without the body.
      .get(`${DECK_TUS_PATH}/:id`, viewer, async (c) => {
        const upload = await store.get(c.req.param('id'), c.var.viewer.author.id);
        c.header('Upload-Offset', String(await store.offset(upload)));
        c.header('Upload-Length', String(upload.size));
        c.header('Cache-Control', 'no-store');
        return c.body(null, 200);
      })

      .patch(`${DECK_TUS_PATH}/:id`, viewer, async (c) => {
        const upload = await store.get(c.req.param('id'), c.var.viewer.author.id);
        if (c.req.header('content-type') !== 'application/offset+octet-stream') {
          throw new ApiError(
            415,
            'bad_request',
            'Ein Teil kommt als application/offset+octet-stream.',
          );
        }
        if (store.busy.has(upload.id)) throw conflict('Dieser Upload läuft schon.');
        const offset = Number(c.req.header('upload-offset'));
        const received = await store.offset(upload);
        if (offset !== received) throw conflict(`Der Upload steht bei Byte ${received}.`);
        const declared = Number(c.req.header('content-length'));
        if (Number.isFinite(declared) && offset + declared > upload.size) {
          throw badRequest('Der Teil reicht über das Ende der Datei hinaus.');
        }
        store.busy.add(upload.id);
        let written = received;
        let tooLong = false;
        const file = await open(store.file(upload.id), 'a');
        try {
          const reader = c.req.raw.body?.getReader();
          // Straight to disk as it comes: a part is never held whole in memory.
          for (;;) {
            const chunk = await reader?.read().catch(() => null);
            if (!chunk || chunk.done) break;
            const room = upload.size - written;
            const bytes =
              chunk.value.byteLength > room ? chunk.value.subarray(0, room) : chunk.value;
            await file.write(bytes);
            written += bytes.byteLength;
            if (bytes !== chunk.value) {
              tooLong = true;
              await reader?.cancel().catch(() => {});
              break;
            }
          }
        } finally {
          await file.close();
          store.busy.delete(upload.id);
        }
        // A part cut off midway keeps what arrived: the client asks with HEAD and goes on from there.
        await store.save(upload);
        if (tooLong) throw badRequest('Der Teil reicht über das Ende der Datei hinaus.');
        c.header('Upload-Offset', String(written));
        c.header('Upload-Expires', new Date(upload.touchedAt + TUS_UPLOAD_EXPIRY_MS).toUTCString());
        return c.body(null, 204);
      })

      .delete(`${DECK_TUS_PATH}/:id`, viewer, async (c) => {
        const upload = await store.get(c.req.param('id'), c.var.viewer.author.id);
        if (!store.busy.has(upload.id)) await store.remove(upload.id);
        return c.body(null, 204);
      })

      /**
       * All parts there: the deck (201, or 200 with the deck that has the same file already) or
       * the new version – as `POST /decks/upload` and `POST /decks/:id/revisions` answer. The
       * file is read whole here, so this takes one of the deck upload slots.
       */
      .post(`${DECK_TUS_PATH}/:id/finish`, viewer, uploads, async (c) => {
        const { viewer } = c.var;
        requireOwner(viewer);
        const again = store.finishedAnswer(c.req.param('id'), viewer.author.id);
        if (again) return c.json(again.body, again.status);
        const upload = await store.get(c.req.param('id'), viewer.author.id);
        if (upload.purpose === 'recording') {
          throw badRequest('Eine Aufnahme kommt mit ihrem Kommentar (Feld „upload“).');
        }
        if (upload.purpose === 'material') {
          throw badRequest('Material kommt mit seiner eigenen Anfrage (Feld „upload“).');
        }
        await claimComplete(store, upload);
        try {
          const file = {
            fileName: upload.fileName,
            original: await readFile(store.file(upload.id)),
          };
          let answer: { status: 200 | 201; body: unknown };
          if (upload.deckId) {
            await assertNewVersionAllowed(deps, viewer, upload.deckId);
            answer = { status: 200, body: await importNewVersion(deps, upload.deckId, file) };
          } else {
            const { deck, created } = await createUploadedDeck(
              deps,
              viewer,
              upload.workspaceId ?? undefined,
              file,
            );
            answer = { status: created ? 201 : 200, body: deck };
          }
          store.rememberFinished(upload, answer.status, answer.body);
          await store.release(upload);
          return c.json(answer.body, answer.status);
        } catch (error) {
          await store.release(upload, error);
          throw error;
        }
      })
  );
}
