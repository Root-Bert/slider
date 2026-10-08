import type { Comment } from '@slider/shared';
import { useUpdateComment } from '@/lib/queries';
import { cn, Icon } from '@/ui';

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
 * already taken care of. The quick action resolves the thread.
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
