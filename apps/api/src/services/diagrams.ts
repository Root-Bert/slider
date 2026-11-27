import { createHash } from 'node:crypto';
import { eq, max } from 'drizzle-orm';
import {
  applyDiagramChanges,
  cloudAccessAtLeast,
  cloudNameSchema,
  describeDiagram,
  DIAGRAM_EXTENSION,
  DIAGRAM_MIME,
  diagramSchema,
  emptyDiagram,
  mergeDiagrams,
  readDiagram,
  readDiagramChanges,
  writeDiagram,
  type AskDiagramInput,
  type CloudAccess,
  type CloudNode,
  type CreateDiagramInput,
  type Diagram,
  type DiagramAnswer,
  type DiagramFile,
  type DiagramOpened,
  type DiagramSaved,
  type SaveDiagramInput,
} from '@slider/shared';
import { advisoryXactLock } from '../db/client';
import { cloudNodes, cloudVersions, documents, type CloudNodeRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, forbidden, notFound } from '../http/errors';
import { blobKeys } from '../storage/blob-storage';
import { runToolCall } from './ai-providers';
import { deleteBlobs, storageBlobs } from './blob-deletions';
import { isDeckKey } from './cloud/blobs';
import {
  cloudContext,
  looksOnly,
  loadNode,
  nodeDto,
  recordEvent,
  storeUpload,
  toNodeDtos,
  touchRecent,
  type CloudCtx,
  type CloudDeps,
  type LoadedNode,
} from './cloud';
import { DIAGRAM_ANSWER_SYSTEM, DIAGRAM_ANSWER_TOOL } from './diagram-ai';
import { DRAFT_WINDOW_MS, type DocumentLive } from './documents';
import { workspaceAiConnection } from './integration-keys';
import { assertStorageFor } from './plans';

/*
 * Diagrams – a Cloud file of their own (`Name.diagram`): where it lies, who may open it, its
 * versions and its trash are Cloud's. Here: reading it, saving it whole (drawing on for a while
 * is one version, as typing in a document; someone else's save meanwhile is joined in box by
 * box), telling who has it open, and the AI's changes.
 */

/** The largest diagram file read: 1000 boxes and 2000 arrows are far below it. */
const MAX_DIAGRAM_FILE_BYTES = 8 * 1024 ** 2;

const diagramNotFound = () => notFound('Dieses Diagramm gibt es nicht (mehr).');
const titleOf = (name: string) => name.replace(/\.diagram$/i, '');

/** Saved meanwhile by someone else: read again and joined in (a few times at most). */
class ChangedMeanwhile extends Error {}

export const isDiagramName = (name: string) => /\.diagram$/i.test(name);

export async function loadDiagramNode(
  deps: CloudDeps,
  userId: string,
  diagramId: string,
  min: CloudAccess = 'view',
): Promise<LoadedNode> {
  const loaded = await loadNode(deps, userId, diagramId, min).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) throw diagramNotFound();
    throw error;
  });
  if (loaded.node.kind !== 'file' || loaded.node.extension !== DIAGRAM_EXTENSION) {
    throw diagramNotFound();
  }
  return loaded;
}

/** A version of the diagram read – `null` where it is not there (any more). */
async function readVersion(
  deps: CloudDeps,
  nodeId: string,
  versionId: string | null,
): Promise<{
  id: string;
  diagram: Diagram;
  sizeBytes: number;
  label: string | null;
  restored: boolean;
  number: number;
  storageKey: string;
} | null> {
  if (!versionId) return null;
  const [version] = await deps.db
    .select()
    .from(cloudVersions)
    .where(eq(cloudVersions.id, versionId));
  if (!version || version.nodeId !== nodeId || isDeckKey(version.storageKey)) return null;
  if (version.sizeBytes > MAX_DIAGRAM_FILE_BYTES) {
    throw badRequest('Dieses Diagramm ist zu groß, um es hier zu öffnen.');
  }
  const bytes = await deps.storage.get(version.storageKey);
  if (!bytes) return null;
  const diagram = readDiagram(new TextDecoder().decode(bytes));
  if (!diagram) throw badRequest('Diese Datei lässt sich nicht als Diagramm lesen.');
  return {
    id: version.id,
    diagram,
    sizeBytes: version.sizeBytes,
    label: version.label,
    restored: version.restoredFrom !== null,
    number: version.number,
    storageKey: version.storageKey,
  };
}

const placeOf = (node: CloudNode): string => {
  const location = node.location;
  if (!location) return '';
  return [location.areaName ?? 'Meine Dateien', ...location.folders.map((folder) => folder.name)]
    .filter(Boolean)
    .join(' / ');
};

