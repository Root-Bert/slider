import { useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Deck, DeckStorage } from '@slider/shared';
import { formatFileSize, pluralize } from '@/lib/format';
import { useDeckStorage, usePruneDeckStorage } from '@/lib/api';
import {
  Button,
  cn,
  ConfirmDialog,
  Dialog,
  ErrorText,
  IconButton,
  ListRow,
  LoadingState,
  Notice,
  PopoverPanel,
  RowList,
  useDismiss,
} from '@/ui';
import { DECK_PANEL, type DeckPanelKind, type DeckPanelSlot } from '../lib/deck-panel';
import { DeckPanelFrame } from './DeckPanelFrame';

const BREAKDOWN: { key: keyof DeckStorage['breakdown']; label: string }[] = [
  { key: 'originals', label: 'PowerPoint-Dateien' },
  { key: 'slideImages', label: 'Folienbilder' },
  { key: 'media', label: 'Aufnahmen und Bilder in Kommentaren' },
  { key: 'other', label: 'Sonstiges' },
];

/**
 * "Speicherplatz …" in the ⋯ menu of a deck (managers only): what the review takes up, by kind,
 * and "Alles außer der neuesten Version löschen" under the PowerPoint files – confirmed with the
 * amount it frees. Comments,
 * threads and their recordings stay; older versions then show "Ältere Version gelöscht".
 */
export function DeckStorageDialog({
  deck,
  slot,
  closing,
  onClosed,
  onClose,
  onPruned,
}: {
  deck: Deck;
  /**
   * The grid card's thumbnail box (the overview fills it, slightly inset) or the area under a
   * list row – like the open comments list. Without one it is a modal dialog.
   */
  slot?: DeckPanelSlot;
  /** Under a list row: sliding shut (`usePanelPresence`); `onClosed` once it is. */
  closing?: boolean;
  onClosed?: () => void;
  onClose: () => void;
  /** After deleting: how much was freed, for a toast. */
  onPruned: (freedBytes: number) => void;
}) {
  const storage = useDeckStorage(deck.id);
  const prune = usePruneDeckStorage(deck.id);
  const [confirming, setConfirming] = useState(false);
  const data = storage.data;

  if (confirming && data) {
    return (
      <ConfirmDialog
        onClose={() => setConfirming(false)}
        title="Ältere Versionen löschen?"
        description={
          <div className="flex flex-col gap-2">
            <span>
              Gibt{' '}
              <strong className="font-medium text-fg">
                {formatFileSize(data.reclaimableBytes)}
              </strong>{' '}
              frei. Endgültig entfernt werden die PowerPoint-Dateien und Folienbilder von{' '}
              {pluralize(data.olderVersionCount, 'älteren Version', 'älteren Versionen')}.
            </span>
            <span>
              Alle Kommentare, Threads und Aufnahmen bleiben. Wo sie zu einer älteren Version
              gehören, steht dann „Ältere Version gelöscht“ statt des Folienbilds.
            </span>
          </div>
        }
        confirmLabel={`${formatFileSize(data.reclaimableBytes)} freigeben`}
        confirmIcon="delete"
        pending={prune.isPending}
        error={prune.error?.message}
        onConfirm={() =>
          prune.mutate(undefined, {
            onSuccess: (result) => {
              setConfirming(false);
              onPruned(result.freedBytes);
            },
          })
        }
      />
    );
  }

  const content = storage.isPending ? (
    <LoadingState padding="sm" />
  ) : storage.isError ? (
    <ErrorText>{storage.error.message}</ErrorText>
  ) : (
    <StorageSummary
      storage={storage.data}
      compact={slot?.kind === 'thumbnail'}
      onPrune={() => {
        prune.reset();
        setConfirming(true);
      }}
    />
  );

  if (slot?.element) {
    return createPortal(
      <DeckPanelFrame kind={slot.kind} closing={closing} onClosed={onClosed}>
        <StoragePanel kind={slot.kind} title="Speicherplatz" onClose={onClose}>
          {content}
        </StoragePanel>
      </DeckPanelFrame>,
      slot.element,
    );
  }
  return (
    <Dialog open onClose={onClose} title={`Speicherplatz von „${deck.title}“`}>
      {content}
    </Dialog>
  );
}

/** The overview in the card's thumbnail or under the row, scrolling inside. */
function StoragePanel({
  kind,
  title,
  onClose,
  children,
}: {
  kind: DeckPanelKind;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const headingId = useId();
  const ref = useRef<HTMLElement>(null);
  useDismiss({ open: true, onDismiss: onClose, refs: [ref] });
  return (
    <PopoverPanel
      as="section"
      ref={ref}
      aria-labelledby={headingId}
      position="none"
      tone={DECK_PANEL[kind].tone}
      className={DECK_PANEL[kind].className}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 pt-2 pr-2 pb-1 pl-4">
        <h2 id={headingId} className="text-sm font-semibold text-fg">
          {title}
        </h2>
        <IconButton icon="close" label="Schließen" size="sm" onClick={onClose} />
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-3">{children}</div>
    </PopoverPanel>
  );
}

function StorageSummary({
  storage,
  compact,
  onPrune,
}: {
  storage: DeckStorage;
  /** In the thumbnail: tighter spacing. */
  compact: boolean;
  onPrune: () => void;
}) {
  return (
    <div className={cn('flex flex-col', compact ? 'gap-2' : 'gap-4')}>
      <p className="flex items-baseline justify-between gap-4 text-body text-fg-muted">
        <span>Belegt insgesamt</span>
        <span className="text-base font-medium text-fg tabular-nums">
          {formatFileSize(storage.totalBytes)}
        </span>
      </p>
      <RowList aria-label="Aufteilung">
        {BREAKDOWN.filter(({ key }) => key !== 'other' || storage.breakdown.other > 0).map(
          ({ key, label }) => (
            <ListRow
              key={key}
              title={label}
              subtitle={
                key === 'originals' && storage.originalCount > 0
                  ? pluralize(storage.originalCount, 'History-Version', 'History-Versionen')
                  : undefined
              }
              size="body"
              titleWeight="normal"
              trailing={
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-body text-fg-muted tabular-nums">
                    {formatFileSize(storage.breakdown[key])}
                  </span>
                  {key === 'originals' && (
                    <Button
                      variant="soft"
                      tone="strong"
                      size="xs"
                      icon="delete"
                      disabled={storage.reclaimableBytes === 0 || storage.busy}
                      onClick={onPrune}
                    >
                      {/* The thumbnail is narrow: the short label fits next to the title. */}
                      {compact
                        ? 'Ältere Versionen löschen'
                        : 'Alles außer der neuesten Version löschen'}
                    </Button>
                  )}
                </div>
              }
            />
          ),
        )}
      </RowList>
      {storage.busy && (
        <Notice tone="info" size="sm">
          Gerade wird eine Version verarbeitet – danach kannst du ältere Versionen löschen.
        </Notice>
      )}
    </div>
  );
}
