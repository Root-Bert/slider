/**
 * Staggered ("brick") layout of the comment cards below the active slide (Figma B1). Cards
 * alternate between two rows; a second-row card sits under the gutter between two first-row
 * cards, so its connector drops through that gutter instead of behind a card:
 *
 *   ┌──────┐      ┌──────┐      ┌──────┐
 *   │  0   │  │   │  2   │  │   │  4   │
 *   └──────┘  │   └──────┘  │   └──────┘
 *         ┌───▼──┐      ┌───▼──┐
 *         │  1   │      │  3   │
 *         └──────┘      └──────┘
 *
 * Cards that don't fit into one such band continue in another band below. Lines to those cards
 * can't cross the first band, so they run down the free margin left or right of the board and
 * turn in above their band (see `planBands`).
 */

export interface CardPlacement {
  left: number;
  top: number;
  width: number;
  /** Band index, 0 = the first band right below the connector bus rows. */
  band: number;
}

export interface CardLayout {
  cards: CardPlacement[];
  /** Total height of the layout. */
  height: number;
}

export const CARD_MAX_WIDTH = 280;
export const CARD_MIN_WIDTH = 220;
/** Gutter between first-row cards – room for the second-row card's line. */
const GUTTER = 96;
/** Narrowest gutter: still leaves 14px beside a second-row card for its line. */
const MIN_GUTTER = 80;
/** Connector entry x inside a card (next to the avatar). */
const ENTRY_X = 26;
/**
 * Room below a card for its reply bar (shown on hover, 6px below, 36px tall): a bar reaching into
 * the card below would catch the clicks meant for that card.
 */
const REPLY_BAR_ROOM = 48;
const ROW_GAP = REPLY_BAR_ROOM;
const BAND_GAP = REPLY_BAR_ROOM;
/** Room above a band for lines turning in from the margin: 12px drop, 10px per extra line. */
const JOG_DROP = 12;
const JOG_PITCH = 10;
const JOG_CLEARANCE = 20;

/** First-row cards per band: as many as fit while they stay CARD_MIN_WIDTH wide. */
const fittingPerRow = (width: number) =>
  Math.max(1, Math.floor((width + MIN_GUTTER) / (CARD_MIN_WIDTH + MIN_GUTTER)));

function grid(perRow: number, width: number) {
  // Gutters give way first (down to MIN_GUTTER), then the cards shrink.
  const gutter =
    perRow === 1
      ? GUTTER
      : Math.min(GUTTER, Math.max(MIN_GUTTER, (width - perRow * CARD_MAX_WIDTH) / (perRow - 1)));
  const cardWidth = Math.max(0, Math.min(CARD_MAX_WIDTH, (width - (perRow - 1) * gutter) / perRow));
  const firstRowLeft = (k: number) => k * (cardWidth + gutter);
  // A second-row card's entry runs down the middle of the gutter after first-row card k.
  const secondRowLeft = (k: number) => firstRowLeft(k) + cardWidth + gutter / 2 - ENTRY_X;
  const fitsSecondRow = (k: number) => secondRowLeft(k) + cardWidth <= width;
  return { cardWidth, firstRowLeft, secondRowLeft, fitsSecondRow };
}

/** Cards one band holds with `perRow` first-row cards. */
function slots(perRow: number, width: number): number {
  const { fitsSecondRow } = grid(perRow, width);
  let capacity = 0;
  for (let k = 0; k < perRow; k++) capacity += fitsSecondRow(k) ? 2 : 1;
  return capacity;
}

/** How many cards one band holds at this width when there are more cards than fit. */
export const bandCapacity = (width: number): number => slots(fittingPerRow(width), width);

/** Fewest first-row cards (widest gutters) that still fit all cards into one band, if possible. */
function perRowFor(count: number, width: number): number {
  const fitting = fittingPerRow(width);
  for (let perRow = Math.min(Math.ceil(count / 2), fitting); perRow < fitting; perRow++)
    if (slots(perRow, width) >= count) return perRow;
  return fitting;
}

export interface BandPlan {
  /** Card order for `brickLayout`: indices into the clockwise thread list. */
  order: number[];
  /** Per placed card (in `order`): the margin its line runs down, `null` in the first band. */
  margin: ('left' | 'right' | null)[];
  /** Gap between bands, tall enough for the lines turning in above a band. */
  bandGap: number;
}

