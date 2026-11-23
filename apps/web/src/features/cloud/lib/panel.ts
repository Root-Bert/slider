/**
 * For what stands above a page's own column (`data-page-aside`: the calendar's, „KI zur Mail“) –
 * the page's head, its tool row, the open mail's head: while a panel (`data-cloud-panel`, 400 px
 * at the right) lies over that column, the page itself keeps its width (`CloudLayout`), so these
 * give way to it themselves, as far as the whole page does elsewhere.
 */
export const GIVE_WAY_TO_PANEL =
  'transition-[margin] duration-300 ease-out md:[body:has([data-cloud-panel]):has([data-page-aside])_&]:mr-[400px]';
