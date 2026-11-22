import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { ODP_MIME } from '@slider/odp';
import type { DeckAccess, UpdateDeckAccessInput, Viewer } from '@slider/shared';
import type { Executor } from '../db/client';
import {
  cloudAreaMembers,
  cloudAreas,
  cloudNodes,
  cloudShares,
  deckFolders,
  decks,
  instanceSettings,
  users,
  workspaceMembers,
  type CloudNodeRow,
  type DeckRow,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest } from '../http/errors';
import { requireDeckAccess } from '../auth/access';
import { userViewer } from '../auth/viewer';
import {
  cloudContext,
  createFolder,
  createShare,
  moveNodes,
  removeShare,
  storeUpload,
} from './cloud';
import { standAlone } from './cloud/files';
import { descendantsOf, findByName, resolveTarget, siblingsIn } from './cloud/tree';
import { sha256Hex } from '../import/common';
import { getDeckAccess, updateDeckAccess } from './deck-access';
import { editedFile, fileBase } from './edits/state';
import { currentRevision, readFile } from './edits/target';

/**
 * A presentation's place in Cloud: the file that stands for it in a folder there
 * (`decks.cloudNodeId`). There is no place of presentations' own – they lie where one works, and
 * Cloud's folders are the only ones. Where the file lies says who sees the presentation:
 *
 * - one's own files: its owner alone („Zugriff einschränken“ with nobody on the list – the
 *   admins stay, as there),
 * - an area for chosen people: those people,
 * - an area of the workspace: the workspace.
 *
 * Without a place nothing changes. The file holds no bytes of its own: it points at the
 * presentation's file and follows it (`cloud/files.ts` `followDeckFile`) – there is one of it.
 */

type Deps = Pick<AppDeps, 'db' | 'clock' | 'live' | 'storage' | 'log'>;

/** The presentation whose file `nodeId` is. */
export async function deckOfNode(db: Executor, nodeId: string): Promise<DeckRow | null> {
  const [deck] = await db
    .select()
    .from(decks)
    .where(and(eq(decks.cloudNodeId, nodeId), isNull(decks.deletedAt)));
  return deck ?? null;
}

/**
 * Who sees `deck` follows where its file lies. In someone else's own files it has no place any
 * more: the file is theirs now, the presentation stays its owner's and seen as it was – a file
 * taken away must not hide a presentation from the one it belongs to.
 */
export async function followPlace(
  deps: Deps,
  deck: DeckRow,
  node: CloudNodeRow,
  /**
   * Who moved the file. Someone other than the presentation's owner cannot open it to more
   * people by where they put its file: „Zugriff einschränken“ set on it stays as it is.
   */
  movedBy?: string,
): Promise<void> {
  const keepsList = movedBy !== undefined && movedBy !== deck.ownerId && deck.restrictedAt !== null;
  if (node.areaId === null && node.ownerId !== deck.ownerId) {
    await standAlone(deps, node.id);
    await deps.db.update(decks).set({ cloudNodeId: null }).where(eq(decks.id, deck.id));
    return;
  }
  if (node.areaId === null) {
    // One's own: seen by oneself and by whom the file is shared with.
    await updateDeckAccess(deps, deck, {
      restricted: true,
      userIds: await sharedWith(deps.db, node.id),
    });
    return;
  }
  const [area] = await deps.db.select().from(cloudAreas).where(eq(cloudAreas.id, node.areaId));
  if (!area) return;
  if (keepsList) return;
  if (area.visibility !== 'members') {
    if (deck.restrictedAt) await updateDeckAccess(deps, deck, { restricted: false, userIds: [] });
    return;
  }
  // The area's people who are (still) in the workspace; the owner needs no entry.
  const people = await deps.db
    .select({ userId: cloudAreaMembers.userId })
    .from(cloudAreaMembers)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.userId, cloudAreaMembers.userId),
        eq(workspaceMembers.workspaceId, deck.workspaceId),
      ),
    )
    .where(eq(cloudAreaMembers.areaId, area.id));
  await updateDeckAccess(deps, deck, {
    restricted: true,
    userIds: people.map((each) => each.userId).filter((id) => id !== deck.ownerId),
  });
}

