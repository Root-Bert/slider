import type { Comment } from '@slider/shared';
import type { MouseEvent } from 'react';
import { useUpdateComment } from '@/lib/queries';
import { cn, Icon } from '@/ui';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

/** "In PowerPoint entfernt" (Figma F2): the comment was deleted in the file but stays here. */
export function RemovedInPowerPointNote({ className }: { className?: string }) {
  return (
    <p
      data-removed-in-pptx
      title="Dieser Kommentar wurde in der PowerPoint-Datei gelöscht. In Slider bleibt er mit allen Antworten erhalten."
      className={cn(
        'flex w-fit max-w-full items-center gap-1.5 rounded-chip bg-white/[0.06] px-2 py-1 text-[11px] leading-4 text-fg-subtle',
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
  return (
    <div
      data-changed-since-comment
      className={cn(
        'relative z-10 flex w-fit max-w-full items-center gap-1 rounded-chip py-0.5 pr-0.5 pl-2 text-[11px] leading-4 text-warning shadow-[inset_0_0_0_1px_rgb(245_166_35/0.4)]',
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
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            update.mutate({ commentId: comment.id, status: 'done' });
          }}
          title="Als erledigt markieren"
          className="ml-1 inline-flex h-6 items-center gap-0.5 rounded-badge bg-warning/12 px-1.5 font-medium hover:bg-warning/20"
        >
          <Icon name="check" size={14} />
          Erledigt
        </button>
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
  const pick = (showOld: boolean) => (event: MouseEvent) => {
    event.stopPropagation();
    if (showOld === old) return;
    dispatch({ type: 'previousViewSet', view: showOld ? { slideId, threadId } : null });
    if (showOld) registry.revealSlide(slideId, { align: 'nearest', behavior: 'smooth' });
  };
  const segment = (selected: boolean) =>
    cn(
      'h-5 rounded-[5px] px-1.5 font-medium transition-colors',
      selected ? 'bg-warning text-black' : 'text-warning hover:bg-warning/15',
    );
  return (
    <span
      role="radiogroup"
      aria-label="Folie zeigen wie"
      className="ml-1 inline-flex shrink-0 items-center gap-0.5 rounded-badge bg-warning/12 p-0.5"
    >
      <button
        type="button"
        role="radio"
        aria-checked={old}
        title="Folie so zeigen, wie sie beim Kommentar war"
        onClick={pick(true)}
        className={segment(old)}
      >
        Alt
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={!old}
        title="Folie so zeigen, wie sie jetzt ist"
        onClick={pick(false)}
        className={segment(!old)}
      >
        Neu
      </button>
    </span>
  );
}
