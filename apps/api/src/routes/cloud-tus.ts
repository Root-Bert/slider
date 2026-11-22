import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import {
  API_PREFIX,
  CLOUD_TUS_PATH,
  cloudUploadQuerySchema,
  type CloudUploadResult,
} from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { Clock } from '../clock';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, fileTooLarge, notFound } from '../http/errors';
import {
  cloudContext,
  cloudMaxFileBytes,
  loadNode,
  looksOnly,
  noEditRight,
  nodeNotFound,
  storeUpload,
} from '../services/cloud';
import { resolveTarget } from '../services/cloud/tree';
import { uploadComes, uploadEnded } from '../services/cloud/uploading';
import { assertStorageFor } from '../services/plans';

/*
 * Cloud: large files in parts over tus 1.0.0 (creation, termination, expiration) – the same
 * protocol as deck files (`deck-tus.ts`), with a store of its own: a folder dropped into the
 * browser is hundreds of uploads at once, far more than the few a deck upload keeps. The parts
 * go straight into a file in `<dataDir>/tmp/cloud-uploads`; `POST …/:id/finish` then stores it
 * as `POST /workspaces/:id/cloud/files` does. An upload belongs to the account that began it.
 */

const TUS_VERSION = '1.0.0';
/** Unfinished uploads one account keeps; a further one is refused until some are through. */
const UPLOADS_PER_USER = 200;
const UPLOAD_EXPIRY_MS = 24 * 60 * 60_000;
const SWEEP_EVERY_MS = 60 * 60_000;
const FINISHED_KEPT_MS = 60 * 60_000;
const ID_PATTERN = /^[0-9a-f-]{36}$/;

interface CloudUpload {
  id: string;
  userId: string;
  workspaceId: string;
  size: number;
  /** As `POST …/cloud/files` takes them in its address. */
  query: Record<string, string>;
  mimeType: string | null;
  touchedAt: number;
}

class CloudUploads {
  private loaded: Promise<Map<string, CloudUpload>> | null = null;
  readonly busy = new Set<string>();
  private readonly finished = new Map<
    string,
    { userId: string; status: 200 | 201; body: CloudUploadResult; at: number }
  >();

  constructor(
    readonly dir: string,
    private readonly clock: Clock,
  ) {}