/**
 * `node` is `deck`'s file from now on. One's own files hold one's own presentations only – a
 * file there cannot hide someone else's from its owner: then nothing is linked (`false`).
 */
export async function linkDeck(deps: Deps, deck: DeckRow, node: CloudNodeRow): Promise<boolean> {
  if (deck.cloudNodeId === node.id) return true;
  if (deck.cloudNodeId !== null || deck.workspaceId !== node.workspaceId) return false;
  if (node.areaId === null && node.ownerId !== deck.ownerId) return false;
  const [linked] = await deps.db
    .update(decks)
    .set({ cloudNodeId: node.id })
    .where(and(eq(decks.id, deck.id), isNull(decks.cloudNodeId)))
    .returning();
  if (!linked) return false;
  await followPlace(deps, linked, node);
  return true;
}

/** The presentations whose files are among `ids` or lie in the folders among them. */
async function placedAmong(db: Executor, ids: readonly string[]) {
  if (ids.length === 0) return [];
  // Trashed ones too: a folder moved carries them along, and they may come back.
  const inside = await descendantsOf(db, [...ids], { deleted: true });
  const all = [...new Set([...ids, ...inside.map((each) => each.id)])];
  const found: { deck: DeckRow; node: CloudNodeRow }[] = [];
  for (let at = 0; at < all.length; at += 500) {
    found.push(
      ...(await db
        .select({ deck: decks, node: cloudNodes })
        .from(decks)
        .innerJoin(cloudNodes, eq(cloudNodes.id, decks.cloudNodeId))
        .where(and(inArray(decks.cloudNodeId, all.slice(at, at + 500)), isNull(decks.deletedAt)))),
    );
  }
  return found;
}

/** A name without a path in it (a slash, a control character, dots at its end). */
const plainName = (name: string) =>
  [...name]
    .map((char) => (char < ' ' || char === '/' || char === '\\' ? '-' : char))
    .join('')
    .replace(/\.+$/, '') || 'Präsentation';

const placeKey = (node: CloudNodeRow) => node.areaId ?? `own:${node.ownerId}`;

/** Where the presentations among `ids` lie – read before a move, for `followMoved`. */
export async function deckPlaces(db: Executor, ids: readonly string[]) {
  return new Map((await placedAmong(db, ids)).map(({ deck, node }) => [deck.id, placeKey(node)]));
}

/**
 * Files and folders were moved (or came back from the trash): the presentations among and in
 * them are seen as there. With `before` (`deckPlaces`) only those that changed place – a move
 * within a place must not undo „Zugriff einschränken“ set by hand there.
 */
export async function followMoved(
  deps: Deps,
  moved: readonly { id: string }[],
  movedBy: string,
  before: ReadonlyMap<string, string>,
): Promise<void> {
  const rows = await placedAmong(
    deps.db,
    moved.map((each) => each.id),
  );
  for (const { deck, node } of rows) {
    if (before.get(deck.id) === placeKey(node)) continue;
    await followPlace(deps, deck, node, movedBy);
  }
}

/** An area's people or visibility changed: its presentations are seen by whom it says now. */
export async function followArea(deps: Deps, areaId: string): Promise<void> {
  const rows = await deps.db
    .select({ deck: decks, node: cloudNodes })
    .from(decks)
    .innerJoin(cloudNodes, eq(cloudNodes.id, decks.cloudNodeId))
    .where(and(eq(cloudNodes.areaId, areaId), isNull(decks.deletedAt)));
  for (const { deck, node } of rows) await followPlace(deps, deck, node);
}

/**
 * The file that stands for `deck` in Cloud: the presentation as it is now – or, while it cannot
 * be edited (still being read, not an ODP, no LibreOffice here), its stored file as it is. A
 * place needs no more than the bytes.
 */
