import { memo, type ReactNode } from 'react';
import { LayoutPicture, Stars, stars } from '@/features/workspaces';
import type { WorkspaceMaster } from '@slider/shared';
import {
  cn,
  ErrorText,
  Icon,
  SelectedMark,
  selectedCardClass,
  Spinner,
  usePointerSpot,
} from '@/ui';

const SKY = stars(36, 680, 224, 11);

/** The card's sky: faint stars, a few twinkling – decorative only. */
const Sky = memo(function Sky() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 680 224"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 size-full"
    >
      <Stars sky={SKY} opacity={0.35} />
    </svg>
  );
});

/** A slide behind the new one, fanning out further on hover. */
const ghost =
  'absolute inset-0 rounded-thumb ring-hairline-strong transition-transform duration-500 ease-emphasized';

/**
 * "Leere Präsentation" on top of "Neue Review", the featured way in: the welcome page's space
 * (stars, the light from above, the sage horizon) with a blank white slide floating on the right,
 * two more fanned out behind it. On hover the card glows like the featured join card and the
 * slides fan out; the whole card is the button. With slide masters of the workspace (ODP, the
 * ones Slider builds on) a choice below it: start on one of them or without.
 */
export function BlankDeckCard({
  onCreate,
  pending,
  error,
  masters = [],
  masterId,
  onMasterChange,
  title = 'Neue Präsentation',
  description = 'Gestalte deine Folien direkt im Editor.',
}: {
  /** The card's heading and the line below it – a template is designed the same way. */
  title?: string;
  description?: string;
  onCreate: () => void;
  pending: boolean;
  error: string | null;
  masters?: readonly WorkspaceMaster[];
  /** `''`: without a slide master. */
  masterId?: string;
  onMasterChange?: (masterId: string) => void;
}) {
  const followPointer = usePointerSpot();
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onCreate}
        disabled={pending}
        onPointerMove={followPointer}
        className={cn(
          'group hero-glow relative flex w-full sm:h-56 cursor-pointer overflow-hidden rounded-panel text-left shadow-card-rest',
          'transition-[scale,box-shadow] duration-500 ease-emphasized',
          'hover:shadow-card-glow focus-visible:shadow-card-glow motion-safe:hover:scale-[1.004] motion-safe:active:scale-[0.995]',
          'disabled:cursor-progress',
        )}
      >
        {/* First, so the positioned content after it paints on top. */}
        <Sky />
        <span className="pointer-light pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
        <span className="pointer-rim pointer-events-none absolute inset-0 rounded-panel opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

        <span className="relative flex flex-1 flex-col justify-between gap-8 p-6 sm:p-8">
          <span className="flex flex-col gap-1.5">
            <span className="text-2xl font-semibold tracking-tight text-fg">{title}</span>
            <span className="max-w-72 text-sm text-fg-subtle">{description}</span>
          </span>
          {/* Looks like the primary button; the card itself is the button. */}
          <span
            className={cn(
              'flex h-9 items-center gap-1.5 self-start rounded-control bg-primary px-3.5 text-sm font-medium text-on-primary shadow-glow',
              'transition-[background-color,box-shadow] duration-150 group-hover:bg-primary-hover group-hover:shadow-glow-hover',
            )}
          >
            {pending ? <Spinner size={16} /> : <Icon name="add" size={18} />}
            Erstellen
          </span>
        </span>

        {/* The slides: 16:9, leaning a little, on the right; beside the text on narrow screens
            there is no room. */}
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-10 aspect-video w-64 -translate-y-1/2 max-sm:hidden"
        >
          <span
            className={cn(
              ghost,
              'bg-surface-1 rotate-[-9deg] -translate-x-6 translate-y-2 group-hover:rotate-[-14deg] group-hover:-translate-x-12 group-hover:translate-y-3',
            )}
          />
          <span
            className={cn(
              ghost,
              'bg-surface-2 rotate-[-4deg] -translate-x-3 translate-y-1 group-hover:rotate-[-7deg] group-hover:-translate-x-6 group-hover:translate-y-1.5',
            )}
          />
          <span
            className={cn(
              'absolute inset-0 flex flex-col gap-2 rounded-thumb bg-primary-hover p-5 shadow-float',
              'rotate-2 transition-transform duration-500 ease-emphasized group-hover:-translate-y-2 group-hover:rotate-0',
            )}
          >
            {/* A title and two lines still to be written, faint on the white slide (pure white,
                like the real slides – `primary-hover` is the one opaque white). */}
            <span className="h-3 w-2/5 rounded-mark bg-canvas opacity-15" />
            <span className="mt-1 h-1.5 w-3/4 rounded-mark bg-canvas opacity-8" />
            <span className="h-1.5 w-3/5 rounded-mark bg-canvas opacity-8" />
            <span className="absolute inset-x-0 bottom-5 flex justify-center">
              <span className="flex size-10 items-center justify-center rounded-full border border-dashed border-current text-on-primary opacity-40 transition-[scale,opacity] duration-300 ease-overshoot group-hover:scale-110 group-hover:opacity-70">
                <Icon name="add" size={24} />
              </span>
            </span>
          </span>
        </span>
      </button>
      {masters.length > 0 && onMasterChange && (
        <MasterChoice masters={masters} masterId={masterId ?? ''} onChange={onMasterChange} />
      )}
      {error && (
        <ErrorText role="alert" size="xs">
          {error}
        </ErrorText>
      )}
    </div>
  );
}

