/** A photo search opened by hand, with photos: Tab goes into them, not round the tools or parts. */
export const photoSearchTakesTab = (event: KeyboardEvent): boolean =>
  !event.shiftKey && !!document.querySelector('[data-stock-search="typing"] [data-stock-results]');
