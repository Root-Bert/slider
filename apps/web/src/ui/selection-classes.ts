/** Classes of a selected item: the card's picture steps back with a ring in the selection colour. */
export const selectedCardClass = 'scale-[0.97] ring-(--selection)!';
/** …and a selected list row is tinted. */
export const selectedRowClass = 'bg-(--selection)/15! ring-1 ring-(--selection)/60';
/**
 * One item picked by a click (Cloud): it shows as the one in hand, not as a selection – a step
 * above an open folder's `surface-2` in the columns.
 */
export const highlightedRowClass = 'bg-selected!';
/** …a card picked so: its ring in the selection colour, faint, the picture as it is. */
export const highlightedCardClass = 'ring-2 ring-(--selection)/45!';
/** …and a selected comment card under the slides is outlined (its glass stays as it is). */
export const selectedOutlineClass = 'outline-2 outline-offset-2 outline-(--selection)';
/** The cards of a collection page – decks, fonts, templates – on one grid. */
export const collectionGridClass =
  'grid grid-cols-1 gap-x-14 gap-y-16 @min-[636px]:grid-cols-2 @min-[1136px]:grid-cols-3';
