import type { Author, BoardItem } from '@slider/shared';
import { createContext, use } from 'react';
import type { BoardRef } from '@/lib/api';
import type { ShowToast } from '@/ui';

/*
 * Who the board („Material“) belongs to and what its page needs from the page around it: a
 * presentation (`DeckBoardOwner`, from the viewer's stores) or a text document (Writer's
 * `DocumentMaterial`). Everything in `board/` reads this – never the viewer's own stores – so the
 * same board, with its outbox, uploads, questions and chat, lies beside either.
 */
export interface BoardOwner extends BoardRef {
  /** Where files put on what is written here go up (`useAttachments`). */
  workspaceId: string;
  /** Put things down, write notes, ask the AI; without it the board is only looked at. */
  canComment: boolean;
  /** Delete what others put down. */
  canManage: boolean;
  /** Who looks at it: the author of what is put down here. */
  viewer: Author;
  aiAuthor: Author;
  /** The host page's one toast: refusals, „… gelöscht“. */
  toast: ShowToast;
  /** The material page is the one shown; `setOpen(false)` leaves it („… →“, M). */
  open: boolean;
  setOpen: (open: boolean) => void;
  /** One of the board's side panels is open – Esc on the host's page closes it first. */
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  /** A presentation's template has no material: its page is never there. */
  template?: boolean;
  wording: BoardWording;
}

/** The host named in the board's own words. */
export interface BoardWording {
  /** The button back, right in the board's controls. */
  thing: 'Präsentation' | 'Dokument';
  /** Its label and tooltip (with the key). */
  leave: string;
  /** The empty board's hint, for those who may put things down. */
  hint: string;
  /** The chat's starter that asks for an outline. */
  outline: string;
}

export const DECK_WORDING: BoardWording = {
  thing: 'Präsentation',
  leave: 'Zur Präsentation',
  hint: 'Dateien, Bilder und Links für diese Präsentation hierher ziehen oder einfügen, mit einem Rahmen eine Notiz schreiben',
  outline: 'Schreib eine Gliederung für die Präsentation als Notiz',
};

export const DOCUMENT_WORDING: BoardWording = {
  thing: 'Dokument',
  leave: 'Zum Dokument',
  hint: 'Dateien, Bilder und Links für dieses Dokument hierher ziehen oder einfügen, mit einem Rahmen eine Notiz schreiben',
  outline: 'Schreib eine Gliederung für das Dokument als Notiz',
};

export const BoardOwnerContext = createContext<BoardOwner | null>(null);

export function useBoardOwner(): BoardOwner {
  const owner = use(BoardOwnerContext);
  if (!owner) throw new Error('useBoardOwner outside of a board owner');
  return owner;
}

/** The owner's ids as the board's things carry them: the deck's or the document's, one of them. */
type OwnerIds = Pick<BoardItem, Extract<keyof BoardItem, 'deckId' | 'documentId'>>;

/** For a thing made here (a note not sent yet, a file on its way). */
export const ownerIds = (owner: BoardRef) =>
  ({
    deckId: owner.kind === 'deck' ? owner.id : null,
    documentId: owner.kind === 'document' ? owner.id : null,
  }) as unknown as OwnerIds;

/** Whether a thing of the board is this owner's. */
export const ownedBy = (
  thing: { deckId?: string | null; documentId?: string | null },
  owner: BoardRef,
) => (owner.kind === 'deck' ? thing.deckId : thing.documentId) === owner.id;
