import { and, asc, count, desc, eq, isNotNull, sql } from 'drizzle-orm';
import JSZip from 'jszip';
import { inflateRaw } from 'node:zlib';
import {
  WORKSPACE_FONT_MAX_BYTES,
  WORKSPACE_FONT_MAX_FACES,
  type WorkspaceFont,
  type WorkspaceFontUpload,
  type WorkspaceRole,
} from '@slider/shared';
import { deckEdits, decks, revisions, workspaceFonts, type WorkspaceFontRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest, forbidden, notFound } from '../http/errors';
import { deckFonts } from '../import/libreoffice';
import { blobKeys, fileUrl } from '../storage/blob-storage';
import { deleteBlobs, storageBlobs } from './blob-deletions';
import { FontFileError, VariableFontError, readFontFace } from './font-file';
import { assertStorageFor } from './plans';
import { requireRole } from './workspaces/roles';

/*
 * A workspace's own fonts: anyone who may edit uploads TTF or OTF files – or zips of them, as
 * font sites hand them out – and the slides of the workspace's decks are drawn in them, by
 * LibreOffice (`drawingFonts`: embedded in the file it draws, or in a font folder of its run) and
 * by the live editor (`url`). A face uploaded again replaces the one there. Only admins remove
 * them, and only once no deck of the workspace names them any more.
 */

const FONT_NAME = /\.(ttf|otf)$/i;
/** Entries of one zip looked at at most, and the bytes they may unpack to together. */
const MAX_ZIP_ENTRIES = 500;
const MAX_ZIP_BYTES = 200 * 1024 ** 2;

/** Native inflation enforces an output cap before collecting an oversized result. */
async function unpackFont(entry: JSZip.JSZipObject, budget: { left: number }): Promise<Uint8Array> {
  // JSZip keeps these compressed bytes after loadAsync; do not call entry.async(), which
  // collects unbounded output before checking a forged uncompressedSize.
  const data = (
    entry as unknown as {
      _data: {
        uncompressedSize: number;
        compressedContent: Uint8Array;
        compression: { magic: string };
      };
    }
  )._data;
  if (
    !data ||
    !(data.compressedContent instanceof Uint8Array) ||
    !Number.isSafeInteger(data.uncompressedSize) ||
    data.uncompressedSize < 0 ||
    !data.compression
  ) {
    throw new FontFileError('Die Schrift im Zip ist beschädigt.');
  }
  const cap = Math.min(WORKSPACE_FONT_MAX_BYTES, budget.left, data.uncompressedSize);
  try {
    let bytes: Uint8Array;
    if (data.compression.magic === '\x00\x00') {
      if (data.compressedContent.byteLength > cap) throw new Error('oversized stored entry');
      bytes = data.compressedContent;
    } else if (data.compression.magic === '\x08\x00') {
      bytes = await new Promise<Buffer>((resolve, reject) => {
        inflateRaw(
          data.compressedContent,
          { maxOutputLength: Math.max(1, cap) },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          },
        );
      });
    } else {
      throw new Error('unsupported compression');
    }
    if (bytes.byteLength > cap || bytes.byteLength !== data.uncompressedSize) {
      throw new Error('uncompressed size mismatch');
    }
    budget.left -= bytes.byteLength;
    return bytes;
  } catch {
    // Failed entries also spend the budget; repeated bad entries cannot keep inflating.
    budget.left -= Math.max(1, cap);
    throw new FontFileError('Die Schrift im Zip ist beschädigt oder zu groß.');
  }
}

export const toWorkspaceFont = (row: WorkspaceFontRow): WorkspaceFont => ({
  id: row.id,
  family: row.family,
  weight: row.weight === 700 ? 700 : 400,
  italic: row.italic,
  url: fileUrl(row.storageKey),
  upm: row.upm,
  ascent: row.ascent,
  descent: row.descent,
  sizeBytes: row.sizeBytes,
  sourceFile: row.sourceFile ?? null,
});

async function rowsOf(deps: Pick<AppDeps, 'db'>, workspaceId: string) {
  return deps.db
    .select()
    .from(workspaceFonts)
    .where(eq(workspaceFonts.workspaceId, workspaceId))
    .orderBy(asc(workspaceFonts.family), asc(workspaceFonts.weight), asc(workspaceFonts.italic));
}

