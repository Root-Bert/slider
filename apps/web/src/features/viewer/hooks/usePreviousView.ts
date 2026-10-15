import type { SlideVersionView } from '@slider/shared';
import { useSlideVersions } from '@/lib/queries';
import { isChangedSinceComment, versionAtComment } from '../lib/revision-changes';
import { useRevisionData } from '../state/revision-data';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';

export interface ShownPreviousView {
  slideId: string;
  threadId: string;
  /** The version the comment was written on; `undefined` while it loads. */
  version: SlideVersionView | null | undefined;
}

/**
 * "Alt" of the comment that asked for it (BER-109), as long as that still makes sense: the
 * thread is there and its slide still counts as changed since – once it is done ("Erledigt")
 * or deleted, the slide quietly shows its current version again.
 */
export function usePreviousView(): ShownPreviousView | null {
  const { previousView } = useViewerState();
  const { deck, threadById } = useViewerData();
  const { modifiedAt } = useRevisionData();
  const root = previousView ? threadById.get(previousView.threadId)?.root : undefined;
  const active =
    previousView !== null &&
    root !== undefined &&
    root.slideId === previousView.slideId &&
    isChangedSinceComment(root, modifiedAt);
  const revisionId = deck.currentRevisionId ?? null;
  const versions = useSlideVersions(deck.id, active ? previousView.slideId : null, revisionId);
  if (!active) return null;
  return {
    slideId: previousView.slideId,
    threadId: previousView.threadId,
    version: versions.data
      ? versionAtComment(versions.data, root.createdAt, revisionId)
      : undefined,
  };
}
