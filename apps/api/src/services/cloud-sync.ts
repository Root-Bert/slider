import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { and, asc, count, eq, gt, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { CloudAccount, CloudSync as CloudSyncStatus } from '@slider/shared';
import { openText, sealText } from '../crypto/content-crypto';
import { deckEdits, decks, revisions, workspaceMembers, workspaces } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, notFound } from '../http/errors';
import { sha256Hex } from '../import/common';
import { deckFileExtension } from '../import/odp-deck';
import { createDeckFromFile, deleteDeck } from './decks';
import { readJsonFile, writeJsonFile } from './desktop-json';
import { createWorkspace, ensurePersonalWorkspace, PERSONAL_WORKSPACE_NAME } from './workspaces';
import { purgeWorkspace } from './workspaces/workspaces';

/*
 * The desktop app keeps the signed-in account's workspaces and decks as copies on this machine
 * (BER-201): one holding, like iCloud. Without a connection everything works on the copies;
 * every pass (every few seconds, after signing in, on demand) brings both sides together:
 *
 *  - workspaces and decks new on one side are made on the other, deleted ones deleted;
 *  - local edit steps go to the server as the operations they were – applied there to the deck
 *    as it is (`applyWhatFits`: what no longer fits is left out); steps that are no plain
 *    operations (taking a step back, the AI, pictures uploaded here) send the whole file as a
 *    new version;
 *  - changes on the server (others', or what it left out) come down as a new version of the
 *    local copy, drawn by the local LibreOffice.
 *
 * What belongs together is kept in `<dataDir>/cloud-sync.json`; the session in `cloud.json`.
 * Signing out is like iCloud: the account's decks leave this machine, but decks made here and
 * the ones marked „Auf diesem Gerät behalten“ stay as this computer's own. Their links are kept
 * loosely (`detached`): signed in again with the same account they join their server decks again
 * instead of being uploaded twice. Not carried yet: comments, folders, materials, templates.
 */

const TOKEN_CONTEXT = 'desktop.cloud_token';
const EVERY_MS = 15_000;

interface StoredAccount {
  server: string;
  /** Sealed. */
  token: string;
  account: CloudAccount;
}

/** `cloud.json`: signed in, or – signed out – just the server signed in to last (Bitwarden). */
type StoredFile = { server: string } & Partial<Omit<StoredAccount, 'server'>>;

interface DeckLink {
  /** The local workspace it is in. */
  workspaceId: string;
  cloudId: string;
  /** The local copy as last brought together: its revision and edit step. */
  localRevisionId: string | null;
  localSeq: number;
  /** The server's deck as last brought together. */
  cloudRevisionId: string | null;
  cloudSeq: number;
  cloudUpdatedAt: string | null;
  /** The whole file sent as a new version: the server's revision before, until another is current. */
  pushedOver?: string | null;
  /** The server's file taken in: the local revision it became, until its import is done. */
  pulledOver?: string | null;
  /** Made on this machine and uploaded (`local`), or the account's deck brought here. Links
   * from before this was kept get it from which side is younger; until then `local`. */
  origin?: 'local' | 'cloud';
  /** „Auf diesem Gerät behalten“: stays here after signing out. */
  keep?: boolean;
  /** Kept through a sign-out: signed in again, a side gone only drops the link. */
  detached?: boolean;
  /** The title both sides last agreed on: the side that differs from it was renamed. */
  title?: string;
}

/** Stays on this machine when signing out. */
const staysHere = (link: DeckLink) => link.origin !== 'cloud' || link.keep === true;

interface Links {
  /** The account they belong to: another one signed in starts afresh. */
  email: string;
  /** Its server; links from before a server could be picked: the configured one. */
  server?: string;
  /** The local person (the desktop's dev owner). */
  ownerId: string;
  /** local workspace id → the server's. */
  workspaces: Record<string, string>;
  /** local deck id → its deck on the server. */
  decks: Record<string, DeckLink>;
}

const cloudWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
});

const cloudDeckSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  fileName: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string(),
  currentRevisionId: z.string().nullable().optional(),
  import: z.object({ status: z.string() }),
  permissions: z.object({ canManage: z.boolean() }),
  template: z.unknown().nullable().optional(),
});
type CloudDeck = z.infer<typeof cloudDeckSchema>;

