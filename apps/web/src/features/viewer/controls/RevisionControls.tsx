import type { SyncResult } from '@slider/shared';
import { useRef } from 'react';
import { useSyncDeck, useUploadRevision } from '@/lib/queries';
import { cn, GlassPanel, Icon, IconButton, Spinner } from '@/ui';
import { lastCheckedLabel, syncResultMessage } from '../lib/revision-changes';
import { useRevisionData } from '../state/revision-data';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { useViewerToast } from '../state/viewer-toast';

/**
 * Version pill in the controls row: owners reload a linked deck ("Neu laden") or upload a new
 * version of an uploaded one; from version 2 on everybody can switch the change markers of the
 * latest version on and off (Figma D2 "Änderungen zeigen").
 */
export function RevisionControls({ className }: { className?: string }) {
  const { isOwner } = useViewerData();
  const { revisionNumber, isLinked } = useRevisionData();
  const showUpdate = isOwner;
  const showToggle = revisionNumber > 1;
  if (!showUpdate && !showToggle) return null;

  return (
    <GlassPanel className={cn('flex shrink-0 items-center gap-1 py-1 pr-1 pl-1', className)}>
      {showUpdate && (isLinked ? <ReloadButton /> : <UploadButton />)}
      {showUpdate && showToggle && <span aria-hidden className="mx-0.5 h-5 w-px bg-white/15" />}
      {showToggle && <ChangesToggle revisionNumber={revisionNumber} />}
    </GlassPanel>
  );
}

function useResultToast() {
  const showToast = useViewerToast();
  return {
    onSuccess: (result: SyncResult) => {
      const { text, tone } = syncResultMessage(result);
      showToast(text, tone);
    },
    onError: (error: Error) => showToast(error.message, 'danger'),
  };
}

function ReloadButton() {
  const { deck } = useViewerData();
  const { sync } = useRevisionData();
  const syncDeck = useSyncDeck(deck.id);
  const toast = useResultToast();
  const busy = syncDeck.isPending;
  const pending = !busy && Boolean(sync?.pending);
  const label = busy
    ? 'Wird geprüft …'
    : pending
      ? 'Änderung erkannt – wird übernommen …'
      : `Neu laden · ${lastCheckedLabel(sync)}`;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-busy={busy || pending || undefined}
      disabled={busy}
      onClick={() => syncDeck.mutate(undefined, toast)}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] text-fg-muted transition-colors hover:bg-white/10 hover:text-fg disabled:cursor-progress"
    >
      {busy || pending ? (
        <Spinner size={18} className="text-fg-muted" />
      ) : (
        <Icon name="refresh" size={20} />
      )}
    </button>
  );
}

function UploadButton() {
  const { deck } = useViewerData();
  const upload = useUploadRevision(deck.id);
  const toast = useResultToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = upload.isPending;

  return (
    <>
      <IconButton
        icon="upload"
        label={busy ? 'Neue Version wird verarbeitet …' : 'Neue Version hochladen (.pptx)'}
        size="sm"
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => inputRef.current?.click()}
        className={cn(busy && 'hidden')}
      />
      {busy && (
        <span
          className="inline-flex size-8 items-center justify-center"
          title="Neue Version wird verarbeitet …"
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
    </>
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
      className="flex h-8 items-center gap-2 rounded-[10px] pr-1.5 pl-2 text-xs text-fg-muted transition-colors hover:bg-white/10 hover:text-fg"
    >
      {/* Narrow timeline (side panel open at laptop widths): just the switch, so the filter pill
          next to it keeps its room. Tooltip and label still name the version. */}
      <Icon name="history" size={18} className="md:@max-[1000px]:hidden" />
      <span className="font-medium text-fg tabular-nums md:@max-[1000px]:hidden">
        V{revisionNumber}
      </span>
      <span className="md:@max-[900px]:hidden max-md:hidden">Änderungen</span>
      <span
        aria-hidden
        className={cn(
          'relative h-4 w-7 shrink-0 rounded-full transition-colors',
          showChanges ? 'bg-primary' : 'bg-white/20',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 size-3 rounded-full transition-transform',
            showChanges ? 'translate-x-3 bg-black' : 'bg-white/80',
          )}
        />
      </span>
    </button>
  );
}
