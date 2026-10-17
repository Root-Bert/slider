import type { SyncResult } from '@slider/shared';
import { useRef } from 'react';
import { useUploadRevision } from '@/lib/api';
import { cn, Icon, IconButton, Spinner, SwitchTrack, Toolbar, ToolbarDivider } from '@/ui';
import { revisionNoticeText, syncResultMessage } from '../revisions/lib/revision-changes';
import { RevisionNotice } from '../revisions/RevisionNotice';
import { useRevisionData } from '../state/revision-data';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { useViewerToast } from '../state/viewer-toast';

/**
 * Version pill in the controls row. Linked decks update themselves (polling); the upload of a
 * new version of an uploaded deck sits left, next to the filter pill (`UploadRevisionControl`).
 * The change markers of the latest version (Figma D2 "Änderungen", on by default) can be switched
 * on and off only when that version actually added, changed or moved slides. After a new
 * version arrived, a notice says what changed until it is closed (`RevisionNotice`).
 */
export function RevisionControls({ className }: { className?: string }) {
  const { revisionNumber, badges, announcement, dismissAnnouncement } = useRevisionData();
  const showToggle = revisionNumber > 1 && badges.size > 0;
  const showPill = showToggle || announcement !== null;

  return (
    <>
      {/* Always mounted, so the notice's text is read out when it appears. */}
      <span role="status" className="sr-only">
        {announcement
          ? revisionNoticeText(announcement.revisionNumber, announcement.summary)
          : null}
      </span>
      {showPill && (
        <Toolbar role={false} className={cn('shrink-0', className)}>
          {announcement && (
            // Keyed by number: a newer version restarts the notice.
            <RevisionNotice
              key={announcement.revisionNumber}
              announcement={announcement}
              onDone={dismissAnnouncement}
            />
          )}
          {announcement && showToggle && <ToolbarDivider />}
          {showToggle && <ChangesToggle revisionNumber={revisionNumber} />}
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

/** Owners of an uploaded (not linked) deck: upload a new version – own pill next to the filter. */
export function UploadRevisionControl({ className }: { className?: string }) {
  const { canManage } = useViewerData();
  const { isLinked } = useRevisionData();
  if (!canManage || isLinked) return null;
  return (
    <Toolbar role={false} className={cn('shrink-0', className)}>
      <UploadButton />
    </Toolbar>
  );
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

function ChangesToggle({ revisionNumber }: { revisionNumber: number }) {
  const { showChanges } = useViewerState();
  const dispatch = useViewerDispatch();
  const label = `Version ${revisionNumber} – Änderungen ${showChanges ? 'ausblenden' : 'zeigen'}`;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={showChanges}
      aria-label={`Änderungen der Version ${revisionNumber} zeigen`}
      title={label}
      onClick={() => dispatch({ type: 'showChangesSet', show: !showChanges })}
      className="flex h-8 items-center gap-2 rounded-control pr-1.5 pl-2 text-xs text-fg-muted transition-colors hover:bg-hover hover:text-fg"
    >
      {/* Narrow timeline (side panel open at laptop widths): just the switch, so the filter pill
          next to it keeps its room. Tooltip and label still name the version. */}
      <Icon name="history" size={18} className="md:@max-[1000px]:hidden" />
      <span className="font-medium text-fg tabular-nums md:@max-[1000px]:hidden">
        V{revisionNumber}
      </span>
      <span className="md:@max-[900px]:hidden max-md:hidden">Änderungen</span>
      <SwitchTrack checked={showChanges} size="sm" />
    </button>
  );
}