const editResultSchema = z.object({ seq: z.number(), dropped: z.number().default(0) });

class Offline extends Error {}
class SignedOut extends Error {}
class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The server's session cookie: `__Host-` on https, as its own cookies (auth/cookies.ts). */
export const sessionCookie = (server: string, token: string) =>
  `${server.startsWith('https://') ? '__Host-' : ''}slider_session=${token}`;

/** A file name ending in what the bytes are. */
const nameFor = (fileName: string, bytes: Uint8Array) =>
  `${fileName.replace(/\.[^./]+$/, '') || 'Präsentation'}.${deckFileExtension(bytes)}`;

/**
 * A step the server can take as it is: the editor's operations, nothing uploaded only here
 * (`imageId`, a picture fill's own `src`) – those exist on this machine alone.
 */
const replayable = (step: { source: string; operations: unknown[] }) => {
  if (step.source !== 'editor' || step.operations.length === 0) return false;
  const json = JSON.stringify(step.operations);
  return !/"imageId":"/.test(json) && !/"src":"(?!Pictures\/)/.test(json);
};

interface LocalDeck {
  id: string;
  workspaceId: string;
  title: string;
  fileName: string;
  ready: boolean;
  revisionId: string | null;
  editSeq: number;
  fileKey: string | null;
  pending: boolean;
  createdAt: Date;
}

export class CloudSync {
  /** Signed in to, or where „Anmelden“ goes: the one last signed in to, else the configured one. */
  private current: string;
  private readonly accountFile: string;
  private readonly linksFile: string;
  private running: Promise<void> | null = null;
  /** „Auf diesem Gerät behalten“ as set while signed in, over what a running pass read. */
  private readonly keeps = new Map<string, boolean>();
  private again = false;
  /**
   * Local decks whose upload found another copy's deck there: at which step and which deck there –
   * not sent again while that step is current and that deck still linked.
   */
  private readonly sameAsLinked = new Map<string, { step: string; cloudId: string }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private status: CloudSyncStatus = { state: 'idle', at: null, message: null, changedAt: null };

  constructor(private readonly deps: AppDeps) {
    this.accountFile = path.join(deps.config.dataDir, 'cloud.json');
    this.linksFile = path.join(deps.config.dataDir, 'cloud-sync.json');
    this.current = readJsonFile<StoredFile>(this.accountFile)?.server ?? this.configured;
  }

  private get configured(): string {
    return this.deps.config.cloudUrl ?? '';
  }

  // ── The session ───────────────────────────────────────────────────────────────────────────

  /** The Slider server signed in to, or where „Anmelden“ goes. */
  get server(): string {
    return this.current;
  }

  stored(): StoredAccount | null {
    const stored = readJsonFile<StoredFile>(this.accountFile);
    return stored?.server === this.current && stored.token && stored.account
      ? (stored as StoredAccount)
      : null;
  }

  token(): string | null {
    const stored = this.stored();
    return stored ? openText(stored.token, TOKEN_CONTEXT) : null;
  }

  syncStatus(): CloudSyncStatus | null {
    return this.stored() ? this.status : null;
  }

  /** Signed in: kept, and the account's holdings brought here – this machine's taken there. */
  signedIn(server: string, token: string, account: CloudAccount, ownerId: string): void {
    this.current = server;
    writeJsonFile(this.accountFile, {
      server,
      token: sealText(token, TOKEN_CONTEXT),
      account,
    } satisfies StoredAccount);
    const links = this.readLinks();
    const who = account.email ?? account.name;
    // Another account – or the same address on another server: its decks are other decks.
    if (links?.email !== who || (links.server ?? this.configured) !== server) {
      writeJsonFile(this.linksFile, {
        email: who,
        server,
        ownerId,
        workspaces: {},
        decks: {},
      } satisfies Links);
    }
    this.start();
    void this.run();
  }