async function fileDto(
  deps: CloudDeps,
  ctx: CloudCtx,
  row: CloudNodeRow,
  access: CloudAccess,
): Promise<DiagramFile> {
  const [withPlace] = await toNodeDtos(deps, ctx, [row], {
    access: () => access,
    location: true,
    trashed: Boolean(row.deletedAt),
  });
  const node = withPlace ?? (await nodeDto(deps, ctx, row, access));
  return {
    id: node.id,
    workspaceId: node.workspaceId,
    title: titleOf(node.name),
    fileName: node.name,
    place: placeOf(node),
    versionId: node.versionId,
    updatedBy: node.updatedBy,
    updatedAt: node.updatedAt,
    canEdit: node.deleted === null && cloudAccessAtLeast(node.access, 'edit'),
  };
}

// ── Reading ─────────────────────────────────────────────────────────────────

export async function openDiagram(
  deps: CloudDeps,
  userId: string,
  diagramId: string,
): Promise<DiagramOpened> {
  const { node, ctx, access } = await loadDiagramNode(deps, userId, diagramId);
  const version = await readVersion(deps, node.id, node.currentVersionId);
  await touchRecent(deps.db, userId, node.id, deps.clock.now());
  return {
    file: await fileDto(deps, ctx, node, access),
    diagram: version?.diagram ?? emptyDiagram(),
  };
}

/** The diagram as it is now, for the AI tools: the file, its node and its version. */
export async function loadDiagram(
  deps: CloudDeps,
  userId: string,
  diagramId: string,
  min: CloudAccess = 'view',
) {
  const loaded = await loadDiagramNode(deps, userId, diagramId, min);
  const version = await readVersion(deps, loaded.node.id, loaded.node.currentVersionId);
  return { ...loaded, versionId: version?.id ?? null, diagram: version?.diagram ?? emptyDiagram() };
}

// ── Making one ──────────────────────────────────────────────────────────────

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

export async function createDiagram(
  deps: CloudDeps,
  userId: string,
  input: CreateDiagramInput,
  diagram: Diagram = emptyDiagram(),
): Promise<DiagramFile> {
  const ctx = await cloudContext(deps.db, input.workspaceId, userId);
  if (!input.parentId && !input.areaId && looksOnly(ctx.role)) {
    throw forbidden('Neue Diagramme legen Mitglieder und Admins des Workspace an.');
  }
  const bytes = new TextEncoder().encode(writeDiagram(diagram));
  const result = await storeUpload(
    deps,
    userId,
    input.workspaceId,
    {
      // A title of 200 characters still fits a name of 200 with its ending; what a name may not
      // hold (a / in „Ein-/Ausgang“, a line break) becomes a dash.
      name: cloudNameSchema.parse(
        `${(input.title ?? 'Neues Diagramm')
          // eslint-disable-next-line no-control-regex
          .replace(/[\\/\u0000-\u001f\u007f]/g, '-')
          .slice(0, 199 - DIAGRAM_EXTENSION.length)
          .trim()}.${DIAGRAM_EXTENSION}`,
      ),
      keepBoth: true,
      ...(input.parentId && { parentId: input.parentId }),
      ...(input.areaId && { areaId: input.areaId }),
    },
    { data: once(bytes), size: bytes.byteLength, mimeType: DIAGRAM_MIME },
  );
  const [row] = await deps.db.select().from(cloudNodes).where(eq(cloudNodes.id, result.node.id));
  if (!row) throw diagramNotFound();
  return fileDto(deps, ctx, row, result.node.access);
}

// ── Saving ──────────────────────────────────────────────────────────────────

/**
 * The diagram written as the file's next version. Drawn on `baseVersionId`: what someone saved
 * since is joined in (`mergeDiagrams`). One person drawing on for a while makes one version
 * (`DRAFT_WINDOW_MS`, as typing in a document) – `apart` (an AI's change) always a version of its
 * own, to be taken back by itself. Who has it open hears of it.
 */
export async function saveDiagram(
  deps: CloudDeps,
  live: DocumentLive,
  userId: string,
  diagramId: string,
  input: SaveDiagramInput,
  options: { apart?: boolean } = {},
): Promise<DiagramSaved> {
  const { node } = await loadDiagramNode(deps, userId, diagramId, 'edit');
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await saveOnce(deps, live, userId, node.id, input, options);
    } catch (error) {
      if (!(error instanceof ChangedMeanwhile) || attempt >= 3) throw error;
    }
  }
}

