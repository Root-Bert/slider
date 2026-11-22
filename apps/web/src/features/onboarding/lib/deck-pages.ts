import { DECK_KINDS, type DeckKind } from '@slider/shared';

/** The slides a kind suggests until a number is typed. */
export const pagesOf = (kind: DeckKind) => DECK_KINDS.find((each) => each.id === kind)?.pages ?? 10;