  /** Signing out: the account's decks leave this machine; decks made here and kept ones stay. */
  async signOut(): Promise<string | null> {
    // What was changed here goes up first; offline it would be lost with the copies.
    if (this.stored()) {
      await this.run();
      if (this.status.state === 'offline') {
        throw new ApiError(
          409,
          'cloud_unreachable',
          `${new URL(this.server).host} ist nicht erreichbar. Änderungen hier wären verloren, bitte mit Verbindung abmelden.`,
        );
      }
    }
    const token = this.token();
    this.stop();
    this.forgetSession();
    await this.running?.catch(() => undefined);
    const links = this.readLinks();
    if (links) writeJsonFile(this.linksFile, await this.forgetCopies(links));
    this.keeps.clear();
    return token;
  }

  /**
   * The account's decks brought here (not made here): local deck id → kept after signing out.
   * Signed out: none.
   */
  cloudDecks(): Record<string, { keep: boolean }> {
    const links = this.stored() ? this.readLinks() : null;
    const decks: Record<string, { keep: boolean }> = {};
    for (const [deckId, link] of Object.entries(links?.decks ?? {})) {
      if (link.origin === 'cloud' && !link.detached) decks[deckId] = { keep: link.keep === true };
    }
    return decks;
  }

  /** Local id → the server's, for decks and workspaces on both sides (signed out: none). */
  ids(): { decks: Record<string, string>; workspaces: Record<string, string> } {
    const links = this.stored() ? this.readLinks() : null;
    const decks: Record<string, string> = {};
    for (const [deckId, link] of Object.entries(links?.decks ?? {})) {
      if (!link.detached) decks[deckId] = link.cloudId;
    }
    return { decks, workspaces: { ...(links?.workspaces ?? {}) } };
  }

  /** „Auf diesem Gerät behalten“ on or off for one of the account's decks brought here. */
  setKeep(deckId: string, keep: boolean): void {
    const links = this.stored() ? this.readLinks() : null;
    const link = links?.decks[deckId];
    if (!links || !link || link.origin !== 'cloud') throw notFound();
    // A pass running now writes the links it read before: it takes this over (`readLinks`).
    this.keeps.set(deckId, keep);
    this.writeLinks(links);
  }

  // ── Passes ────────────────────────────────────────────────────────────────────────────────