async function fileToPlace(
  deps: AppDeps,
  viewer: Viewer,
  deck: DeckRow,
): Promise<{ bytes: Uint8Array; fileName: string; mimeType: string | null; key: string | null }> {
  if (deck.isTemplate) {
    return { ...(await editedFile(deps, viewer, deck.id)), mimeType: null, key: null };
  }
  const revision = await currentRevision(deps.db, deck);
  const bytes = await readFile(deps, revision?.pptxKey ?? null);
  const extension = /\.[a-z0-9]+$/i.exec(revision?.pptxKey ?? '')?.[0] ?? '.odp';
  return {
    bytes,
    // The presentation's own file: its file in Cloud points at it, there is no second one.
    key: revision?.pptxKey ?? null,
    // Named as the presentation is called now – what its file was called at its upload, or
    // „Neue Präsentation“ a dozen times, would tell nobody which is which.
    // A name here is 200 characters at most, its ending included.
    fileName: `${plainName(deck.title?.trim() || fileBase(deck))
      .slice(0, 190)
      .trim()}${extension}`,
    mimeType: extension === '.odp' ? ODP_MIME : null,
  };
}

/**
 * „Speicherort“: the presentation lies in that folder (or at that area's top, or one's own
 * files') from now on – its file moves there, or is made there of what the presentation is now.
 */
export async function placeDeck(
  deps: AppDeps,
  viewer: Viewer,
  deck: DeckRow,
  target: { parentId?: string | null; areaId?: string | null },
  /** `false`: who sees it is already said (`setDeckAccess`) – the place does not say it again. */
  follow = true,
): Promise<void> {
  const userId = viewer.author.id;
  const ctx = await cloudContext(deps.db, deck.workspaceId, userId);
  const where = await resolveTarget(deps, ctx, target, 'edit');
  if (where.place.areaId === null && where.place.ownerId !== deck.ownerId) {
    throw badRequest('In „Meine Dateien“ liegt nur, was dir gehört.');
  }
  const [there] = deck.cloudNodeId
    ? await deps.db
        .select()
        .from(cloudNodes)
        .where(and(eq(cloudNodes.id, deck.cloudNodeId), isNull(cloudNodes.deletedAt)))
    : [];
  let nodeId: string;
  if (there) {
    const result = await moveNodes(deps, userId, { ids: [there.id], ...target });
    const [skipped] = result.skipped;
    if (skipped) throw badRequest(skipped.reason);
    nodeId = there.id;
  } else {
    const { bytes, fileName, mimeType, key } = await fileToPlace(deps, viewer, deck);
    const { node } = await storeUpload(
      deps,
      userId,
      deck.workspaceId,
      {
        // A presentation's file name comes from an upload as it was: a file's name here must
        // not carry a path.
        name: plainName(fileName),
        keepBoth: true,
        ...(target.parentId ? { parentId: target.parentId } : {}),
        ...(target.areaId ? { areaId: target.areaId } : {}),
      },
      {
        data: (async function* () {
          yield bytes;
        })(),
        size: bytes.byteLength,
        mimeType,
        ...(key ? { held: { key, sha256: sha256Hex(bytes) } } : {}),
      },
    );
    nodeId = node.id;
    await deps.db.update(decks).set({ cloudNodeId: nodeId }).where(eq(decks.id, deck.id));
  }
  const [node] = await deps.db.select().from(cloudNodes).where(eq(cloudNodes.id, nodeId));
  if (node && follow) await followPlace(deps, { ...deck, cloudNodeId: nodeId }, node);
}

/**
 * A presentation just made lies in its maker's own files („Meine Dateien“) until they move or
 * share it – so it has a place from the start, and only they see it. Never in the way of making
 * it: what fails here is logged, the presentation stays without a place.
 */