  all(): Promise<Map<string, CloudUpload>> {
    this.loaded ??= (async () => {
      await mkdir(this.dir, { recursive: true });
      const uploads = new Map<string, CloudUpload>();
      for (const name of await readdir(this.dir)) {
        if (!name.endsWith('.json')) continue;
        try {
          const upload = JSON.parse(
            await readFile(path.join(this.dir, name), 'utf8'),
          ) as CloudUpload;
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

  async get(id: string, userId: string): Promise<CloudUpload> {
    const upload = ID_PATTERN.test(id) ? (await this.all()).get(id) : undefined;
    if (!upload || upload.userId !== userId) throw notFound('Diesen Upload gibt es nicht (mehr).');
    return upload;
  }

  async offset(upload: CloudUpload): Promise<number> {
    return (await stat(this.file(upload.id)).catch(() => ({ size: 0 }))).size;
  }

  async save(upload: CloudUpload): Promise<void> {
    upload.touchedAt = this.clock.now().getTime();
    await writeFile(`${this.file(upload.id)}.json`, JSON.stringify(upload));
  }

  async create(upload: CloudUpload): Promise<void> {
    await this.all();
    await writeFile(this.file(upload.id), new Uint8Array());
    await this.save(upload);
    (await this.all()).set(upload.id, upload);
  }

  async remove(id: string): Promise<void> {
    (await this.all()).delete(id);
    await Promise.all([
      rm(this.file(id), { force: true }),
      rm(`${this.file(id)}.json`, { force: true }),
    ]);
  }

  rememberFinished(upload: CloudUpload, status: 200 | 201, body: CloudUploadResult): void {
    const now = this.clock.now().getTime();
    for (const [id, done] of this.finished) {
      if (now - done.at > FINISHED_KEPT_MS) this.finished.delete(id);
    }
    this.finished.set(upload.id, { userId: upload.userId, status, body, at: now });
  }

  finishedAnswer(id: string, userId: string) {
    const done = this.finished.get(id);
    return done && done.userId === userId ? done : null;
  }

  async sweep(): Promise<void> {
    if (!this.loaded) return;
    const now = this.clock.now().getTime();
    for (const upload of [...(await this.all()).values()]) {
      if (now - upload.touchedAt > UPLOAD_EXPIRY_MS && !this.busy.has(upload.id)) {
        await this.remove(upload.id);
      }
    }
  }
}

const stores = new WeakMap<AppDeps, CloudUploads>();

function uploadsOf(deps: AppDeps): CloudUploads {
  let store = stores.get(deps);
  if (!store) {
    const made = new CloudUploads(
      path.join(deps.config.dataDir, 'tmp', 'cloud-uploads'),
      deps.clock,
    );
    setInterval(() => void made.sweep().catch(() => {}), SWEEP_EVERY_MS).unref?.();
    stores.set(deps, made);
    store = made;
  }
  return store;
}

function readMetadata(header: string | undefined): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const pair of (header ?? '').split(',')) {
    const [key, value] = pair.trim().split(' ');
    if (!key) continue;
    metadata[key] = value ? Buffer.from(value, 'base64').toString('utf8') : '';
  }
  return metadata;
}

const conflict = (message: string) => new ApiError(409, 'bad_request', message);

export function cloudTusRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const store = uploadsOf(deps);
  const maxBytes = cloudMaxFileBytes(deps.config);
  // Told to who watches the place it goes to: on its way from its first part to its last.
  const comes = (upload: CloudUpload) => {
    const { name, parentId, areaId, nodeId } = upload.query;
    if (name)
      uploadComes(
        upload.id,
        { workspaceId: upload.workspaceId, name, parentId, areaId, nodeId },
        deps.clock.now().getTime(),
      );
  };
  const tus = createMiddleware(async (c, next) => {
    c.header('Tus-Resumable', TUS_VERSION);
    if (c.req.method !== 'OPTIONS' && c.req.header('tus-resumable') !== TUS_VERSION) {
      c.header('Tus-Version', TUS_VERSION);
      throw new ApiError(412, 'bad_request', 'Diese Upload-Version kennt der Server nicht.');
    }
    await next();
  });

  return (
    new Hono<ViewerEnv>()
      .use(`${CLOUD_TUS_PATH}/*`, tus)
      .use(CLOUD_TUS_PATH, tus)
      .options(CLOUD_TUS_PATH, (c) => {
        c.header('Tus-Version', TUS_VERSION);
        c.header('Tus-Extension', 'creation,termination,expiration');
        c.header('Tus-Max-Size', String(maxBytes));
        return c.body(null, 204);
      })
      .post(CLOUD_TUS_PATH, viewer, async (c) => {
        requireOwner(c.var.viewer);
        const userId = c.var.viewer.author.id;
        const size = Number(c.req.header('upload-length'));
        if (!Number.isSafeInteger(size) || size < 0) throw badRequest('Upload-Length fehlt.');
        if (size > maxBytes) throw fileTooLarge(maxBytes);
        const { workspaceId, filetype, ...rest } = readMetadata(c.req.header('upload-metadata'));
        if (!workspaceId) throw badRequest('In welchen Workspace soll die Datei?');
        // What the finish will be asked with, checked now: a wrong name fails before a byte is sent.
        const query = cloudUploadQuerySchema.parse(rest);
        // … and the right to put it there: who may not change the place reserves no room.
        const ctx = await cloudContext(deps.db, workspaceId, userId);
        if (looksOnly(ctx.role)) throw noEditRight();
        if (query.nodeId) {
          const { node } = await loadNode(deps, userId, query.nodeId, 'edit');
          if (node.workspaceId !== workspaceId) throw nodeNotFound();
        } else {
          await resolveTarget(deps, ctx, query, 'edit');
        }
        await store.sweep();
        const uploads = await store.all();
        // From here to the upload's place in the list nothing is awaited: many begun at once
        // each see the ones before them, not the same list.
        const running = [...uploads.values()];
        const mine = running.filter((upload) => upload.userId === userId);
        if (mine.length >= UPLOADS_PER_USER) {
          c.header('Retry-After', '30');
          throw new ApiError(
            429,
            'rate_limited',
            'Gerade laufen sehr viele Uploads von dir. Die nächsten gehen los, sobald welche durch sind.',
          );
        }
        const upload: CloudUpload = {
          id: crypto.randomUUID(),
          userId,
          workspaceId,
          size,
          query: rest,
          mimeType: filetype || null,
          touchedAt: deps.clock.now().getTime(),
        };
        uploads.set(upload.id, upload);
        try {
          // With what is on its way already: uploads begun at once must not each be measured
          // against the same free room and fill the disk together.
          const coming = running
            .filter((each) => each.workspaceId === workspaceId)
            .reduce((sum, each) => sum + each.size, 0);
          await deps.db.transaction((tx) =>
            assertStorageFor(tx, deps.config, workspaceId, size + coming, deps.clock.now()),
          );
          await store.create(upload);
          comes(upload);
        } catch (error) {
          await store.remove(upload.id);
          throw error;
        }
        c.header('Location', `${API_PREFIX}${CLOUD_TUS_PATH}/${upload.id}`);
        c.header('Upload-Expires', new Date(upload.touchedAt + UPLOAD_EXPIRY_MS).toUTCString());
        return c.body(null, 201);
      })
      .get(`${CLOUD_TUS_PATH}/:id`, viewer, async (c) => {
        const upload = await store.get(c.req.param('id'), c.var.viewer.author.id);
        c.header('Upload-Offset', String(await store.offset(upload)));
        c.header('Upload-Length', String(upload.size));
        c.header('Cache-Control', 'no-store');
        return c.body(null, 200);
      })
      .patch(`${CLOUD_TUS_PATH}/:id`, viewer, async (c) => {
        const upload = await store.get(c.req.param('id'), c.var.viewer.author.id);
        if (c.req.header('content-type') !== 'application/offset+octet-stream') {
          throw new ApiError(
            415,
            'bad_request',
            'Ein Teil kommt als application/offset+octet-stream.',
          );
        }
        if (store.busy.has(upload.id)) throw conflict('Dieser Upload läuft schon.');
        comes(upload);
        // Taken before anything is awaited: two parts sent at once must not both pass the check
        // and write past the file's end.
        store.busy.add(upload.id);
        let written: number;
        let before: number;
        let tooLong = false;
        let file: Awaited<ReturnType<typeof open>> | null = null;
        try {
          const offset = Number(c.req.header('upload-offset'));
          const received = await store.offset(upload);
          if (offset !== received) throw conflict(`Der Upload steht bei Byte ${received}.`);
          written = received;
          before = received;
          file = await open(store.file(upload.id), 'a');
          const reader = c.req.raw.body?.getReader();
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
          // Free again whatever closing the file says: an upload left taken could never go on.
          try {
            await file?.close();
          } finally {
            store.busy.delete(upload.id);
          }
        }
        // Only bytes keep it alive: parts that bring nothing must not hold its room forever.
        if (written > before) await store.save(upload);
        if (tooLong) throw badRequest('Der Teil reicht über das Ende der Datei hinaus.');
        c.header('Upload-Offset', String(written));
        c.header('Upload-Expires', new Date(upload.touchedAt + UPLOAD_EXPIRY_MS).toUTCString());
        return c.body(null, 204);
      })
      .delete(`${CLOUD_TUS_PATH}/:id`, viewer, async (c) => {
        const upload = await store.get(c.req.param('id'), c.var.viewer.author.id);
        if (!store.busy.has(upload.id)) await store.remove(upload.id);
        uploadEnded(upload.id);
        return c.body(null, 204);
      })
      // All parts there: the file is stored as a whole upload would be. Asked again (the answer
      // lost on the way), the same answer comes again.
      .post(`${CLOUD_TUS_PATH}/:id/finish`, viewer, async (c) => {
        requireOwner(c.var.viewer);
        const userId = c.var.viewer.author.id;
        const again = store.finishedAnswer(c.req.param('id'), userId);
        if (again) return c.json(again.body, again.status);
        const upload = await store.get(c.req.param('id'), userId);
        if (store.busy.has(upload.id)) throw conflict('Dieser Upload läuft noch.');
        // Taken before the await: stored once, even when finished twice at the same moment.
        store.busy.add(upload.id);
        let complete = false;
        try {
          complete = (await store.offset(upload)) === upload.size;
        } finally {
          if (!complete) store.busy.delete(upload.id);
        }
        if (!complete) throw conflict('Die Datei ist noch nicht vollständig hochgeladen.');
        // From here `storeUpload` says it is on its way, until it is there.
        uploadEnded(upload.id);
        try {
          const query = cloudUploadQuerySchema.parse(upload.query);
          const result = await storeUpload(
            deps,
            userId,
            upload.workspaceId,
            { ...query, keepBoth: query.keepBoth === '1' },
            {
              data: createReadStream(store.file(upload.id)) as AsyncIterable<Uint8Array>,
              size: upload.size,
              mimeType: upload.mimeType,
            },
          );
          const status = result.created ? 201 : 200;
          store.rememberFinished(upload, status, result);
          store.busy.delete(upload.id);
          await store.remove(upload.id);
          return c.json(result, status);
        } catch (error) {
          store.busy.delete(upload.id);
          // The file itself refused (a name that is taken by a folder, no right any more): a
          // retry cannot help, so it goes. A full plan or a server problem keeps it.
          const keep =
            !(error instanceof ApiError) ||
            error.status >= 500 ||
            error.code === 'plan_limit' ||
            error.code === 'plan_over_limit';
          if (!keep) await store.remove(upload.id);
          throw error;
        }
      })
  );
}
