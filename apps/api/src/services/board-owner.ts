import { eq, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Viewer } from '@slider/shared';
import { deckAccess, requireOwner } from '../auth/access';
import type { AppDeps } from '../deps';
import { forbidden } from '../http/errors';
import { blobKeys } from '../storage/blob-storage';
import { documentBoardRights } from './documents';

/*
 * Whose board „Material“ it is: a presentation's (the page beside its slides) or a text
 * document's (Writer). The board is one thing for both – the same tables (`deck_id` or
 * `document_id`, exactly one set), services, tools and DTOs; only who may do what, where its
 * bytes lie and who is told of a change differ, and those are decided here.
 */

export type BoardOwner = { kind: 'deck'; id: string } | { kind: 'document'; id: string };

export const deckBoard = (id: string): BoardOwner => ({ kind: 'deck', id });
export const documentBoard = (id: string): BoardOwner => ({ kind: 'document', id });

/** A board table's two owner columns. */
interface OwnedTable {
  deckId: AnyPgColumn;
  documentId: AnyPgColumn;
}

/** The rows of `table` that lie on the owner's board. */
export const ownedBy = (table: OwnedTable, owner: BoardOwner): SQL =>
  owner.kind === 'deck' ? eq(table.deckId, owner.id) : eq(table.documentId, owner.id);

/** The owner columns of a new row. */
export const ownerColumns = (owner: BoardOwner) =>
  owner.kind === 'deck'
    ? { deckId: owner.id, documentId: null }
    : { deckId: null, documentId: owner.id };

interface OwnedRow {
  deckId: string | null;
  documentId: string | null;
}

/** Whose board a row lies on (the database keeps exactly one of the two set). */
export function ownerOf(row: OwnedRow): BoardOwner {
  if (row.deckId) return deckBoard(row.deckId);
  if (row.documentId) return documentBoard(row.documentId);
  throw new Error('A board row without an owner');
}

export const isOn = (row: OwnedRow, owner: BoardOwner): boolean =>
  (owner.kind === 'deck' ? row.deckId : row.documentId) === owner.id;

/** Where a file of the board lies in the media store – under its owner's prefix. */
export const materialKey = (owner: BoardOwner, name: string) =>
  owner.kind === 'deck'
    ? blobKeys.material(owner.id, name)
    : blobKeys.documentMaterial(owner.id, name);
export const materialPreviewKey = (owner: BoardOwner, materialId: string) =>
  owner.kind === 'deck'
    ? blobKeys.materialPreview(owner.id, materialId)
    : blobKeys.documentMaterialPreview(owner.id, materialId);

/** What a person may do on a board, and what the services need of its owner. */
export interface BoardAccess {
  owner: BoardOwner;
  workspaceId: string;
  /** The deck's or the document's title, for prompts. */
  title: string;
  /** Puts things down, moves them, deletes their own, asks the AI. */
  canComment: boolean;
  /** Deletes anyone's. */
  canManage: boolean;
}

/**
 * The board the viewer may act on, or throws – a deck's as {@link deckAccess} decides (who sees
 * the deck sees its board, who may comment puts things down), a document's as its comments
 * (`documentBoardRights`: who may open it sees the board, Prüfende and up put things down;
 * signed-in members only). 404 when it is not theirs to see, 403 without the right.
 */
export async function requireBoardAccess(
  deps: AppDeps,
  viewer: Viewer,
  owner: BoardOwner,
  right: 'view' | 'comment',
): Promise<BoardAccess> {
  if (owner.kind === 'deck') {
    const { deck, permissions } = await deckAccess(deps, viewer, owner.id, right);
    return {
      owner,
      workspaceId: deck.workspaceId,
      title: deck.title,
      canComment: permissions.canComment,
      canManage: permissions.canManage,
    };
  }
  requireOwner(viewer);
  const rights = await documentBoardRights(deps, viewer.author.id, owner.id);
  if (right === 'comment' && !rights.canComment) {
    throw forbidden('Material ablegen können hier Prüfende, Mitglieder und Admins.');
  }
  return { owner, ...rights };
}

/**
 * Something on the board came, moved, changed or went – or a file's text was read: a deck's
 * people are told over the deck's live stream (`LiveHub.boardChanged`), a document's over the
 * document's (`DocumentLive`, event `{ type: 'board' }`).
 */
export function boardChanged(
  deps: Pick<AppDeps, 'live' | 'documentLive'>,
  owner: BoardOwner,
): void {
  if (owner.kind === 'deck') deps.live?.boardChanged(owner.id);
  else deps.documentLive?.publish(owner.id, { type: 'board' });
}
