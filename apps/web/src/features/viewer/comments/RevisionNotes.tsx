import type { Comment } from '@slider/shared';
import { useUpdateComment } from '@/lib/api';
import { Button, cn, Icon, SegmentedControl } from '@/ui';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerToast } from '../state/viewer-toast';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

/** "In PowerPoint entfernt" (Figma F2): the comment was deleted in the file but stays here. */
export function RemovedInPowerPointNote({ className }: { className?: string }) {
  return (
    <p
      data-removed-in-pptx
      title="Dieser Kommentar wurde in der PowerPoint-Datei gelöscht. In Slider bleibt er mit allen Antworten erhalten."
      className={cn(
        'flex w-fit max-w-full items-center gap-1.5 rounded-chip bg-surface-1 px-2 py-1 text-caption leading-4 text-fg-subtle',
        className,
      )}
    >
      <Icon name="unfoldLess" size={14} className="shrink-0" />
      <span className="truncate">In PowerPoint entfernt – hier archiviert</span>
    </p>
  );
}

/**
 * "Geändert seit Kommentar": the slide changed after the comment was written – maybe it is
 * already taken care of. "Alt/Neu" shows the slide as it was when the comment was written, or
 * as it is now (BER-109); the quick action resolves the thread.
 */
export function ChangedSinceCommentNote({
  comment,
  deckId,
  canResolve,
  className,
}: {
  comment: Comment;
  deckId: string;
  canResolve: boolean;
  className?: string;
}) {
  const update = useUpdateComment(deckId);
  const showToast = useViewerToast();
  return (
    <div
      data-changed-since-comment
      className={cn(
        'relative z-(--z-raised) flex w-fit max-w-full items-center gap-1 rounded-chip py-0.5 pr-0.5 pl-2 text-caption leading-4 text-warning inset-ring inset-ring-warning/45',
        !canResolve && 'pr-2',
        className,
      )}
    >
      <Icon name="history" size={14} className="shrink-0" />
      <span className="truncate py-0.5" title="Die Folie wurde nach diesem Kommentar geändert.">
        Geändert seit Kommentar
      </span>
      {comment.slideId && <OldNewSwitch threadId={comment.id} slideId={comment.slideId} />}
      {canResolve && (
        <Button
          variant="soft"
          tone="warning"
          size="xs"
          icon="check"
          onClick={(event) => {
            event.stopPropagation();
            // Optimistic: a failure reopens the thread – say why.
            update
              .mutateAsync({ commentId: comment.id, status: 'done' })
              .catch((error: Error) => showToast(error.message, 'danger'));
          }}
          title="Als erledigt markieren"
          className="ml-1"
        >
          Erledigt
        </Button>
      )}
    </div>
  );
}

/**
 * Alt | Neu: which version of the slide the stage shows. "Alt" is the one the comment was
 * written on – one comment at a time; picking it brings the slide into view.
 */
function OldNewSwitch({ threadId, slideId }: { threadId: string; slideId: string }) {
  const { previousView } = useViewerState();
  const dispatch = useViewerDispatch();
  const registry = useStageRegistry();
  const old = previousView?.threadId === threadId;
  const pick = (version: 'old' | 'new') => {
    const showOld = version === 'old';
    if (showOld === old) return;
    dispatch({ type: 'previousViewSet', view: showOld ? { slideId, threadId } : null });
    if (showOld) registry.revealSlide(slideId, { align: 'nearest', behavior: 'smooth' });
  };
  return (
    // Clicks stay here: the note sits on a card whose surroundings react to clicks.
    <div className="ml-1 shrink-0" onClick={(event) => event.stopPropagation()}>
      <SegmentedControl
        label="Folie zeigen wie"
        size="xs"
        tone="warning"
        track="soft"
        value={old ? 'old' : 'new'}
        onChange={pick}
        segments={[
          { value: 'old', label: 'Alt', title: 'Folie so zeigen, wie sie beim Kommentar war' },
          { value: 'new', label: 'Neu', title: 'Folie so zeigen, wie sie jetzt ist' },
        ]}
      />
    </div>
  );
}