export async function placeNew(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  /** Made from a folder or an area: it lies there at once (not moved after) – else one's own. */
  place: { parentId?: string; areaId?: string } = {},
): Promise<void> {
  try {
    const [deck] = await deps.db.select().from(decks).where(eq(decks.id, deckId));
    if (!deck || deck.cloudNodeId) return;
    const target = place.parentId
      ? { parentId: place.parentId }
      : place.areaId
        ? { areaId: place.areaId }
        : null;
    if (target) {
      try {
        return await placeDeck(deps, viewer, deck, target);
      } catch (error) {
        // Not one's to put there (any more): one's own files, as without it.
        deps.log.warn(`A new presentation could not lie where asked: ${String(error)}`);
      }
    }
    // Read anew: what got halfway there is not placed twice.
    await placeInOwn(deps, viewer, deckId);
  } catch (error) {
    deps.log.warn(`A new presentation got no place: ${String(error)}`);
  }
}

/** Into one's own files, when it has no place yet; what stands in the way is thrown. */
async function placeInOwn(deps: AppDeps, viewer: Viewer, deckId: string): Promise<void> {
  const [deck] = await deps.db.select().from(decks).where(eq(decks.id, deckId));
  if (!deck || deck.cloudNodeId) return;
  await placeDeck(deps, viewer, deck, {});
}

/**
 * What an AI is to move, named by a file's id or a presentation's: a presentation's id becomes
 * its file's, as its owner may place it („Speicherort“) – one never placed lies in its owner's
 * own files first. Any other id stays as it is.
 */
export async function fileIdsToMove(
  deps: AppDeps,
  viewer: Viewer,
  workspaceId: string,
  ids: readonly string[],
): Promise<string[]> {
  const found = await deps.db
    .select({ id: decks.id })
    .from(decks)
    .where(
      and(inArray(decks.id, [...ids]), eq(decks.workspaceId, workspaceId), isNull(decks.deletedAt)),
    );
  const presentations = new Set(found.map((each) => each.id));
  const files = [];
  for (const id of ids) {
    if (!presentations.has(id)) {
      files.push(id);
      continue;
    }
    let deck = await requireDeckAccess(deps, viewer, id, 'own');
    if (!deck.cloudNodeId) {
      await placeInOwn(deps, viewer, id);
      deck = await requireDeckAccess(deps, viewer, id, 'own');
    }
    if (!deck.cloudNodeId) throw badRequest(`„${deck.title}“ hat keine Datei in Cloud.`);
    files.push(deck.cloudNodeId);
  }
  return [...new Set(files)];
}

/** The people a file is shared with by name (not by link, not through a folder above it). */
async function sharedWith(db: Executor, nodeId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: cloudShares.userId })
    .from(cloudShares)
    .where(and(eq(cloudShares.nodeId, nodeId), eq(cloudShares.kind, 'user')));
  return rows.flatMap((row) => (row.userId ? [row.userId] : []));
}

/**
 * A file in one's own files was shared with someone, or no longer is: when it stands for a
 * presentation, that one is open to exactly those people.
 */
export async function followShares(deps: Deps, nodeId: string): Promise<void> {
  const [node] = await deps.db.select().from(cloudNodes).where(eq(cloudNodes.id, nodeId));
  if (!node || node.areaId !== null) return;
  const deck = await deckOfNode(deps.db, nodeId);
  if (!deck || deck.ownerId !== node.ownerId) return;
  await updateDeckAccess(deps, deck, {
    restricted: true,
    userIds: await sharedWith(deps.db, nodeId),
  });
}

/**
 * „Zugriff einschränken“ in Slider: who sees the presentation – and, said by its owner, where it
 * lies from then on, so both always tell the same:
 *
 * - everyone in the workspace: in the workspace's own area, unless it lies in one open to it,
 * - only oneself: in one's own files,
 * - chosen people: in one's own files, shared with them – they find it under „Geteilt“ – unless
 *   it lies in an area for exactly those people.
 *
 * Said by an admin for someone else's presentation: opened, only the access changes; restricted,
 * its file goes to its owner's own files as if they had said it – nobody else sees it there.
 */