/**
 * Splits `count` cards in clockwise connector order into bands of `capacity` cards. Lines to
 * cards below the first band leave the bus rows sideways and run down the margin beside the
 * board: the outermost lines of the clockwise order – the first ones (`leftCount` of them leave
 * the slide to the left) down the left margin, the last ones down the right margin. The first
 * band takes the middle of the order, deeper bands the outer lines, so no line crosses another:
 *
 *   lanes ─┬─ bus rows ─────────┬─┐
 *          │  ┌─band 0─┐ ┌────┐ │ │
 *          │  └────────┘ └────┘ │ │
 *          └──► band 1 ◄────────┘ │
 */
export function planBands(count: number, leftCount: number, capacity: number): BandPlan {
  const identity = Array.from({ length: count }, (_, i) => i);
  const overflow = count - Math.max(1, capacity);
  if (overflow <= 0)
    return { order: identity, margin: identity.map(() => null), bandGap: BAND_GAP };

  // Each margin only takes lines that leave the slide to its side: a line from the other side
  // would have to cut across that side's lanes.
  const left = Math.min(overflow, leftCount);
  const right = overflow - left;
  const prefix = identity.slice(0, left); // outermost first
  const suffix = identity.slice(count - right).reverse(); // outermost first
  const first = identity.slice(left, count - right);

  // Band sizes below the first one, filled sequentially by `brickLayout`.
  const sizes: number[] = [];
  for (let rest = overflow; rest > 0; rest -= capacity) sizes.push(Math.min(capacity, rest));
  // The deepest band takes the outermost lines of both margins.
  const bands: { indices: number[]; sides: ('left' | 'right')[] }[] = [];
  let busiest = 0;
  for (let band = sizes.length - 1; band >= 0; band--) {
    const size = sizes[band]!;
    const fromLeft =
      prefix.length + suffix.length === 0
        ? 0
        : Math.min(
            prefix.length,
            Math.round((size * prefix.length) / (prefix.length + suffix.length)),
          );
    const fromRight = Math.min(suffix.length, size - fromLeft);
    const takenLeft = prefix.splice(0, size - fromRight).sort((a, b) => a - b);
    const takenRight = suffix.splice(0, fromRight).sort((a, b) => a - b);
    busiest = Math.max(busiest, takenLeft.length, takenRight.length);
    bands[band] = {
      indices: [...takenLeft, ...takenRight],
      sides: [...takenLeft.map(() => 'left' as const), ...takenRight.map(() => 'right' as const)],
    };
  }
  return {
    order: [...first, ...bands.flatMap((band) => band.indices)],
    margin: [...first.map(() => null), ...bands.flatMap((band) => band.sides)],
    bandGap: Math.max(BAND_GAP, JOG_DROP + JOG_PITCH * (busiest - 1) + JOG_CLEARANCE),
  };
}

/**
 * Places `heights.length` cards (in connector order) into a container `width` px wide.
 * Heights are the measured card heights; positions only depend on earlier cards.
 */
export function brickLayout(
  heights: readonly number[],
  width: number,
  bandGap = BAND_GAP,
): CardLayout {
  const count = heights.length;
  if (count === 0) return { cards: [], height: 0 };

  const perRow = perRowFor(count, width);
  const { cardWidth, firstRowLeft, secondRowLeft, fitsSecondRow } = grid(perRow, width);

  const cards: CardPlacement[] = [];
  let bandTop = 0;
  let height = 0;
  let index = 0;
  for (let band = 0; index < count; band++) {
    // Interleave: first row k, second row k, first row k + 1 …
    const firstRow: { left: number; bottom: number }[] = [];
    const secondRow: { index: number; after: number }[] = [];
    for (let k = 0; k < perRow && index < count; k++) {
      cards[index] = { left: firstRowLeft(k), top: bandTop, width: cardWidth, band };
      firstRow.push({ left: firstRowLeft(k), bottom: bandTop + heights[index]! });
      height = Math.max(height, bandTop + heights[index]!);
      index++;
      if (index < count && fitsSecondRow(k)) {
        cards[index] = { left: secondRowLeft(k), top: bandTop, width: cardWidth, band };
        secondRow.push({ index, after: k });
        index++;
      }
    }
    // Second-row cards go below every first-row card they overlap horizontally.
    // (Always below the card it follows, even when nothing is to its right.)
    for (const { index: i, after } of secondRow) {
      const card = cards[i]!;
      const above = firstRow.filter(
        (row, k) =>
          k === after || (row.left < card.left + cardWidth && row.left + cardWidth > card.left),
      );
      card.top = Math.max(...above.map((row) => row.bottom)) + ROW_GAP;
      height = Math.max(height, card.top + heights[i]!);
    }
    bandTop = height + bandGap;
  }
  return { cards, height };
}
