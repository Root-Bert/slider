import { asc, eq } from 'drizzle-orm';
import { OdpDocument, OdpError } from '@slider/odp';
import type { Viewer } from '@slider/shared';
import { requireDeckAccess } from '../../auth/access';
import type { Executor } from '../../db/client';
import { revisions, slideVersions, type DeckRow, type RevisionRow } from '../../db/schema';
import type { AppDeps } from '../../deps';
import { ApiError, badRequest } from '../../http/errors';
import { isOdpKey } from '../../import/odp-deck';

/*
 * The deck being edited and its file: who may, whether it can be edited now, and reading the
 * file of its current revision – the working copy every step writes anew.
 */

/** A deck that cannot be edited now: not the request's fault, the deck's state. */
export const notEditable = (message: string) => new ApiError(409, 'bad_request', message);

/** The deck edited and its current revision, whose file is the working copy. */
export interface EditTarget {
  deck: DeckRow;
  revision: RevisionRow;
}

/** Why the deck cannot be edited now, or `null`. */
export function blocker(
  deps: AppDeps,
  deck: DeckRow,
  revision: RevisionRow | undefined,
): string | null {
  if (!revision || deck.importState.status !== 'ready' || revision.status !== 'ready') {
    return 'Die Präsentation wird gerade noch verarbeitet.';
  }
  if (!isOdpKey(revision.pptxKey)) {
    return 'Bearbeiten geht bisher nur bei ODP-Präsentationen (LibreOffice, Nextcloud Office).';
  }
  if (!deps.rendering?.renderers.libreOfficePdf?.pages) {
    return 'Auf diesem Server fehlt LibreOffice – ohne lassen sich Folien nicht neu zeichnen.';
  }
  return null;
}

export async function currentRevision(
  db: Executor,
  deck: DeckRow,
): Promise<RevisionRow | undefined> {
  if (!deck.currentRevisionId) return undefined;
  const [revision] = await db
    .select()
    .from(revisions)
    .where(eq(revisions.id, deck.currentRevisionId));
  return revision;
}

/** The deck to edit, for who manages it – a 409 with the reason while it cannot be edited. */
export async function editTarget(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
): Promise<EditTarget> {
  const deck = await requireDeckAccess(deps, viewer, deckId, 'own');
  const revision = await currentRevision(deps.db, deck);
  const reason = blocker(deps, deck, revision);
  if (reason || !revision)
    throw notEditable(reason ?? 'Die Präsentation lässt sich nicht bearbeiten.');
  return { deck, revision };
}

export async function readFile(
  deps: Pick<AppDeps, 'storage'>,
  key: string | null,
): Promise<Uint8Array> {
  const bytes = key ? await deps.storage.get(key) : null;
  if (!bytes) throw new ApiError(500, 'internal', 'Die Datei der Präsentation fehlt.');
  return bytes;
}

/** A stored file of the deck, open; one that cannot be read is the server's problem, a 500. */
export async function openFile(bytes: Uint8Array): Promise<OdpDocument> {
  try {
    return await OdpDocument.open(bytes);
  } catch (error) {
    if (error instanceof OdpError)
      throw new ApiError(500, 'internal', 'Die Präsentation ist nicht lesbar.');
    throw error;
  }
}

/**
 * Runs `work` on a deck's file – applying an edit, taking a step back, putting the AI's change
 * in: what does not fit the deck (an `OdpError` of an operation, whose message is written for
 * the person editing – see `@slider/odp`'s `OdpErrorCode`) is a 400 with that reason. A file
 * that cannot be read on the way gets a general one: its message is English, for the logs.
 */
export async function withFileProblems<T>(work: () => T | Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof OdpError)) throw error;
    throw badRequest(
      error.code === 'operation' ? error.message : 'Die Präsentation ist nicht lesbar.',
    );
  }
}

/** The revision's slides in file order (`position` is the file's order, hidden ones included). */
export async function slideIdsOf(db: Executor, revisionId: string): Promise<string[]> {
  const rows = await db
    .select({ slideId: slideVersions.slideId })
    .from(slideVersions)
    .where(eq(slideVersions.revisionId, revisionId))
    .orderBy(asc(slideVersions.position));
  return rows.map((row) => row.slideId);
}