/**
 * The designs to start on, as their pictures: „Ohne Vorlage“ (a white slide) first, then each
 * design's first layout with its name below – the picked one ringed, ticked and its name on a
 * pill. Radio buttons underneath, so the arrow keys step through them. Also the „Stil“ of the
 * prompt on Folie 1 (`compact`, smaller tiles under a small heading).
 */
export function MasterChoice({
  masters,
  masterId,
  onChange,
  legend = 'Vorlage',
  name = 'blank-deck-master',
  compact = false,
}: {
  masters: readonly WorkspaceMaster[];
  /** `''`: without a slide master. */
  masterId: string;
  onChange: (masterId: string) => void;
  legend?: string;
  /** The radio buttons' group name – one per choice on the page. */
  name?: string;
  compact?: boolean;
}) {
  const tile = { name, compact };
  return (
    <fieldset className={cn('flex flex-col', compact ? 'gap-2' : 'mt-4 gap-4')}>
      <legend
        className={cn(
          compact ? 'mb-2 text-xs font-medium text-fg-muted' : 'mb-4 text-base font-medium text-fg',
        )}
      >
        {legend}
      </legend>
      <div
        className={cn(
          'grid',
          compact
            ? 'grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3'
            : 'grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-4',
        )}
      >
        <MasterTile
          {...tile}
          label="Ohne Vorlage"
          selected={masterId === ''}
          onSelect={() => onChange('')}
        >
          <span className="flex size-full flex-col gap-1.5 bg-primary-hover p-[12%]">
            <span className="h-2 w-2/5 rounded-mark bg-canvas opacity-15" />
            <span className="h-1 w-3/4 rounded-mark bg-canvas opacity-8" />
            <span className="h-1 w-3/5 rounded-mark bg-canvas opacity-8" />
          </span>
        </MasterTile>
        {masters.map((master) => (
          <MasterTile
            key={master.id}
            {...tile}
            label={master.name}
            selected={masterId === master.id}
            onSelect={() => onChange(master.id)}
          >
            <LayoutPicture master={master} index={0} className="size-full" />
          </MasterTile>
        ))}
      </div>
    </fieldset>
  );
}

function MasterTile({
  name,
  label,
  compact,
  selected,
  onSelect,
  children,
}: {
  name: string;
  label: string;
  compact: boolean;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        'group flex min-w-0 cursor-pointer flex-col items-center',
        compact ? 'gap-1.5' : 'gap-2.5',
      )}
    >
      <input
        type="radio"
        name={name}
        checked={selected}
        onChange={onSelect}
        className="peer sr-only"
      />
      <span
        className={cn(
          'relative block aspect-video w-full overflow-hidden shadow-mark ring-2 ring-transparent transition-[box-shadow,scale] duration-300',
          compact ? 'rounded-chip' : 'rounded-panel',
          'group-hover:scale-[0.97] group-hover:ring-fg peer-focus-visible:ring-fg',
          selected && selectedCardClass,
        )}
      >
        {children}
        {selected && <SelectedMark compact />}
      </span>
      <span
        className={cn(
          'max-w-full truncate rounded-badge px-2 py-0.5 transition-colors duration-150',
          compact ? 'text-xs' : 'text-sm',
          selected ? 'bg-(--selection) text-(--on-selection)' : 'text-fg-muted group-hover:text-fg',
        )}
      >
        {label}
      </span>
    </label>
  );
}