/** The workspace's fonts, for those who may see one of its decks (the editor). */
export async function workspaceFontsOf(
  deps: Pick<AppDeps, 'db'>,
  workspaceId: string,
): Promise<WorkspaceFont[]> {
  return (await rowsOf(deps, workspaceId)).map(toWorkspaceFont);
}

/** The workspace's fonts, for its members. */
export async function listWorkspaceFonts(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceFont[]> {
  await requireRole(deps.db, workspaceId, userId);
  return (await rowsOf(deps, workspaceId)).map(toWorkspaceFont);
}

/** The fonts of the files – zips opened – with the files that were none, and why. */
async function fontFiles(files: readonly { name: string; bytes: Uint8Array }[]) {
  const found: { name: string; bytes: Uint8Array }[] = [];
  const skipped: WorkspaceFontUpload['skipped'] = [];
  // Shared across all archives and plain files in this request, including failed inflations.
  const budget = { left: MAX_ZIP_BYTES };
  let entriesLeft = MAX_ZIP_ENTRIES;
  for (const file of files) {
    if (budget.left <= 0 || entriesLeft <= 0) {
      skipped.push({
        name: file.name,
        reason: 'Der Upload enthält zu viele oder zu große Schriften.',
      });
      break;
    }
    const isZip = file.bytes[0] === 0x50 && file.bytes[1] === 0x4b;
    if (!isZip) {
      budget.left -= file.bytes.byteLength;
      entriesLeft -= 1;
      if (budget.left < 0) {
        skipped.push({ name: file.name, reason: 'Der Upload ist zu groß.' });
        break;
      }
      found.push(file);
      continue;
    }
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(file.bytes);
    } catch {
      skipped.push({ name: file.name, reason: 'Das Zip ließ sich nicht öffnen.' });
      continue;
    }
    const entries = Object.values(zip.files)
      .filter((entry) => !entry.dir && FONT_NAME.test(entry.name))
      // Finder's copies of the files beside them.
      .filter((entry) => !entry.name.startsWith('__MACOSX/') && !/(^|\/)\._/.test(entry.name))
      .slice(0, entriesLeft);
    entriesLeft -= entries.length;
    if (entries.length === 0) {
      skipped.push({ name: file.name, reason: 'Im Zip ist keine TTF- oder OTF-Schrift.' });
    }
    for (const entry of entries) {
      const name = entry.name.slice(entry.name.lastIndexOf('/') + 1);
      // The size the zip claims, before unpacking: a bomb stops here.
      const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize;
      if (declared !== undefined && declared > WORKSPACE_FONT_MAX_BYTES) {
        skipped.push({ name, reason: 'Die Schrift ist zu groß (höchstens 20 MB).' });
        continue;
      }
      if ((declared ?? 0) > budget.left || budget.left <= 0) {
        skipped.push({ name, reason: 'Das Zip ist zu groß.' });
        break;
      }
      try {
        found.push({ name, bytes: await unpackFont(entry, budget) });
      } catch (error) {
        if (!(error instanceof FontFileError)) throw error;
        skipped.push({ name, reason: error.message });
      }
    }
  }
  return { found, skipped };
}