export async function setDeckAccess(
  deps: AppDeps,
  viewer: Viewer,
  deck: DeckRow,
  input: UpdateDeckAccessInput,
): Promise<DeckAccess> {
  const access = await updateDeckAccess(deps, deck, input);
  let as: Viewer | null = viewer;
  if (viewer.author.id !== deck.ownerId) {
    // Opened by an admin, it stays where its owner put it. Restricted by one, its file must not
    // stay readable where everyone finds it: it goes where its owner would have put it.
    if (!access.restricted || !deck.ownerId) return access;
    const [owner] = await deps.db.select().from(users).where(eq(users.id, deck.ownerId));
    as = owner ? userViewer(owner) : null;
  }
  if (!as) return access;
  try {
    await placeByAccess(deps, as, deck, access);
  } catch (error) {
    deps.log.warn(`A presentation's place did not follow its access: ${String(error)}`);
  }
  return access;
}

async function placeByAccess(
  deps: AppDeps,
  viewer: Viewer,
  deck: DeckRow,
  access: DeckAccess,
): Promise<void> {
  const userId = viewer.author.id;
  const [node] = deck.cloudNodeId
    ? await deps.db
        .select()
        .from(cloudNodes)
        .where(and(eq(cloudNodes.id, deck.cloudNodeId), isNull(cloudNodes.deletedAt)))
    : [];
  const [area] = node?.areaId
    ? await deps.db.select().from(cloudAreas).where(eq(cloudAreas.id, node.areaId))
    : [];
  if (!access.restricted) {
    if (area && area.visibility !== 'members') return;
    const ctx = await cloudContext(deps.db, deck.workspaceId, userId);
    const root = [...ctx.areas.values()].find((each) => each.row.root);
    if (root) await placeDeck(deps, viewer, deck, { areaId: root.row.id }, false);
    return;
  }
  if (area?.visibility === 'members') {
    // An area for exactly these people says the same already.
    const people = await deps.db
      .select({ userId: cloudAreaMembers.userId })
      .from(cloudAreaMembers)
      .where(eq(cloudAreaMembers.areaId, area.id));
    const there = new Set(people.map((each) => each.userId).filter((id) => id !== deck.ownerId));
    const wanted = new Set(access.userIds.filter((id) => id !== deck.ownerId));
    if (there.size === wanted.size && [...wanted].every((id) => there.has(id))) return;
  }
  if (!node || node.areaId !== null) await placeDeck(deps, viewer, deck, {}, false);
  const [placed] = await deps.db.select().from(decks).where(eq(decks.id, deck.id));
  const nodeId = placed?.cloudNodeId;
  if (!nodeId) return;
  await shareWith(deps, userId, nodeId, access.userIds);
}

/** The file is shared by name with exactly `userIds` (its owner needs no share). */
async function shareWith(
  deps: AppDeps,
  userId: string,
  nodeId: string,
  userIds: readonly string[],
): Promise<void> {
  const shares = await deps.db
    .select()
    .from(cloudShares)
    .where(and(eq(cloudShares.nodeId, nodeId), eq(cloudShares.kind, 'user')));
  const wanted = new Set(userIds.filter((id) => id !== userId));
  for (const share of shares) {
    if (share.userId && !wanted.has(share.userId)) await removeShare(deps, userId, share.id);
  }
  const have = new Set(shares.map((share) => share.userId));
  for (const id of wanted) {
    if (!have.has(id)) await createShare(deps, userId, nodeId, { userId: id, role: 'view' });
  }
}

/**
 * The folder called `name` at the top of that place – the one there, else a new one. `null`
 * where a file carries the name: then what was to go into it lies beside that file.
 */
async function topFolder(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  areaId: string | null,
  name: string,
): Promise<string | null> {
  const there = findByName(
    await siblingsIn(deps.db, {
      workspaceId,
      areaId,
      ownerId: areaId === null ? userId : null,
      parentId: null,
    }),
    name,
  );
  if (there) return there.kind === 'folder' ? there.id : null;
  return (await createFolder(deps, userId, workspaceId, { name, ...(areaId && { areaId }) })).id;
}

