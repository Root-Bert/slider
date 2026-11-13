/*
 * Public API of the viewer for other features. The deck page itself is a lazy route
 * (`app/router.tsx` imports `DeckPage` directly), so it is not exported here.
 */
export {
  buildThreads,
  commentPreview,
  doneByAi,
  isBareDrawing,
  isRemovedInSource,
  type Thread,
} from './comments/lib/comment-selectors';
export { cssFamily, officeFontStyles, registerOfficeFonts } from './editing/live/fonts';
// The editor's outbox: installed with the app, it sends unsent edits whichever page is open.
export { editsUnsentBeforeSignOut, installEditOutbox } from './editing/edit-outbox-app';
// The last run through a deck („Letzter Durchgang“ in the deck's menu).
export { useShowRun, useShowRuns, type ShowRun } from './presentation/lib/show-runs';
export { SummaryLine, SummaryRows } from './presentation/RunSummary';