/** Who may upload fonts – checked before the upload is read. */
export async function requireFontUploader(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceRole> {
  return requireRole(
    deps.db,
    workspaceId,
    userId,
    'member',
    'Schriften hochladen können Mitglieder und Admins.',
  );
}
/**
 * Members and admins. Takes TTF and OTF files and zips of them; a face the workspace has already
 * (same family, weight and italic) is replaced – by admins only, who alone may remove fonts. Returns the workspace's fonts now and what was no
 * font Slider takes.
 */
export async function uploadWorkspaceFonts(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  files: readonly { name: string; bytes: Uint8Array }[],
): Promise<WorkspaceFontUpload> {
  const role = await requireFontUploader(deps, userId, workspaceId);
  const { found, skipped } = await fontFiles(files);
  // One file per face: the last of an upload wins.
  const faces = new Map<string, { row: typeof workspaceFonts.$inferInsert; bytes: Uint8Array }>();
  // Variable files beside the single faces (as in Google Fonts' zips) go unmentioned.
  const variable: WorkspaceFontUpload['skipped'] = [];
  for (const file of found) {
    if (file.bytes.byteLength > WORKSPACE_FONT_MAX_BYTES) {
      skipped.push({ name: file.name, reason: 'Die Schrift ist zu groß (höchstens 20 MB).' });
      continue;
    }
    let face;
    try {
      face = readFontFace(file.bytes);
    } catch (error) {
      if (!(error instanceof FontFileError)) throw error;
      if (error instanceof VariableFontError)
        variable.push({ name: file.name, reason: error.message });
      else skipped.push({ name: file.name, reason: error.message });
      continue;
    }
    const id = crypto.randomUUID();
    faces.set(`${face.family.toLowerCase()}\n${face.weight}\n${face.italic}`, {
      bytes: file.bytes,
      row: {
        id,
        workspaceId,
        family: face.family,
        weight: face.weight,
        italic: face.italic,
        format: face.format,
        sizeBytes: file.bytes.byteLength,
        upm: face.upm,
        ascent: face.ascent,
        descent: face.descent,
        storageKey: blobKeys.workspaceFont(workspaceId, id, face.format),
        uploadedById: userId,
      },
    });
  }
  if (faces.size === 0) skipped.push(...variable);
  if (faces.size === 0) {
    if (skipped.length === 0) throw badRequest('Bitte mindestens eine Schrift mitsenden.');
    return { fonts: (await rowsOf(deps, workspaceId)).map(toWorkspaceFont), skipped };
  }

  const uploads = [...faces.values()];
  const uploadBytes = uploads.reduce((total, face) => total + face.bytes.byteLength, 0);
  // Early, before the files are stored; the binding check runs again under the workspace lock.
  await deps.db.transaction((tx) =>
    assertStorageFor(tx, deps.config, workspaceId, uploadBytes, deps.clock.now()),
  );
  const stored: string[] = [];
  let replaced: string[];
  try {
    for (const face of uploads) {
      await deps.storage.put(face.row.storageKey, face.bytes);
      stored.push(face.row.storageKey);
    }
    replaced = await deps.db.transaction(async (tx) => {
      await assertStorageFor(tx, deps.config, workspaceId, uploadBytes, deps.clock.now());
      const old: string[] = [];
      for (const { row } of uploads) {
        const same = and(
          eq(workspaceFonts.workspaceId, workspaceId),
          eq(workspaceFonts.family, row.family),
          eq(workspaceFonts.weight, row.weight),
          eq(workspaceFonts.italic, row.italic),
        );
        if (role !== 'admin') {
          const [existing] = await tx
            .select({ id: workspaceFonts.id })
            .from(workspaceFonts)
            .where(same);
          if (existing) {
            throw forbidden(
              `„${row.family}“ hat der Workspace schon. Eine vorhandene Schrift ersetzen können nur Admins.`,
            );
          }
        }
        const gone = await tx
          .delete(workspaceFonts)
          .where(same)
          .returning({ storageKey: workspaceFonts.storageKey });
        old.push(...gone.map((item) => item.storageKey));
      }
      await tx.insert(workspaceFonts).values(uploads.map((face) => face.row));
      const [total] = await tx
        .select({ n: count() })
        .from(workspaceFonts)
        .where(eq(workspaceFonts.workspaceId, workspaceId));
      if ((total?.n ?? 0) > WORKSPACE_FONT_MAX_FACES) {
        throw badRequest(
          `Ein Workspace kann höchstens ${WORKSPACE_FONT_MAX_FACES} Schriftschnitte haben.`,
        );
      }
      return old;
    });
  } catch (error) {
    // Nothing references the files – don't let them eat the storage.
    await Promise.all(stored.map((key) => deps.storage.delete(key).catch(() => undefined)));
    throw error;
  }
  // The rows are switched: a file that can't go now is retried by the hourly sweep.
  if (replaced.length > 0) await deleteBlobs(deps, storageBlobs(replaced));
  void redrawDecksNaming(
    deps,
    workspaceId,
    uploads.map((face) => face.row.family),
  ).catch((error: unknown) =>
    deps.log.warn(`Redrawing the decks of workspace ${workspaceId} in its fonts failed`, error),
  );
  return { fonts: (await rowsOf(deps, workspaceId)).map(toWorkspaceFont), skipped };
}

/** Admins only. Removes a face, or with `family` every face of that family. */
export async function deleteWorkspaceFonts(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  which: { fontId: string } | { family: string },
): Promise<WorkspaceFont[]> {
  await requireRole(
    deps.db,
    workspaceId,
    userId,
    'admin',
    'Schriften entfernen können nur Admins.',
  );
  const faces = await deps.db
    .select({ family: workspaceFonts.family })
    .from(workspaceFonts)
    .where(
      and(
        eq(workspaceFonts.workspaceId, workspaceId),
        'fontId' in which
          ? eq(workspaceFonts.id, which.fontId)
          : eq(workspaceFonts.family, which.family),
      ),
    );
  if (faces.length === 0) throw notFound('Diese Schrift gibt es nicht (mehr).');
  // Its decks would be drawn in another font: it stays while one names it.
  const family = (faces[0] as { family: string }).family;
  // One deck naming it is enough: the search stops there.
  const [using] = await decksNaming(deps, workspaceId, [family], { first: true });
  if (using) {
    throw badRequest(
      `„${family}“ nutzt noch die Review „${using.title}“ (vielleicht auch weitere). Erst wenn keine Review sie mehr nutzt, lässt sich die Schrift entfernen.`,
    );
  }
  const gone = await deps.db
    .delete(workspaceFonts)
    .where(
      and(
        eq(workspaceFonts.workspaceId, workspaceId),
        'fontId' in which
          ? eq(workspaceFonts.id, which.fontId)
          : eq(workspaceFonts.family, which.family),
      ),
    )
    .returning({ storageKey: workspaceFonts.storageKey });
  if (gone.length === 0) throw notFound('Diese Schrift gibt es nicht (mehr).');
  await deleteBlobs(deps, storageBlobs(gone.map((item) => item.storageKey)));
  return (await rowsOf(deps, workspaceId)).map(toWorkspaceFont);
}

/** Decks of a workspace looked at for new fonts at most. */
const MAX_REDRAWN = 300;

/** Deck files read at once, looking for font names. */
const FILES_AT_ONCE = 4;

/** Font names of a file (lower case), by its key – a file never changes under its key. */
const MAX_FILE_FONTS = 2000;
const fileFonts = new Map<string, Promise<Set<string>>>();

function fontsOfFile(deps: Pick<AppDeps, 'storage'>, key: string): Promise<Set<string>> {
  let fonts = fileFonts.get(key);
  if (fonts) fileFonts.delete(key);
  else {
    fonts = (async () => {
      const bytes = await deps.storage.get(key);
      if (!bytes) return new Set<string>();
      const names = await deckFonts(bytes).catch(() => []);
      return new Set(names.map((name) => name.toLowerCase()));
    })();
    fonts.catch(() => fileFonts.delete(key));
  }
  fileFonts.set(key, fonts);
  if (fileFonts.size > MAX_FILE_FONTS) fileFonts.delete(fileFonts.keys().next().value as string);
  return fonts;
}

/**
 * The workspace's decks whose current file – as last edited – names one of `families`, the
 * last changed first; with `first` only the first found (the search stops there). Each file is
 * read once, a few at a time; what it names is kept by its key.
 */
async function decksNaming(
  deps: Pick<AppDeps, 'db' | 'storage'>,
  workspaceId: string,
  families: readonly string[],
  options: { ready?: boolean; limit?: number; first?: boolean } = {},
) {
  const wanted = new Set(families.map((family) => family.toLowerCase()));
  const query = deps.db
    .select({
      deckId: decks.id,
      title: decks.title,
      status: decks.importState,
      revisionId: revisions.id,
      key: sql<string | null>`coalesce(${deckEdits.fileKey}, ${revisions.pptxKey})`,
    })
    .from(decks)
    .innerJoin(revisions, eq(revisions.id, decks.currentRevisionId))
    .leftJoin(
      deckEdits,
      and(eq(deckEdits.revisionId, revisions.id), eq(deckEdits.seq, revisions.editSeq)),
    )
    .where(
      and(
        eq(decks.workspaceId, workspaceId),
        ...(options.ready ? [eq(revisions.status, 'ready'), isNotNull(revisions.pptxKey)] : []),
      ),
    )
    .orderBy(desc(decks.updatedAt));
  const rows = options.limit ? await query.limit(options.limit) : await query;
  const naming: typeof rows = [];
  for (let at = 0; at < rows.length; at += FILES_AT_ONCE) {
    const batch = rows.slice(at, at + FILES_AT_ONCE);
    const named = await Promise.all(
      batch.map(async (row) => {
        if (!row.key) return false;
        const names = await fontsOfFile(deps, row.key);
        return [...wanted].some((family) => names.has(family));
      }),
    );
    naming.push(...batch.filter((_, i) => named[i]));
    if (options.first && naming.length > 0) return naming.slice(0, 1);
  }
  return naming;
}

/**
 * Has the workspace's decks that name one of `families` drawn again (in the background, like
 * „Neu rendern“): their slide pictures still show the font LibreOffice drew in instead.
 */
export async function redrawDecksNaming(
  deps: Pick<AppDeps, 'db' | 'storage' | 'rendering' | 'queue'>,
  workspaceId: string,
  families: readonly string[],
): Promise<void> {
  const rendering = deps.rendering;
  if (!rendering?.renderers.libreOfficePdf) return;
  const rows = await decksNaming(deps, workspaceId, families, { ready: true, limit: MAX_REDRAWN });
  for (const row of rows) {
    if (row.status.status !== 'ready' || rendering.progress.get(row.deckId)) continue;
    rendering.progress.queued(row.deckId);
    deps.queue.enqueue({ deckId: row.deckId, revisionId: row.revisionId, kind: 'rerender' });
  }
}

// ── For drawing ──────────────────────────────────────────────────────────

/** A face LibreOffice draws with: embedded in the file, or in a font folder of its run. */
export interface DrawingFontFace {
  family: string;
  weight: 400 | 700;
  italic: boolean;
  format: 'ttf' | 'otf';
  bytes: Uint8Array;
}

/** A workspace's fonts for drawing; `fingerprint` changes with them (for drawings kept). */
export interface DrawingFonts {
  /** The families it has – drawn as themselves, never replaced. */
  families: readonly { family: string }[];
  fingerprint: string;
  /** The faces of the families a file names (any case), with their files. */
  faces(named: Iterable<string>): Promise<DrawingFontFace[]>;
}

export const NO_DRAWING_FONTS: DrawingFonts = {
  families: [],
  fingerprint: '',
  faces: async () => [],
};

/**
 * Font files kept in memory, by storage key (a file never changes under its key), the last
 * used last – up to this many bytes in all.
 */
const MAX_CACHED_BYTES = 96 * 1024 ** 2;
const cache = new Map<string, Uint8Array>();
let cachedBytes = 0;

async function fontFile(
  deps: Pick<AppDeps, 'storage'>,
  storageKey: string,
): Promise<Uint8Array | null> {
  const cached = cache.get(storageKey);
  if (cached) {
    cache.delete(storageKey);
    cache.set(storageKey, cached);
    return cached;
  }
  const bytes = await deps.storage.get(storageKey);
  // Read twice at once: counted once.
  if (!bytes || cache.has(storageKey)) return bytes ?? null;
  cache.set(storageKey, bytes);
  cachedBytes += bytes.byteLength;
  for (const [key, file] of cache) {
    if (cachedBytes <= MAX_CACHED_BYTES || key === storageKey) break;
    cache.delete(key);
    cachedBytes -= file.byteLength;
  }
  return bytes;
}

/**
 * The workspace's fonts, for drawing its slides. Only the files of the families a deck names
 * are read – kept in memory a while; a font that cannot be read is left out (logged).
 */
export async function drawingFonts(
  deps: Pick<AppDeps, 'db' | 'storage' | 'log'>,
  workspaceId: string,
): Promise<DrawingFonts> {
  const rows = await rowsOf(deps, workspaceId);
  if (rows.length === 0) return NO_DRAWING_FONTS;
  return {
    families: rows.map((row) => ({ family: row.family })),
    fingerprint: rows
      .map((row) => row.id)
      .sort()
      .join(','),
    faces: async (named) => {
      const wanted = new Set([...named].map((family) => family.toLowerCase()));
      const faces: DrawingFontFace[] = [];
      for (const row of rows) {
        if (!wanted.has(row.family.toLowerCase())) continue;
        const bytes = await fontFile(deps, row.storageKey);
        if (!bytes) {
          deps.log.warn(`Font ${row.id} of workspace ${workspaceId} has no file`);
          continue;
        }
        faces.push({
          family: row.family,
          weight: row.weight === 700 ? 700 : 400,
          italic: row.italic,
          format: row.format,
          bytes,
        });
      }
      return faces;
    },
  };
}
