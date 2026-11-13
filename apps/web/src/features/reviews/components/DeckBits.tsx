import type { ReactNode } from 'react';
import type { Deck, DeckSource } from '@slider/shared';
import { Badge, cn, Icon, NextcloudMark, ProgressBar, Tooltip } from '@/ui';
import { useDesktopDeck } from '@/lib/api';
import { importActivityLabel, importFraction, isImporting, slidesLabel } from '@/lib/deck-labels';

/** Right-hand status badge next to the title. Import state wins over the version. */
export function DeckStatusBadge({ deck }: { deck: Deck }) {
  if (isImporting(deck)) return <Badge tone="warning">Import läuft</Badge>;
  if (deck.import.status === 'failed') return <Badge tone="danger">Fehler</Badge>;
  if (deck.revisionNumber > 1) return <Badge>V{deck.revisionNumber}</Badge>;
  return null;
}

export function SlideCountChip({ count }: { count: number }) {
  return (
    <span className="glass-dark absolute right-2 bottom-2 rounded-chip px-2 py-0.5 text-caption leading-5 text-fg">
      {slidesLabel(count)}
    </span>
  );
}

/**
 * Bottom-left logos on the thumbnail: where the deck comes from and – once there are slides –
 * whether LibreOffice drew the slide images. `compact` (list rows) shows only the source. In the desktop
 * app a deck marked „Auf diesem Computer behalten“ shows that too, and one that is a file on this
 * computer (BER-201).
 *
 * Laid over the thumbnail instead of inside it: above the card's stretched title link (so the
 * chips get hover) and outside the frame's overflow clip (so their tooltips show). `className`
 * mirrors the frame's hover transform so the chips move with it.
 */
export function OriginChips({
  deck,
  compact = false,
  className,
}: {
  deck: Deck;
  compact?: boolean;
  className?: string;
}) {
  const source = SOURCES[deck.source];
  // Who drew the slide images (BER-94): only LibreOffice is shown – not the built-in SVG
  // preview, a PDF's own pages, or the pictures Office drew before Slider stopped asking it.
  const byLibreOffice = !compact && deck.slideCount > 0 && deck.thumbnailRenderer === 'libreoffice';
  const here = useDesktopDeck(deck.id);
  return (
    <div className={cn('pointer-events-none absolute inset-0 z-(--z-raised)', className)}>
      {/* Hovering the chips counts as hovering the deck: otherwise the card would shrink back
          under the pointer, slide the chip away and flicker between both looks. */}
      <div
        data-deck-hover
        className={cn(
          'pointer-events-auto absolute flex gap-1',
          compact ? 'bottom-1 left-1' : 'bottom-2 left-2',
        )}
      >
        <OriginChip label={source.title}>{source.mark}</OriginChip>
        {byLibreOffice && (
          <OriginChip label="Gerendert mit LibreOffice">
            <LibreOfficeMark />
          </OriginChip>
        )}
        {here.kept && (
          <OriginChip label="Bleibt auf diesem Computer">
            <Icon name="offlinePin" size={16} className="text-fg" />
          </OriginChip>
        )}
        {here.file && (
          <OriginChip
            label={here.file.missing ? 'Datei nicht gefunden' : 'Datei auf diesem Computer'}
          >
            <Icon
              name={here.file.missing ? 'warning' : 'description'}
              size={16}
              className="text-fg"
            />
          </OriginChip>
        )}
      </div>
    </div>
  );
}

/** Logo tile with its explanation as a tooltip above it on hover. */
function OriginChip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip label={label} decorative align="start" maxWidth={64}>
      <Badge tone="overlay" iconOnly role="img" aria-label={label}>
        {children}
      </Badge>
    </Tooltip>
  );
}

const linkSource = {
  title: 'Aus einem Link',
  mark: <Icon name="link" size={16} className="text-fg" />,
};

/**
 * Where the deck comes from. Decks once linked from OneDrive, SharePoint or Google Drive keep
 * their source but read as any other link: Slider no longer reads files there.
 */
const SOURCES: Record<DeckSource, { title: string; mark: ReactNode }> = {
  onedrive: linkSource,
  sharepoint: linkSource,
  nextcloud: { title: 'Aus Nextcloud', mark: <NextcloudMark size={16} /> },
  google: linkSource,
  url: linkSource,
  upload: { title: 'Hochgeladen', mark: <Icon name="upload" size={16} className="text-fg" /> },
};

/** LibreOffice's green document with the folded corner. */
function LibreOfficeMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-4 text-libreoffice" aria-hidden>
      <path d="M3 1.5h6.5L13 5v9.5H3z" fill="currentColor" />
      <path d="M9.5 1.5V5H13" fill="var(--color-primary-hover)" fillOpacity={0.6} />
      <path
        d="M5 8h6M5 10.5h6M5 13h4"
        stroke="var(--color-primary-hover)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Dimmed overlay on the thumbnail while importing or after a failed import. */
export function ImportOverlay({ deck, compact = false }: { deck: Deck; compact?: boolean }) {
  const { import: state } = deck;

  if (state.status === 'failed') {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-scrim-strong px-4 text-center text-danger">
        <Icon name="error" size={compact ? 18 : 24} />
        {!compact && <span className="text-body font-medium">Import fehlgeschlagen</span>}
      </div>
    );
  }
  if (!isImporting(deck)) return null;

  const label = importActivityLabel(state);
  const progress = state.status === 'running' ? state.progress : null;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-scrim dark-ink px-6 text-center text-fg">
      <Icon name="sync" size={compact ? 18 : 24} className="animate-spin [animation-duration:2s]" />
      {!compact && (
        <>
          <span className="text-body font-medium">{label}</span>
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
