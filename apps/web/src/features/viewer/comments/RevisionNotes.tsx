import type { CommentSource } from '@slider/shared';
import { cn, Icon } from '@/ui';
import { removedInSourceLabel, sourceApp } from './lib/labels';

/**
 * "In PowerPoint entfernt" (Figma F2): the comment was deleted in the file – or in Google Slides
 * (BER-157) – but stays here.
 */
export function RemovedInSourceNote({
  source,
  className,
}: {
  source: CommentSource;
  className?: string;
}) {
  return (
    <p
      data-removed-in-source
      title={`Dieser Kommentar wurde in ${sourceApp(source) ?? 'der Quelle'} gelöscht. In Slider bleibt er mit allen Antworten erhalten.`}
      className={cn(
        'flex w-fit max-w-full items-center gap-1.5 rounded-chip bg-surface-1 px-2 py-1 text-caption leading-4 text-fg-subtle',
        className,
      )}
    >
      <Icon name="unfoldLess" size={14} className="shrink-0" />
      <span className="truncate">{removedInSourceLabel(source)} – hier archiviert</span>
    </p>
  );
}
