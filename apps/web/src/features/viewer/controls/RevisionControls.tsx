import { cn, Toolbar } from '@/ui';
import { revisionNoticeText } from '../revisions/lib/revision-changes';
import { RevisionNotice } from '../revisions/RevisionNotice';
import { useRevisionData } from '../state/revision-data';

/**
 * Version pill in the controls row: after a new version arrived, a notice says what changed until
 * it is closed (`RevisionNotice`). Linked decks update themselves when synced. The change markers
 * of the latest version are switched in the tool bar.
 */
export function RevisionControls({ className }: { className?: string }) {
  const { announcement, dismissAnnouncement } = useRevisionData();

  return (
    <>
      {/* Always mounted, so the notice's text is read out when it appears. */}
      <span role="status" className="sr-only">
        {announcement
          ? revisionNoticeText(announcement.revisionNumber, announcement.summary)
          : null}
      </span>
      {announcement && (
        <Toolbar role={false} className={cn('shrink-0', className)}>
          {/* Keyed by number: a newer version restarts the notice. */}
          <RevisionNotice
            key={announcement.revisionNumber}
            announcement={announcement}
            onDone={dismissAnnouncement}
          />
        </Toolbar>
      )}
    </>
  );
}
