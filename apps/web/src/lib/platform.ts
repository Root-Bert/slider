export const isApplePlatform = () => /Mac|iPhone|iPad/.test(navigator.userAgent);

/** The searches' keys as the hint in their field says them (`isSearchKey`). */
export const searchKeyLabel = (search: 'page' | 'main') =>
  isApplePlatform()
    ? search === 'main'
      ? '⇧⌘F'
      : '⌘F'
    : search === 'main'
      ? 'Strg ⇧ F'
      : 'Strg F';
