import type { Deck } from '@slider/shared';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { Badge, cn, Icon, ProgressBar } from '@/ui';
import {
  importActivityLabel,
  importFraction,
  isImporting,
  slidesLabel,
  sourceLabel,
} from '../lib/deck-labels';

/** Right-hand status badge next to the title. Import state wins over "Neu", "Neu" over the version. */
export function DeckStatusBadge({ deck, unseen }: { deck: Deck; unseen: boolean }) {
  if (isImporting(deck)) return <Badge tone="warning">Import läuft</Badge>;
  if (deck.import.status === 'failed') return <Badge tone="danger">Fehler</Badge>;
  if (unseen) return <Badge tone="success">Neu</Badge>;
  if (deck.revisionNumber > 1) return <Badge>V{deck.revisionNumber}</Badge>;
  return null;
}

/** "OneDrive · aktualisiert vor 1 Std." */
export function DeckMeta({ deck, className }: { deck: Deck; className?: string }) {
  return (
    <p className={cn('truncate text-xs text-fg-subtle', className)}>
      {sourceLabel(deck.source)} · aktualisiert{' '}
      <time dateTime={deck.updatedAt} title={formatDateTime(deck.updatedAt)}>
        {formatRelativeTime(deck.updatedAt)}
      </time>
    </p>
  );
}

export function OpenCommentsChip({ count }: { count: number }) {
  const done = count === 0;
  return (
    <span className="glass inline-flex h-7 items-center gap-1.5 rounded-chip px-2.5 text-xs text-fg-muted">
      <Icon
        name={done ? 'checkCircle' : 'chatBubble'}
        size={16}
        className={done ? 'text-fg-muted' : undefined}
      />
      {done ? 'Alles erledigt' : `${count} offen`}
    </span>
  );
}

export function SlideCountChip({ count }: { count: number }) {
  return (
    <span className="absolute right-2 bottom-2 rounded-chip bg-black/55 px-2 py-0.5 text-[11px] leading-5 text-fg backdrop-blur-md">
      {slidesLabel(count)}
    </span>
  );
}

/** Dimmed overlay on the thumbnail while importing or after a failed import. */
export function ImportOverlay({ deck, compact = false }: { deck: Deck; compact?: boolean }) {
  const { import: state } = deck;

  if (state.status === 'failed') {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/70 px-4 text-center text-danger">
        <Icon name="error" size={compact ? 18 : 24} />
        {!compact && <span className="text-[13px] font-medium">Import fehlgeschlagen</span>}
      </div>
    );
  }
  if (!isImporting(deck)) return null;

  const label = importActivityLabel(state);
  const progress = state.status === 'running' ? state.progress : null;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black/65 px-6 text-center text-fg">
      <Icon name="sync" size={compact ? 18 : 22} className="animate-spin [animation-duration:2s]" />
      {!compact && (
        <>
          <span className="text-[13px] font-medium">{label}</span>
          <ProgressBar value={importFraction(state)} label={label} className="w-3/5" />
          {progress && (
            <span className="text-xs text-fg-subtle">
              {progress.done} von {progress.total}
            </span>
          )}
        </>
      )}
    </div>
  );
}
