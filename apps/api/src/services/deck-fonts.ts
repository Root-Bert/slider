import { count, eq } from 'drizzle-orm';
import { OdpDocument, isOdpBytes } from '@slider/odp';
import { WORKSPACE_FONT_MAX_BYTES, WORKSPACE_FONT_MAX_FACES, officeFontFor } from '@slider/shared';
import { workspaceFonts, type DeckRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';
import { blobKeys } from '../storage/blob-storage';
import { FontFileError, fontCovers, fontEmbedding, readFontFace } from './font-file';
import { assertStorageFor } from './plans';
import { redrawDecksNaming } from './workspace-fonts';

/*
 * Fonts an ODP brings along (LibreOffice's "embed fonts in document") become the workspace's
 * own – as if someone had uploaded them – so its decks are drawn in them everywhere: by
 * LibreOffice, in the live editor, in the font list. Only what is safe for every other deck:
 * fonts their licence lets be used like any installed font, whole (not the subset of characters
 * one document used), of a family the workspace has none of yet and Slider does not ship itself,
 * that the deck's Latin text is set in.
 * Anything else stays as before: the deck's font is drawn in a free one of its kind.
 */

/** Characters a whole Latin font has – a subset made for one document lacks some. */
const WHOLE_FONT_SAMPLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789äöüÄÖÜß';

type AdoptDeps = Pick<AppDeps, 'db' | 'storage' | 'log' | 'config' | 'clock'>;

/**
 * Takes the fonts the deck's file brings along into its workspace (see above). Returns the
 * families taken; a file that is no ODP, or brings nothing fit, changes nothing. A workspace out
 * of storage or font faces takes none – the deck is drawn as without.
 */
export async function adoptDeckFonts(
  deps: AdoptDeps,
  deck: Pick<DeckRow, 'workspaceId' | 'ownerId' | 'title'>,
  bytes: Uint8Array,
): Promise<string[]> {
  if (!isOdpBytes(bytes)) return [];
  const document = await OdpDocument.open(bytes);
  // Only fonts its Latin text is set in: LibreOffice embeds its defaults for other scripts too.
  const used = document.latinFontFamilies();
  const files = document.embeddedFontFiles().filter((file) => used.has(file.family.toLowerCase()));
  if (files.length === 0) return [];
  const { workspaceId } = deck;
  const had = new Set(
    (
      await deps.db
        .select({ family: workspaceFonts.family })
        .from(workspaceFonts)
        .where(eq(workspaceFonts.workspaceId, workspaceId))
    ).map((row) => row.family.toLowerCase()),
  );
  const faces = new Map<string, { row: typeof workspaceFonts.$inferInsert; bytes: Uint8Array }>();
  for (const file of files) {
    const family = file.family.toLowerCase();
    // Slider draws its own fonts already; a family the workspace has stays as it is.
    if (had.has(family) || officeFontFor(file.family)?.toLowerCase() === family) continue;
    const fontBytes = await document.fontFile(file.path);
    if (!fontBytes || fontBytes.byteLength > WORKSPACE_FONT_MAX_BYTES) continue;
    let face;
    try {
      face = readFontFace(fontBytes);
    } catch (error) {
      if (!(error instanceof FontFileError)) throw error;
      continue;
    }
    // Decks name it as the file declares it: a font named otherwise would never be drawn.
    if (face.family.toLowerCase() !== family) continue;
    if (fontEmbedding(fontBytes) !== 'installable') continue;
    if (!fontCovers(fontBytes, WHOLE_FONT_SAMPLE)) continue;
    const id = crypto.randomUUID();
    faces.set(`${family}\n${face.weight}\n${face.italic}`, {
      bytes: fontBytes,
      row: {
        id,
        workspaceId,
        family: face.family,
        weight: face.weight,
        italic: face.italic,
        format: face.format,
        sizeBytes: fontBytes.byteLength,
        upm: face.upm,
        ascent: face.ascent,
        descent: face.descent,
        storageKey: blobKeys.workspaceFont(workspaceId, id, face.format),
        uploadedById: deck.ownerId,
        sourceFile: deck.title,
      },
    });
  }
  const adopted = [...faces.values()];
  if (adopted.length === 0) return [];
  const addBytes = adopted.reduce((total, face) => total + face.bytes.byteLength, 0);
  const stored: string[] = [];
  let taken: string[];
  try {
    for (const face of adopted) {
      await deps.storage.put(face.row.storageKey, face.bytes);
      stored.push(face.row.storageKey);
    }
    taken = await deps.db.transaction(async (tx) => {
      await assertStorageFor(tx, deps.config, workspaceId, addBytes, deps.clock.now());
      const [total] = await tx
        .select({ n: count() })
        .from(workspaceFonts)
        .where(eq(workspaceFonts.workspaceId, workspaceId));
      if ((total?.n ?? 0) + adopted.length > WORKSPACE_FONT_MAX_FACES) return [];
      // The same deck imported twice at once: the face is there once.
      const rows = await tx
        .insert(workspaceFonts)
        .values(adopted.map((face) => face.row))
        .onConflictDoNothing()
        .returning({ storageKey: workspaceFonts.storageKey });
      return rows.map((row) => row.storageKey);
    });
  } catch (error) {
    await Promise.all(stored.map((key) => deps.storage.delete(key).catch(() => undefined)));
    // Out of storage: the deck is drawn as it would be without.
    if (error instanceof ApiError && error.code === 'plan_limit') {
      deps.log.info(`Workspace ${workspaceId} has no room for the fonts a deck brings along`);
      return [];
    }
    throw error;
  }
  const kept = new Set(taken);
  await Promise.all(
    stored
      .filter((key) => !kept.has(key))
      .map((key) => deps.storage.delete(key).catch(() => undefined)),
  );
  return [
    ...new Set(adopted.filter((face) => kept.has(face.row.storageKey)).map((f) => f.row.family)),
  ];
}

/**
 * {@link adoptDeckFonts} for the import (`SlidePagesDeps.adoptFonts`): the workspace's other
 * decks that name a family taken are drawn again in it, in the background.
 */
export const deckFontAdopter =
  (deps: AdoptDeps & Pick<AppDeps, 'rendering' | 'queue'>) =>
  async (deck: Pick<DeckRow, 'workspaceId' | 'ownerId' | 'title'>, bytes: Uint8Array) => {
    const families = await adoptDeckFonts(deps, deck, bytes);
    if (families.length === 0) return;
    void redrawDecksNaming(deps, deck.workspaceId, families).catch((error: unknown) =>
      deps.log.warn(
        `Redrawing the decks of workspace ${deck.workspaceId} in its fonts failed`,
        error,
      ),
    );
  };
