import type { ReactNode } from 'react';
import type { Deck, DeckSource, SlideRenderer } from '@slider/shared';
import { Badge, cn, Icon, ProgressBar } from '@/ui';
import { importActivityLabel, importFraction, isImporting, slidesLabel } from '../lib/deck-labels';

/** Right-hand status badge next to the title. Import state wins over "Neu", "Neu" over the version. */
export function DeckStatusBadge({ deck, unseen }: { deck: Deck; unseen: boolean }) {
  if (isImporting(deck)) return <Badge tone="warning">Import läuft</Badge>;
  if (deck.import.status === 'failed') return <Badge tone="danger">Fehler</Badge>;
  if (unseen) return <Badge tone="success">Neu</Badge>;
  if (deck.revisionNumber > 1) return <Badge>V{deck.revisionNumber}</Badge>;
  return null;
}

/** Top-left "Neu" on the grid card's thumbnail; import state still wins (shown next to the title). */
export function NewChip({ deck, unseen }: { deck: Deck; unseen: boolean }) {
  if (!unseen || isImporting(deck) || deck.import.status === 'failed') return null;
  return (
    <span className="absolute top-2 left-2 rounded-chip bg-black/55 px-2 py-0.5 text-[11px] leading-5 font-medium text-success backdrop-blur-md">
      Neu
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

const RENDERER_LABELS: Partial<Record<SlideRenderer, string>> = {
  office: 'Gerendert mit PowerPoint',
  libreoffice: 'Gerendert mit LibreOffice',
};

const CHIP_CLASSES =
  'flex size-6 items-center justify-center rounded-chip bg-black/55 backdrop-blur-md';

/**
 * Bottom-left logos on the thumbnail: where the deck comes from and – once there are slides –
 * who drew the slide images. `compact` (list rows) shows only the source.
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
  return (
    <div className={cn('pointer-events-none absolute inset-0 z-10', className)}>
      <div
        className={cn(
          'pointer-events-auto absolute flex gap-1',
          compact ? 'bottom-1 left-1' : 'bottom-2 left-2',
        )}
      >
        <SourceChip source={deck.source} />
        {!compact && deck.slideCount > 0 && (
          <RendererChip renderer={deck.thumbnailRenderer} officeFailure={deck.officeFailure} />
        )}
      </div>
    </div>
  );
}

/** Logo tile with its explanation as a tooltip above it on hover. */
function OriginChip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className={cn(CHIP_CLASSES, 'group/chip relative')} role="img" aria-label={label}>
      {children}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute bottom-full left-0 mb-1.5 w-max max-w-64 translate-y-1 rounded-badge',
          'bg-glass-solid px-2 py-1 text-[11px] leading-4 text-fg opacity-0 shadow-lg ring-1 ring-white/10',
          'transition-[opacity,translate] duration-150 group-hover/chip:translate-y-0 group-hover/chip:opacity-100',
        )}
      >
        {label}
      </span>
    </span>
  );
}

const SOURCE_TITLES: Record<DeckSource, string> = {
  onedrive: 'Aus OneDrive',
  sharepoint: 'Aus SharePoint',
  url: 'Aus einem Link',
  upload: 'Hochgeladen',
};

/** Where the deck comes from, instead of the old "OneDrive · …" text line. */
function SourceChip({ source }: { source: DeckSource }) {
  const label = SOURCE_TITLES[source];
  return (
    <OriginChip label={label}>
      {source === 'onedrive' && <Icon name="cloud" size={16} className="text-onedrive" />}
      {source === 'sharepoint' && <LetterMark letter="S" className="bg-sharepoint" />}
      {source === 'url' && <Icon name="link" size={16} className="text-fg" />}
      {source === 'upload' && <Icon name="upload" size={16} className="text-fg" />}
    </OriginChip>
  );
}

/**
 * Who drew the slide images (BER-94). Nothing for the built-in SVG preview. When PowerPoint was
 * tried and failed, the tooltip says why.
 */
function RendererChip({
  renderer,
  officeFailure,
}: {
  renderer: SlideRenderer | null | undefined;
  officeFailure?: string | null;
}) {
  const name = renderer ? RENDERER_LABELS[renderer] : undefined;
  if (!renderer || !name) return null;
  const label =
    renderer !== 'office' && officeFailure
      ? `${name} – PowerPoint ging nicht: ${officeFailure}`
      : name;
  return (
    <OriginChip label={label}>
      {renderer === 'office' ? (
        <LetterMark letter="P" className="bg-powerpoint" />
      ) : (
        <LibreOfficeMark />
      )}
    </OriginChip>
  );
}

/** Office-style letter tile: PowerPoint's orange "P" (as on imported comments), SharePoint's "S". */
function LetterMark({ letter, className }: { letter: string; className: string }) {
  return (
    <span
      className={cn(
        'flex size-4 items-center justify-center rounded-thumb text-[10px] leading-none font-semibold text-white',
        className,
      )}
    >
      {letter}
    </span>
  );
}

/** LibreOffice's green document with the folded corner. */
function LibreOfficeMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-4 text-libreoffice" aria-hidden>
      <path d="M3 1.5h6.5L13 5v9.5H3z" fill="currentColor" />
      <path d="M9.5 1.5V5H13" fill="white" fillOpacity={0.6} />
      <path d="M5 8h6M5 10.5h6M5 13h4" stroke="white" strokeWidth={1.2} strokeLinecap="round" />
    </svg>
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
