import { queryKeys } from './keys';

/**
 * What a board („Material“) belongs to: a presentation or a text document. The board is the same
 * for both – its routes, query keys and uploads differ only by this.
 */
export interface BoardRef {
  kind: 'deck' | 'document';
  id: string;
}

/** A presentation's board, by the deck's id. */
export const deckBoard = (deckId: string): BoardRef => ({ kind: 'deck', id: deckId });

/** The owner's route with `rest` behind it: `/decks/:id/board`, `/documents/:id/board`. */
export const boardPath = (owner: BoardRef, rest = ''): string =>
  `/${owner.kind === 'deck' ? 'decks' : 'documents'}/${encodeURIComponent(owner.id)}${rest}`;

/**
 * The board's query keys. A presentation's are `queryKeys.board` and its siblings as ever (the
 * live stream and the creation prompt name them); a document's stand apart from the document's own
 * (`writerKeys`), so reading the text anew leaves its material alone.
 */
export const boardKeys = {
  board: (owner: BoardRef) =>
    owner.kind === 'deck'
      ? queryKeys.board(owner.id)
      : (['document-material', owner.id, 'board'] as const),
  chats: (owner: BoardRef) =>
    owner.kind === 'deck'
      ? queryKeys.materialChats(owner.id)
      : (['document-material', owner.id, 'material-chats'] as const),
};
