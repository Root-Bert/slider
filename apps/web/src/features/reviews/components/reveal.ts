/**
 * A card's ⋯ menu trigger: out of the way until the card is hovered, but always reachable – it
 * shows on keyboard focus, while its menu is open, and on touch screens (no hover, and iOS
 * Safari fires no `contextmenu` on long-press), so the right click is never the only way in.
 * Put the card's `group` class on the element that should count as hovered.
 */
export const REVEAL_ON_HOVER =
  'opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100 pointer-coarse:opacity-100';