const OLDER_PLACED = 'CLOUD_OLDER_DECKS_PLACED';

/**
 * Once, at start, in the background: presentations from before they had a place in Cloud get
 * one, said by who sees them – as `placeByAccess` would –, and Slider's own folders of before
 * (`deck_folders`, no longer shown anywhere) become folders there:
 *
 * - open to the workspace: in the workspace's own area, in a folder named as theirs was,
 * - restricted: in their owner's own files, in such a folder, shared with whom they are open to.
 *
 * Nobody's access changes. One that cannot be placed (its file is not ready, its owner left and
 * it is restricted, the plan is full) stays as it is: listed in Slider, without a place.
 */
export async function placeOlderDecks(deps: AppDeps): Promise<number> {
  const [done] = await deps.db
    .select({ key: instanceSettings.key })
    .from(instanceSettings)
    .where(eq(instanceSettings.key, OLDER_PLACED));
  if (done) return 0;
  const rows = await deps.db
    .select({ deck: decks, folder: deckFolders.name })
    .from(decks)
    .leftJoin(deckFolders, eq(deckFolders.id, decks.folderId))
    .where(and(isNull(decks.cloudNodeId), isNull(decks.deletedAt), eq(decks.isTemplate, false)))
    .orderBy(asc(decks.createdAt));
  let placed = 0;
  let failed = 0;
  for (const { deck: listed, folder } of rows) {
    try {
      // As it is now, not as it was listed: the server answers meanwhile, and a presentation
      // placed, restricted or deleted since must not be placed by what was true before.
      const [deck] = await deps.db.select().from(decks).where(eq(decks.id, listed.id));
      if (!deck || deck.cloudNodeId || deck.deletedAt) continue;
      if (await placeOlder(deps, deck, folder)) placed += 1;
    } catch (error) {
      failed += 1;
      deps.log.warn(`An older presentation got no place (${listed.id}): ${String(error)}`);
    }
  }
  // Done for good only when nothing went wrong: what failed (a file not ready, storage that did
  // not answer) is tried again at the next start – only those, the others have their place.
  if (failed > 0) return placed;
  await deps.db
    .insert(instanceSettings)
    .values({ key: OLDER_PLACED, value: String(placed), updatedAt: deps.clock.now() })
    .onConflictDoNothing();
  return placed;
}

async function placeOlder(deps: AppDeps, deck: DeckRow, folder: string | null): Promise<boolean> {
  const access = await getDeckAccess(deps.db, deck);
  const members = await deps.db
    .select({ user: users, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, deck.workspaceId))
    .orderBy(asc(workspaceMembers.createdAt));
  const owner = members.find((each) => each.user.id === deck.ownerId);
  // Its owner puts it there; where they left, an admin does – into the workspace's place only.
  const admin = members.find((each) => each.role === 'admin');
  const by = access.restricted ? owner : (owner ?? admin);
  if (!by) return false;
  const viewer = userViewer(by.user);
  let areaId: string | null = null;
  if (!access.restricted) {
    const ctx = await cloudContext(deps.db, deck.workspaceId, by.user.id);
    const root = [...ctx.areas.values()].find((each) => each.row.root);
    if (!root) return false;
    areaId = root.row.id;
  }
  const place = async (as: typeof by) => {
    const parentId = folder
      ? await topFolder(deps, as.user.id, deck.workspaceId, areaId, plainName(folder))
      : null;
    await placeDeck(deps, userViewer(as.user), deck, parentId ? { parentId } : { areaId }, false);
  };
  try {
    await place(by);
  } catch (error) {
    // Someone who only reviews cannot put files into the workspace's area: an admin does it.
    if (access.restricted || !admin || admin === by) throw error;
    await place(admin);
  }
  if (access.restricted) {
    const [now] = await deps.db.select().from(decks).where(eq(decks.id, deck.id));
    if (now?.cloudNodeId) await shareWith(deps, viewer.author.id, now.cloudNodeId, access.userIds);
  }
  return true;
}