async function saveOnce(
  deps: CloudDeps,
  live: DocumentLive,
  userId: string,
  nodeId: string,
  input: SaveDiagramInput,
  options: { apart?: boolean },
): Promise<DiagramSaved> {
  const [node] = await deps.db.select().from(cloudNodes).where(eq(cloudNodes.id, nodeId));
  if (!node || node.deletedAt) throw diagramNotFound();
  const current = await readVersion(deps, node.id, node.currentVersionId);
  let diagram = input.diagram;
  let joined = false;
  if (current && input.baseVersionId !== current.id) {
    // Someone saved meanwhile: theirs and mine joined on what I drew on – where that version is
    // gone (drawn on by them since), joined on nothing: mine wins where both differ, and nothing
    // of theirs I never had is taken for deleted by me.
    const base =
      (await readVersion(deps, node.id, input.baseVersionId))?.diagram ?? emptyDiagram();
    diagram = mergeDiagrams(base, input.diagram, current.diagram);
    joined = true;
  }
  const text = writeDiagram(diagram);
  if (current && writeDiagram(current.diagram) === text) {
    return { versionId: current.id, diagram, joined };
  }
  const bytes = new TextEncoder().encode(text);
  // Only what reads back as a diagram is kept (an AI's change or a join may go past its limits).
  if (bytes.byteLength > MAX_DIAGRAM_FILE_BYTES || !diagramSchema.safeParse(diagram).success) {
    throw badRequest('Das Diagramm ist zu groß geworden, um es zu speichern.');
  }
  const now = deps.clock.now();
  const versionId = crypto.randomUUID();
  const key = blobKeys.cloudVersion(node.workspaceId, node.id, versionId);
  await deps.storage.put(key, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  let outcome: { replaced: { id: string; storageKey: string } | null; row: CloudNodeRow };
  try {
    outcome = await deps.db.transaction(async (tx) => {
      await advisoryXactLock(tx, `document:${node.id}`);
      const [fresh] = await tx.select().from(cloudNodes).where(eq(cloudNodes.id, node.id));
      if (!fresh || fresh.deletedAt) throw diagramNotFound();
      // Against the version the node named when read – not `current`, which is null where that
      // version's file is gone (a save would never get through).
      if (fresh.currentVersionId !== node.currentVersionId) throw new ChangedMeanwhile();
      const [state] = await tx.select().from(documents).where(eq(documents.nodeId, node.id));
      // Drawing on: the version made a moment ago by the same person is replaced, not kept.
      const drawingOn =
        !options.apart &&
        current !== null &&
        state?.draftVersionId === current.id &&
        state.draftBy === userId &&
        state.draftAt !== null &&
        now.getTime() - state.draftAt.getTime() < DRAFT_WINDOW_MS &&
        current.label === null &&
        !current.restored;
      await assertStorageFor(
        tx,
        deps.config,
        node.workspaceId,
        Math.max(0, bytes.byteLength - (drawingOn ? current.sizeBytes : 0)),
        now,
      );
      let number = current?.number ?? 0;
      if (drawingOn) await tx.delete(cloudVersions).where(eq(cloudVersions.id, current.id));
      else {
        const [last] = await tx
          .select({ number: max(cloudVersions.number) })
          .from(cloudVersions)
          .where(eq(cloudVersions.nodeId, node.id));
        number = (last?.number ?? 0) + 1;
      }
      await tx.insert(cloudVersions).values({
        id: versionId,
        nodeId: node.id,
        workspaceId: node.workspaceId,
        number,
        storageKey: key,
        sizeBytes: bytes.byteLength,
        sha256,
        mimeType: DIAGRAM_MIME,
        createdBy: userId,
        createdAt: now,
      });
      const [row] = await tx
        .update(cloudNodes)
        .set({
          sizeBytes: bytes.byteLength,
          mimeType: DIAGRAM_MIME,
          currentVersionId: versionId,
          versionCount: fresh.versionCount + (drawingOn ? 0 : 1),
          thumbnail: 'none',
          updatedAt: now,
          updatedBy: userId,
        })
        .where(eq(cloudNodes.id, node.id))
        .returning();
      if (!row) throw new Error('Diagram update returned nothing');
      const draft = {
        draftVersionId: options.apart ? null : versionId,
        draftBy: userId,
        draftAt: drawingOn ? state.draftAt : now,
      };
      await tx
        .insert(documents)
        .values({ nodeId: node.id, ...draft })
        .onConflictDoUpdate({ target: documents.nodeId, set: draft });
      return { replaced: drawingOn ? current : null, row };
    });
  } catch (error) {
    await deleteBlobs(deps, storageBlobs([key]));
    throw error;
  }

  if (outcome.replaced) {
    await deleteBlobs(
      deps,
      storageBlobs([
        outcome.replaced.storageKey,
        blobKeys.cloudThumbnail(node.workspaceId, node.id, outcome.replaced.id),
        blobKeys.cloudPreview(node.workspaceId, node.id, outcome.replaced.id),
      ]),
    );
  } else {
    await recordEvent(
      deps.db,
      {
        kind: 'version',
        actorId: userId,
        node: outcome.row,
        workspaceId: node.workspaceId,
        name: outcome.row.name,
        detail: `Fassung ${outcome.row.versionCount}`,
      },
      now,
    );
  }
  live.publish(node.id, { type: 'diagram', versionId, clientId: input.clientId });
  return { versionId, diagram, joined };
}

/**
 * The AI tools' change (Cloud chat, agents, MCP): applied to the file as it is now and saved as a
 * version of its own – the editor open on it joins it in and shows it.
 */
export async function changeDiagram(
  deps: CloudDeps,
  live: DocumentLive,
  userId: string,
  diagramId: string,
  raw: { changes: unknown; tidy?: boolean; direction?: Diagram['direction'] },
): Promise<{ file: CloudNodeRow; diagram: Diagram; problems: string[]; changed: boolean }> {
  const loaded = await loadDiagram(deps, userId, diagramId, 'edit');
  const read = readDiagramChanges(raw.changes);
  const applied = applyDiagramChanges(loaded.diagram, read.changes, {
    tidy: raw.tidy,
    direction: raw.direction,
  });
  const problems = [...read.problems, ...applied.problems];
  // Nothing that could be done: no version that is the same as the one before.
  if (JSON.stringify(applied.diagram) === JSON.stringify(loaded.diagram)) {
    return { file: loaded.node, diagram: loaded.diagram, problems, changed: false };
  }
  const saved = await saveDiagram(
    deps,
    live,
    userId,
    diagramId,
    { diagram: applied.diagram, baseVersionId: loaded.versionId, clientId: 'ai' },
    { apart: true },
  );
  return { file: loaded.node, diagram: saved.diagram, problems, changed: true };
}

// ── The editor's AI ─────────────────────────────────────────────────────────

/**
 * „Was soll sich ändern?“ in the editor: the AI's changes to the diagram as it is on the screen,
 * sent back – the editor applies them as one step to undo, and saves them as anything drawn.
 */
export async function askDiagram(
  deps: AppDeps,
  userId: string,
  diagramId: string,
  input: AskDiagramInput,
): Promise<DiagramAnswer> {
  const { node } = await loadDiagramNode(deps, userId, diagramId, 'edit');
  const ai = await workspaceAiConnection(deps, node.workspaceId);
  if (ai.connection === null) throw new ApiError(409, 'ai_not_configured', ai.error);
  const picked = (input.picked ?? []).filter((id) =>
    input.diagram.nodes.some((box) => box.id === id),
  );
  const answer = (await runToolCall(deps, ai.connection, {
    system: DIAGRAM_ANSWER_SYSTEM,
    tool: DIAGRAM_ANSWER_TOOL,
    user: [
      `The diagram „${titleOf(node.name)}“ as it stands:`,
      input.diagram.nodes.length > 0 ? describeDiagram(input.diagram) : '(empty)',
      ...(picked.length > 0 ? [`Picked: ${picked.join(', ')}`] : []),
      `What is to change: ${input.prompt}`,
    ].join('\n\n'),
    maxTokens: 16_000,
    signal: AbortSignal.timeout(90_000),
    feature: 'document',
  }).catch((error: unknown) => {
    deps.log.warn(`Diagram AI for ${node.id} failed`, error);
    throw new ApiError(
      502,
      'internal',
      'Die KI ist gerade nicht erreichbar. Versuch es noch einmal.',
    );
  })) as { changes?: unknown; tidy?: unknown; direction?: unknown; note?: unknown } | null;
  const read = readDiagramChanges(answer?.changes);
  // What does not fit the diagram (a box twice, an arrow to nowhere) is left out on the screen.
  const tried = applyDiagramChanges(input.diagram, read.changes);
  if (read.changes.length === 0 && read.problems.length > 0) {
    deps.log.warn(`Diagram AI for ${node.id} wrote nothing usable: ${read.problems.join('; ')}`);
  }
  if (tried.problems.length > 0) {
    deps.log.info(`Diagram AI for ${node.id}: ${tried.problems.join('; ')}`);
  }
  return {
    changes: read.changes,
    tidy: answer?.tidy === true,
    ...(answer?.direction === 'LR' || answer?.direction === 'TB'
      ? { direction: answer.direction }
      : {}),
    note: typeof answer?.note === 'string' ? answer.note.slice(0, 500) : '',
  };
}