  /** Passes every few seconds while signed in (not under test: there they are asked for). */
  start(): void {
    if (this.timer || this.deps.config.env === 'test' || !this.stored()) return;
    this.timer = setInterval(() => void this.run(), EVERY_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass; asked for while one runs, another follows it. */
  run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          // Never a rejection: the timer starts passes without waiting for them.
          await this.pass().catch((error: unknown) =>
            this.deps.log.warn('desktop sync failed', error),
          );
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async pass(): Promise<void> {
    const stored = this.stored();
    // Signed in before passes existed: they start now, for the desktop's one person.
    if (stored && !existsSync(this.linksFile) && this.deps.ownerId) {
      writeJsonFile(this.linksFile, {
        email: stored.account.email ?? stored.account.name,
        server: stored.server,
        ownerId: this.deps.ownerId,
        workspaces: {},
        decks: {},
      } satisfies Links);
    }
    const links = this.readLinks();
    if (!stored || !links) return;
    this.status = { ...this.status, state: 'syncing' };
    const problems: string[] = [];
    try {
      await this.syncWorkspaces(links);
      await this.syncDecks(links, problems);
      this.status = {
        ...this.status,
        state: problems.length > 0 ? 'error' : 'idle',
        at: this.deps.clock.now().toISOString(),
        message: problems[0] ?? null,
      };
    } catch (error) {
      if (error instanceof Offline) {
        this.status = { ...this.status, state: 'offline', message: null };
      } else if (error instanceof SignedOut) {
        // The server no longer knows the session (signed out there, expired): signed out here
        // too. The copies stay – signing in again carries on with them.
        this.forgetSession();
        this.stop();
        this.status = { ...this.status, state: 'idle', message: null };
      } else {
        this.deps.log.warn('desktop sync failed', error);
        this.status = {
          ...this.status,
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    } finally {
      this.writeLinks(links);
    }
  }

  private changed(): void {
    this.status = { ...this.status, changedAt: this.deps.clock.now().toISOString() };
  }

  // ── Workspaces ────────────────────────────────────────────────────────────────────────────

  private localWorkspaces(ownerId: string) {
    return this.deps.db
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .innerJoin(
        workspaceMembers,
        and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, ownerId)),
      )
      .orderBy(asc(workspaceMembers.createdAt));
  }

  private async syncWorkspaces(links: Links): Promise<void> {
    const cloud = z.array(cloudWorkspaceSchema).parse(await this.json('GET', '/workspaces'));
    const local = await this.localWorkspaces(links.ownerId);
    const cloudById = new Map(cloud.map((w) => [w.id, w]));
    const localIds = new Set(local.map((w) => w.id));

    for (const [localId, cloudId] of Object.entries(links.workspaces)) {
      if (!localIds.has(localId)) {
        // Deleted here: deleted there – refused (not an admin), it comes back next time.
        await this.request('DELETE', `/workspaces/${cloudId}`);
        delete links.workspaces[localId];
      } else if (!cloudById.has(cloudId)) {
        // Deleted there, or left: its copies go.
        await this.dropLocalWorkspace(links, localId);
        delete links.workspaces[localId];
        this.changed();
      } else {
        const name = cloudById.get(cloudId)?.name;
        const here = local.find((w) => w.id === localId);
        if (name && here && here.name !== name) {
          await this.deps.db.update(workspaces).set({ name }).where(eq(workspaces.id, localId));
          this.changed();
        }
      }
    }

    const linkedCloud = () => new Set(Object.values(links.workspaces));
    const writable = (w: { id: string; role: string }) =>
      w.role !== 'viewer' && !linkedCloud().has(w.id);
    for (const w of local) {
      if (links.workspaces[w.id]) continue;
      // The same name, or this machine's own first workspace into the account's: one holding.
      let target =
        cloud.find((c) => writable(c) && c.name === w.name) ??
        (w.name === PERSONAL_WORKSPACE_NAME ? cloud.find(writable) : undefined);
      if (!target) {
        const response = await this.request('POST', '/workspaces', { json: { name: w.name } });
        if (response.ok) {
          target = cloudWorkspaceSchema.parse(await response.json());
          cloud.push(target);
          cloudById.set(target.id, target);
        } else {
          // Not allowed another (the plan): into one of the account's.
          target = cloud.find(writable);
        }
      }
      if (target) {
        links.workspaces[w.id] = target.id;
        this.writeLinks(links);
        continue;
      }
      // Every workspace of the account is taken: the decks move to the first one's copy.
      const into = Object.entries(links.workspaces).find(([, cloudId]) => {
        const role = cloudById.get(cloudId)?.role;
        return role !== undefined && role !== 'viewer';
      })?.[0];
      if (into) {
        await this.deps.db
          .update(decks)
          .set({ workspaceId: into })
          .where(eq(decks.workspaceId, w.id));
        this.changed();
      }
    }

    const linkedNow = linkedCloud();
    for (const c of cloud) {
      if (linkedNow.has(c.id)) continue;
      const row = await createWorkspace(this.deps.db, links.ownerId, c.name, this.deps.clock.now());
      links.workspaces[row.id] = c.id;
      this.writeLinks(links);
      this.changed();
    }
  }

  /**
   * A workspace gone on the server: its copies go. Decks made here and kept ones stay – moved
   * into another workspace of the account here (they go up there), else left where they are.
   */
  private async dropLocalWorkspace(links: Links, localId: string): Promise<void> {
    const other = Object.keys(links.workspaces).find((id) => id !== localId);
    for (const [deckId, link] of Object.entries(links.decks)) {
      if (link.workspaceId !== localId) continue;
      delete links.decks[deckId];
      if (staysHere(link)) {
        if (other) {
          await this.deps.db
            .update(decks)
            .set({ workspaceId: other, folderId: null })
            .where(eq(decks.id, deckId));
        }
        continue;
      }
      await deleteDeck(this.deps, deckId);
    }
    const [left] = await this.deps.db
      .select({ n: count() })
      .from(decks)
      .where(eq(decks.workspaceId, localId));
    if ((left?.n ?? 0) === 0) await purgeWorkspace(this.deps, localId);
  }

  // ── Decks ─────────────────────────────────────────────────────────────────────────────────

  private async localDecks(workspaceIds: string[]): Promise<Map<string, LocalDeck>> {
    if (workspaceIds.length === 0) return new Map();
    const rows = await this.deps.db
      .select({
        id: decks.id,
        workspaceId: decks.workspaceId,
        title: decks.title,
        fileName: decks.fileName,
        importState: decks.importState,
        revisionId: decks.currentRevisionId,
        editSeq: revisions.editSeq,
        fileKey: revisions.pptxKey,
        createdAt: decks.createdAt,
      })
      .from(decks)
      .leftJoin(revisions, eq(revisions.id, decks.currentRevisionId))
      .where(and(inArray(decks.workspaceId, workspaceIds), eq(decks.isTemplate, false)));
    const pending = new Set(
      (
        await this.deps.db
          .select({ deckId: revisions.deckId })
          .from(revisions)
          .innerJoin(decks, eq(decks.id, revisions.deckId))
          .where(and(inArray(decks.workspaceId, workspaceIds), eq(revisions.status, 'pending')))
      ).map((row) => row.deckId),
    );
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          workspaceId: row.workspaceId,
          title: row.title,
          fileName: row.fileName,
          ready: row.importState.status === 'ready',
          revisionId: row.revisionId,
          editSeq: row.editSeq ?? 0,
          fileKey: row.fileKey ?? null,
          pending: pending.has(row.id),
          createdAt: row.createdAt,
        },
      ]),
    );
  }

  private async syncDecks(links: Links, problems: string[]): Promise<void> {
    const cloudToLocal = new Map(Object.entries(links.workspaces).map(([l, c]) => [c, l]));
    const cloudAll = new Map(
      z
        .array(cloudDeckSchema)
        .parse(await this.json('GET', '/decks'))
        .filter((d) => cloudToLocal.has(d.workspaceId))
        .map((d) => [d.id, d]),
    );
    const local = await this.localDecks(Object.keys(links.workspaces));
    const attempt = async (what: string, work: () => Promise<void>) => {
      try {
        await work();
      } catch (error) {
        if (error instanceof Offline || error instanceof SignedOut) throw error;
        this.deps.log.warn(`desktop sync: ${what}`, error);
        problems.push(error instanceof Error ? error.message : String(error));
      } finally {
        this.writeLinks(links);
      }
    };

    for (const [localId, link] of Object.entries(links.decks)) {
      const here = local.get(localId);
      const there = cloudAll.get(link.cloudId);
      if (here) link.workspaceId = here.workspaceId;
      if (!link.origin && here && there?.createdAt) {
        // The copy is younger than the server's deck: it was brought here.
        link.origin = here.createdAt > new Date(there.createdAt) ? 'cloud' : 'local';
      }
      if (link.detached) {
        // Kept through a sign-out: deleted on one side meanwhile deletes nothing on the other –
        // what is left here is this machine's own and goes up as a new deck.
        if (!here || !there) {
          delete links.decks[localId];
          continue;
        }
        delete link.detached;
      }
      if (!here && !there) {
        delete links.decks[localId];
      } else if (!here) {
        await attempt('delete on the server', async () => {
          await this.request('DELETE', `/decks/${link.cloudId}`);
          delete links.decks[localId];
        });
      } else if (!there) {
        await attempt('delete here', async () => {
          await deleteDeck(this.deps, localId);
          delete links.decks[localId];
          this.changed();
        });
      } else {
        await attempt(there.title, async () => {
          await this.syncTitle(link, here, there);
          await this.syncDeck(link, here, there);
        });
      }
    }

    for (const here of local.values()) {
      if (links.decks[here.id] || !here.ready || here.pending || !here.fileKey) continue;
      const same = this.sameAsLinked.get(here.id);
      if (
        same?.step === `${here.revisionId}:${here.editSeq}` &&
        Object.values(links.decks).some((link) => link.cloudId === same.cloudId)
      ) {
        continue;
      }
      const cloudWorkspace = links.workspaces[here.workspaceId];
      if (!cloudWorkspace) continue;
      await attempt(here.fileName, () => this.upload(links, here, cloudWorkspace));
    }
    // After the uploads: one may have found a deck there already (the same bytes) – not brought
    // here a second time.
    const linkedCloud = new Set(Object.values(links.decks).map((link) => link.cloudId));
    for (const there of cloudAll.values()) {
      if (linkedCloud.has(there.id) || there.template) continue;
      if (!there.permissions.canManage || there.import.status !== 'ready') continue;
      const into = cloudToLocal.get(there.workspaceId);
      if (!into) continue;
      await attempt(there.title, () => this.download(links, there, into));
    }
  }

  /** A deck of this machine to the server. */
  private async upload(links: Links, here: LocalDeck, cloudWorkspace: string): Promise<void> {
    const bytes = await this.fileOf(here);
    const form = new FormData();
    form.append(
      'file',
      new File([bytes as Uint8Array<ArrayBuffer>], nameFor(here.fileName, bytes)),
    );
    form.append('workspaceId', cloudWorkspace);
    const deck = cloudDeckSchema.parse(
      await this.json('POST', `/decks/upload?workspaceId=${encodeURIComponent(cloudWorkspace)}`, {
        form,
      }),
    );
    // The server had these bytes already, as the deck of another copy here: one deck there, one
    // link – this copy stays this machine's until it differs (then it goes up as its own).
    if (Object.values(links.decks).some((link) => link.cloudId === deck.id)) {
      this.sameAsLinked.set(here.id, {
        step: `${here.revisionId}:${here.editSeq}`,
        cloudId: deck.id,
      });
      return;
    }
    this.sameAsLinked.delete(here.id);
    links.decks[here.id] = {
      workspaceId: here.workspaceId,
      cloudId: deck.id,
      localRevisionId: here.revisionId,
      localSeq: here.editSeq,
      cloudRevisionId: deck.currentRevisionId ?? null,
      cloudSeq: 0,
      cloudUpdatedAt: deck.updatedAt,
      origin: 'local',
    };
  }

  /** A deck of the account to this machine. */
  private async download(links: Links, there: CloudDeck, workspaceId: string): Promise<void> {
    const { bytes, revisionId } = await this.cloudFile(there.id);
    const seq = await this.cloudSeq(there.id);
    const deck = await createDeckFromFile(
      this.deps,
      { ownerId: links.ownerId, workspaceId },
      { fileName: nameFor(there.fileName, bytes), bytes, source: 'upload' },
    );
    await this.deps.db.update(decks).set({ title: there.title }).where(eq(decks.id, deck.id));
    links.decks[deck.id] = {
      workspaceId,
      cloudId: there.id,
      localRevisionId: deck.currentRevisionId ?? null,
      localSeq: 0,
      cloudRevisionId: revisionId,
      cloudSeq: seq,
      cloudUpdatedAt: there.updatedAt,
      origin: 'cloud',
      title: there.title,
    };
    this.changed();
  }

  /** Renamed on one side: the other follows; renamed on both, this machine's wins. */
  private async syncTitle(link: DeckLink, here: LocalDeck, there: CloudDeck): Promise<void> {
    // Before titles were kept: what the server has, so a different title here goes up.
    const agreed = link.title ?? there.title;
    if (here.title !== agreed && here.title !== there.title) {
      const response = await this.request('PATCH', `/decks/${link.cloudId}`, {
        json: { title: here.title },
      });
      if (!response.ok) throw await this.refused(response);
      link.title = here.title;
    } else if (there.title !== agreed && there.title !== here.title) {
      await this.deps.db.update(decks).set({ title: there.title }).where(eq(decks.id, here.id));
      link.title = there.title;
      this.changed();
    } else {
      link.title = here.title === there.title ? here.title : agreed;
    }
  }

  private async syncDeck(link: DeckLink, here: LocalDeck, there: CloudDeck): Promise<void> {
    // A version of either side still being made: next time.
    if (here.pending || !here.ready || there.import.status !== 'ready') return;
    if (link.pulledOver) {
      // The server's file is the copy now: nothing to send back but the steps made on it since
      // (it starts at step 0). Another revision current (the import failed, or one made here
      // since) goes up as any change here.
      if (here.revisionId === link.pulledOver) {
        link.localRevisionId = here.revisionId;
        link.localSeq = 0;
      }
      link.pulledOver = null;
    }
    if (link.pushedOver) {
      if (!there.currentRevisionId || there.currentRevisionId === link.pushedOver) return;
      link.cloudRevisionId = there.currentRevisionId;
      link.cloudSeq = await this.cloudSeq(there.id);
      link.cloudUpdatedAt = there.updatedAt;
      link.pushedOver = null;
    }

    let pull = false;
    if (here.revisionId !== link.localRevisionId || here.editSeq !== link.localSeq) {
      pull = await this.push(link, here, there);
      if (link.pushedOver) return;
    }
    if (
      pull ||
      there.updatedAt !== link.cloudUpdatedAt ||
      (there.currentRevisionId ?? null) !== link.cloudRevisionId
    ) {
      const seq = await this.cloudSeq(there.id);
      if (
        pull ||
        (there.currentRevisionId ?? null) !== link.cloudRevisionId ||
        seq !== link.cloudSeq
      ) {
        await this.pull(link, here, there, seq);
      } else {
        link.cloudUpdatedAt = there.updatedAt;
      }
    }
  }

  /**
   * This machine's steps to the server: as operations where they are plain ones, else the file as
   * a new version. Whether the server's deck now differs from the copy (someone else's step came
   * in between, something did not fit) – then it is taken in afterwards.
   */
  private async push(link: DeckLink, here: LocalDeck, there: CloudDeck): Promise<boolean> {
    if (
      here.revisionId &&
      here.revisionId === link.localRevisionId &&
      here.editSeq > link.localSeq
    ) {
      const steps = await this.deps.db
        .select()
        .from(deckEdits)
        .where(
          and(
            eq(deckEdits.revisionId, here.revisionId),
            gt(deckEdits.seq, link.localSeq),
            lte(deckEdits.seq, here.editSeq),
          ),
        )
        .orderBy(asc(deckEdits.seq));
      if (steps.length === here.editSeq - link.localSeq && steps.every(replayable)) {
        let differs = false;
        for (const step of steps) {
          const response = await this.request('POST', `/decks/${link.cloudId}/edit/operations`, {
            json: {
              operations: step.operations,
              baseSeq: link.cloudSeq,
              clientEditId: `desktop:${step.id}`,
            },
          });
          if (response.ok) {
            const result = editResultSchema.parse(await response.json());
            if (result.dropped > 0 || result.seq !== link.cloudSeq + 1) differs = true;
            link.cloudSeq = result.seq;
          } else if (response.status === 400) {
            // Nothing of it fits the deck there any more.
            differs = true;
          } else {
            throw await this.refused(response);
          }
          link.localSeq = step.seq;
        }
        return differs;
      }
    }
    const bytes = await this.fileOf(here);
    const form = new FormData();
    form.append(
      'file',
      new File([bytes as Uint8Array<ArrayBuffer>], nameFor(here.fileName, bytes)),
    );
    const result = z
      .object({ status: z.string() })
      .parse(await this.json('POST', `/decks/${link.cloudId}/revisions`, { form }));
    link.localRevisionId = here.revisionId;
    link.localSeq = here.editSeq;
    if (result.status !== 'unchanged') {
      link.pushedOver = link.cloudRevisionId ?? there.currentRevisionId ?? 'none';
    }
    return false;
  }

  /** The server's deck as it is now, taken in as a new version of the copy. */
  private async pull(
    link: DeckLink,
    here: LocalDeck,
    there: CloudDeck,
    seq: number,
  ): Promise<void> {
    const { bytes, revisionId } = await this.cloudFile(there.id);
    link.cloudRevisionId = revisionId;
    link.cloudSeq = seq;
    link.cloudUpdatedAt = there.updatedAt;
    if (sha256Hex(await this.fileOf(here)) === sha256Hex(bytes)) return;
    const result = await this.deps.sync.importUpload(here.id, bytes);
    if (result.status !== 'unchanged') {
      link.pulledOver = result.revisionId ?? null;
      this.changed();
    }
  }

  private async fileOf(here: LocalDeck): Promise<Uint8Array> {
    const bytes = here.fileKey ? await this.deps.storage.get(here.fileKey) : null;
    if (!bytes) throw new Error(`${here.fileName}: Die Datei fehlt.`);
    return bytes;
  }

  private async cloudFile(cloudId: string) {
    const response = await this.request('GET', `/decks/${cloudId}/file`);
    if (!response.ok) throw await this.refused(response);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      revisionId: response.headers.get('x-slider-revision'),
    };
  }

  /** The edit step the server's deck is at (0 for decks that cannot be edited). */
  private async cloudSeq(cloudId: string): Promise<number> {
    const response = await this.request('GET', `/decks/${cloudId}/edit`);
    if (!response.ok) return 0;
    return z.object({ seq: z.number() }).parse(await response.json()).seq;
  }

  /** The account's decks go; decks made here and kept ones stay, loosely linked. */
  private async forgetCopies(links: Links): Promise<Links> {
    const kept: Record<string, DeckLink> = {};
    for (const [deckId, link] of Object.entries(links.decks)) {
      if (staysHere(link)) {
        kept[deckId] = { ...link, detached: true };
        continue;
      }
      await deleteDeck(this.deps, deckId).catch((error: unknown) =>
        this.deps.log.warn('desktop sign-out: copy not deleted', error),
      );
    }
    for (const localId of Object.keys(links.workspaces)) {
      const [left] = await this.deps.db
        .select({ n: count() })
        .from(decks)
        .where(eq(decks.workspaceId, localId));
      if ((left?.n ?? 0) === 0) await purgeWorkspace(this.deps, localId);
    }
    await ensurePersonalWorkspace(this.deps.db, links.ownerId, this.deps.clock.now());
    this.status = { state: 'idle', at: null, message: null, changedAt: null };
    this.changed();
    // Workspaces are matched again by name: a link to one deleted here meanwhile would delete
    // the server's.
    return { ...links, workspaces: {}, decks: kept };
  }

  // ── The server ────────────────────────────────────────────────────────────────────────────

  private async request(
    method: string,
    route: string,
    body?: { json?: unknown; form?: FormData },
  ): Promise<Response> {
    const token = this.token();
    if (!token) throw new SignedOut();
    const headers: Record<string, string> = { cookie: sessionCookie(this.server, token) };
    let payload: string | FormData | undefined;
    if (body?.json !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body.json);
    } else if (body?.form) {
      payload = body.form;
    }
    let response: Response;
    try {
      response = await (this.deps.cloudFetch ?? fetch)(`${this.server}/api${route}`, {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new Offline();
    }
    if (response.status === 401) throw new SignedOut();
    return response;
  }

  private async json(
    method: string,
    route: string,
    body?: { json?: unknown; form?: FormData },
  ): Promise<unknown> {
    const response = await this.request(method, route, body);
    if (!response.ok) throw await this.refused(response);
    return response.json();
  }

  private async refused(response: Response): Promise<Refused> {
    const text = await response.text().catch(() => '');
    let message = `${new URL(this.server).host}: ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
      message = parsed.error?.message ?? parsed.message ?? message;
    } catch {
      // Not JSON: the status says it.
    }
    return new Refused(response.status, message);
  }

  // ── Files ─────────────────────────────────────────────────────────────────────────────────

  private readLinks(): Links | null {
    const links = readJsonFile<Links>(this.linksFile);
    if (links) this.withKeeps(links);
    return links;
  }

  private withKeeps(links: Links): void {
    for (const [deckId, keep] of this.keeps) {
      const link = links.decks[deckId];
      if (link) link.keep = keep;
    }
  }

  private writeLinks(links: Links): void {
    if (!existsSync(this.linksFile) && !this.stored()) return;
    this.withKeeps(links);
    writeJsonFile(this.linksFile, links);
  }

  /** Signed out: the server stays, „Anmelden“ goes there again. */
  private forgetSession(): void {
    if (this.current === this.configured) rmSync(this.accountFile, { force: true });
    else writeJsonFile(this.accountFile, { server: this.current } satisfies StoredFile);
  }
}
