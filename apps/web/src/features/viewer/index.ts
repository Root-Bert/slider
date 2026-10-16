/*
 * Public API of the viewer for other features. The deck page itself is a lazy route
 * (`app/router.tsx` imports `DeckPage` directly), so it is not exported here.
 */
export {
  buildThreads,
  commentPreview,
  isRemovedInPowerPoint,
  type Thread,
} from './comments/lib/comment-selectors';
