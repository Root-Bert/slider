import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Deck, SavedShowRun } from '@slider/shared';
import { formatDateTime } from '@/lib/format';
import { useShowRuns, SummaryLine, SummaryRows } from '@/features/viewer';
import { Dialog } from '@/ui';
import type { DeckPanelSlot } from '../lib/deck-panel';
import { DeckPanelFrame } from './DeckPanelFrame';
import { StoragePanel } from './DeckStorageDialog';

/** The five completed runs, with recording and slide times, in the card or a dialog. */
export function DeckRunDialog({
  deck,
  run,
  slot,
  closing,
  onClosed,
  onClose,
}: {
  deck: Deck;
  run: SavedShowRun;
  slot?: DeckPanelSlot;
  closing?: boolean;
  onClosed?: () => void;
  onClose: () => void;
}) {
  const runs = useShowRuns(deck.id);
  const [picked, setPicked] = useState<string | null>(null);
  const selected = runs.find((each) => each.id === picked) ?? runs[0] ?? run;
  const skipped = selected.rows.filter((row) => row.skipped).length;
  const content = (
    <div className="flex flex-col gap-3">
      {runs.length > 1 && (
        <label className="text-sm text-fg-muted">
          Durchgang
          <select
            className="ml-2 rounded-control bg-surface-2 p-2 text-fg"
            value={runs.find((each) => each.id === picked)?.id ?? runs[0]?.id}
            onChange={(event) => setPicked(event.target.value)}
          >
            {runs.map((each) => (
              <option key={each.id} value={each.id}>
                {formatDateTime(each.at)}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected.recordingUrl && (
        <video
          className="w-full rounded-control"
          controls
          preload="metadata"
          src={selected.recordingUrl}
        />
      )}
      {selected.recordingUrl && (
        <a className="text-sm underline" href={selected.recordingUrl} download>
          Aufnahme herunterladen
        </a>
      )}
      <div className="flex flex-col gap-0.5 text-body text-fg-muted">
        <p>{formatDateTime(selected.at)}</p>
        <p>
          <SummaryLine total={selected.total} skipped={skipped} />
        </p>
      </div>
      <SummaryRows rows={selected.rows} />
    </div>
  );
  if (slot?.element) {
    return createPortal(
      <DeckPanelFrame kind={slot.kind} closing={closing} onClosed={onClosed}>
        <StoragePanel kind={slot.kind} title="Durchgänge" onClose={onClose}>
          {content}
        </StoragePanel>
      </DeckPanelFrame>,
      slot.element,
    );
  }
  return (
    <Dialog open onClose={onClose} title={`Durchgänge von „${deck.title}“`}>
      {content}
    </Dialog>
  );
}
