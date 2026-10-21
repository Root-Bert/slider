import type { SyncResult } from '@slider/shared';
import { useRef } from 'react';
import { useUploadRevision } from '@/lib/api';
import { cn, IconButton, Spinner, Toolbar } from '@/ui';
import { revisionNoticeText, syncResultMessage } from '../revisions/lib/revision-changes';
import { RevisionNotice } from '../revisions/RevisionNotice';
import { useRevisionData } from '../state/revision-data';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';

/**
 * Version pill in the controls row: after a new version arrived, a notice says what changed until
 * it is closed (`RevisionNotice`). Linked decks update themselves (polling); the upload of a new
 * version of an uploaded deck sits left, next to the filter pill (`UploadRevisionControl`). The
 * change markers of the latest version are switched in the tool bar.
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

function useResultToast() {
  const showToast = useViewerToast();
  return {
    onSuccess: (result: SyncResult) => {
      const message = syncResultMessage(result);
      if (message) showToast(message.text, message.tone);
    },
    onError: (error: Error) => showToast(error.message, 'danger'),
  };
}

/** Owners of an uploaded (not linked) deck: upload a new version – a button in the deck pill. */
export function UploadRevisionControl() {
  const { canManage } = useViewerData();
  const { isLinked } = useRevisionData();
  if (!canManage || isLinked) return null;
  return <UploadButton />;
}

function UploadButton() {
  const { deck } = useViewerData();
  const upload = useUploadRevision(deck.id);
  const toast = useResultToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = upload.isPending;

  return (
    // While busy the same button stays (only `aria-disabled`, the spinner over its icon): a
    // disabled or hidden one would drop the keyboard focus to <body> for good.
    <span className="relative inline-flex">
      <IconButton
        icon="upload"
        label={busy ? 'Neue Version wird verarbeitet …' : 'Neue Version hochladen (.pptx)'}
        size="sm"
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        onClick={() => {
          if (!busy) inputRef.current?.click();
        }}
        className={cn(busy && 'pointer-events-none *:invisible')}
      />
      {busy && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 inline-flex items-center justify-center"
        >
          <Spinner size={18} className="text-fg-muted" />
        </span>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Same file twice in a row must fire `change` again.
          event.target.value = '';
          if (file) upload.mutate(file, toast);
        }}
      />
    </span>
  );
}
