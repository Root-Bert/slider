import { useEffect, useState, type CSSProperties, type MouseEvent } from 'react';
import { formatFileSize } from '@/lib/format';
import { cn, ContextMenu, Icon, Menu, type MenuAction } from '@/ui';
import {
  faceLabel,
  familyKey,
  posterLook,
  type FontFamily,
  type FontStyle,
  type MaterialView,
} from '../../lib/font-families';
import { FontPoster } from './FontPoster';

/** Text set in one face of the family. */
const faceStyle = (family: FontFamily, face: FontStyle | undefined): CSSProperties => ({
  fontFamily: family.css,
  fontWeight: face?.weight ?? 400,
  fontStyle: face?.italic ? 'italic' : 'normal',
});

/**
 * Whether the element has come near the screen (and stays so): only then is its text set in the
 * family, so a font's files download as its card scrolls in, not all of them with the page.
 */
function useNearScreen() {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (!element || near) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      { rootMargin: '400px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, near]);
  return [setElement, near] as const;
}

const SOURCE_LABELS: Record<FontFamily['source'], string> = {
  slider: 'Slider',
  workspace: 'Workspace',
};

/** "Normal, Fett · für Calibri, Calibri Light", "Normal · aus „Quartalsbericht“" */
const facesLine = (family: FontFamily) =>
  [
    family.faces.map(faceLabel).join(', '),
    family.standsIn.length > 0 && `für ${family.standsIn.join(', ')}`,
    family.takenFrom && `aus „${family.takenFrom}“`,
  ]
    .filter(Boolean)
    .join(' · ');

const PANGRAM = 'Franz jagt im komplett verwahrlosten Taxi quer durch Bayern';

// The reviews grid's columns and gaps, so both views of a workspace line up.
const GRID_CLASSES =
  'grid grid-cols-1 gap-x-14 gap-y-16 min-[700px]:grid-cols-2 min-[1200px]:grid-cols-3';

/** Clicks on these keep their own meaning, even with a modifier key. */
const OWN_CONTROLS = 'button, input, [role="menu"]';

interface FontCollectionProps {
  families: readonly FontFamily[];
  view: MaterialView;
  /** The actions of one family – its ⋯ menu and right click. */
  actionsFor: (family: FontFamily) => MenuAction[];
  /** Part of the multi-selection, by `familyKey`. */
  selected: ReadonlySet<string>;
  /** ⌘/Ctrl/Shift-click on a family, or any click while some are selected; true when it changed the selection. */
  onModifiedClick: (key: string, event: MouseEvent) => boolean;
  /** The actions for the whole selection, on a right click on one of several selected. */
  selectionActions: MenuAction[];
}

/**
 * The workspace's fonts as specimen posters (grid) or rows (list), like the reviews: selectable
 * with ⌘/Shift-click or a selection box (`data-font-key`), actions in a ⋯ menu and on right click.
 */
export function FontCollection({
  families,
  view,
  actionsFor,
  selected,
  onModifiedClick,
  selectionActions,
}: FontCollectionProps) {
  const Item = view === 'grid' ? FontCard : FontRow;
  const [menu, setMenu] = useState<{
    at: { x: number; y: number };
    label: string;
    actions: MenuAction[];
  } | null>(null);
  const onClickCapture = (key: string) => (event: MouseEvent) => {
    if ((event.target as Element).closest(OWN_CONTROLS)) return;
    if (onModifiedClick(key, event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  // Shift + right click keeps the browser's own menu.
  const onContextMenu = (family: FontFamily) => (event: MouseEvent) => {
    if (event.shiftKey) return;
    event.preventDefault();
    const at = { x: event.clientX, y: event.clientY };
    if (selected.size > 1 && selected.has(familyKey(family))) {
      setMenu({ at, label: `Aktionen für ${selected.size} Schriften`, actions: selectionActions });
    } else {
      setMenu({ at, label: `Aktionen für „${family.family}“`, actions: actionsFor(family) });
    }
  };
  return (
    <>
      <ul
        className={view === 'grid' ? GRID_CLASSES : 'glass flex flex-col gap-1 rounded-panel p-1.5'}
      >
        {families.map((family) => {
          const key = familyKey(family);
          return (
            <li
              key={key}
              data-font-key={key}
              className="min-w-0"
              onClickCapture={onClickCapture(key)}
              onContextMenu={onContextMenu(family)}
            >
              <Item family={family} actions={actionsFor(family)} selected={selected.has(key)} />
            </li>
          );
        })}
      </ul>
      {menu && menu.actions.length > 0 && (
        <ContextMenu
          label={menu.label}
          actions={menu.actions}
          at={menu.at}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

interface FontItemProps {
  family: FontFamily;
  actions: MenuAction[];
  selected: boolean;
}

function FontActions({
  family,
  actions,
  className,
  glass = false,
}: Pick<FontItemProps, 'family' | 'actions'> & { className?: string; glass?: boolean }) {
  if (actions.length === 0) return null;
  return (
    <Menu
      label={`Aktionen für „${family.family}“`}
      actions={actions}
      triggerVariant={glass ? 'glass' : undefined}
      className={className}
    />
  );
}

/** Tick in the corner of a selected font, like a selected deck's. */
function SelectedMark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={cn(
        'absolute z-(--z-raised) flex items-center justify-center rounded-full bg-(--selection) text-(--on-selection) shadow-mark',
        compact ? 'top-1 left-1 size-4' : 'top-2 left-2 size-6',
      )}
    >
      <Icon name="check" size={compact ? 12 : 16} label="Ausgewählt" />
    </span>
  );
}

/**
 * Specimen card: a 16:9 frame like a deck's thumbnail with the family's poster. Hovered, it does what a deck card does: the frame steps
 * back with a ring and its halo (a blurred copy behind it) lights up.
 */
function FontCard({ family, actions, selected }: FontItemProps) {
  const [ref, near] = useNearScreen();
  return (
    <article
      ref={ref}
      className="group relative flex min-w-0 flex-col gap-3 has-[[aria-expanded=true]]:z-(--z-chrome)"
    >
      <div className="relative isolate">
        {/* The halo, as `SlideThumbnail` draws a deck's. */}
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute -inset-16 -z-(--z-raised) p-16 blur-2xl',
            'transition-[opacity,scale] duration-300 will-change-[opacity,scale] group-hover:scale-105',
            // A paper poster would glare: its halo stays softer.
            posterLook(family).paper
              ? 'opacity-12 group-hover:opacity-25'
              : 'opacity-35 group-hover:opacity-60',
          )}
        >
          <FontPoster family={family} near={near} />
        </div>
        <div
          className={cn(
            'relative aspect-video overflow-hidden rounded-panel ring-2 ring-transparent',
            'transition-[box-shadow,scale] duration-300 group-hover:scale-[0.97] group-hover:ring-fg',
            selected && 'scale-[0.97] ring-(--selection)!',
          )}
        >
          <FontPoster family={family} near={near} />
          {selected && <SelectedMark />}
        </div>
        <FontActions
          family={family}
          actions={actions}
          glass
          className="absolute top-2 right-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:opacity-100"
        />
      </div>

      <div className="flex min-w-0 items-baseline gap-2">
        <h3 className="truncate text-lg font-medium text-fg">{family.family}</h3>
        {family.sizeBytes !== null && (
          <span className="ml-auto shrink-0 text-sm text-fg-subtle">
            {formatFileSize(family.sizeBytes)}
          </span>
        )}
      </div>
      <p className="-mt-2 truncate text-sm text-fg-subtle">{facesLine(family)}</p>
    </article>
  );
}

/** Compact row with the same information as the card. */
function FontRow({ family, actions, selected }: FontItemProps) {
  const [ref, near] = useNearScreen();
  const style = near ? faceStyle(family, family.faces[0]) : undefined;
  return (
    <article
      ref={ref}
      className={cn(
        'group flex items-center gap-4 rounded-control-sm px-3 py-2.5 transition-colors hover:bg-surface-1',
        selected && 'bg-(--selection)/15! ring-1 ring-(--selection)/60',
      )}
    >
      <span
        aria-hidden
        className="relative flex aspect-video w-24 shrink-0 items-center justify-center rounded-badge bg-placeholder text-3xl leading-none text-fg"
        style={style}
      >
        Aa
        {selected && <SelectedMark compact />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium text-fg">
          <span className="truncate">{family.family}</span>
          <span className="shrink-0 rounded-chip bg-surface-2 px-1.5 text-caption leading-4 font-normal text-fg-subtle">
            {SOURCE_LABELS[family.source]}
          </span>
        </h3>
        <p className="truncate text-body text-fg-subtle" style={style}>
          {PANGRAM}
        </p>
      </div>
      <span className="shrink-0 text-body text-fg-subtle max-md:hidden">{facesLine(family)}</span>
      <span className="w-16 shrink-0 text-right text-body text-fg-subtle max-sm:hidden">
        {family.sizeBytes !== null && formatFileSize(family.sizeBytes)}
      </span>
      <span className="flex w-8 shrink-0 justify-end">
        <FontActions family={family} actions={actions} />
      </span>
    </article>
  );
}

export function FontCollectionSkeleton({ view }: { view: MaterialView }) {
  const items = [0, 1, 2];
  if (view === 'list') {
    return (
      <div className="glass flex flex-col gap-1 rounded-panel p-1.5" aria-hidden>
        {items.map((index) => (
          <div key={index} className="flex items-center gap-4 px-3 py-2.5">
            <div className="skeleton aspect-video w-24 rounded-badge" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="skeleton h-3.5 w-40 rounded-thumb" />
              <div className="skeleton h-3 w-56 rounded-thumb" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={GRID_CLASSES} aria-hidden>
      {items.map((index) => (
        <div key={index} className="flex flex-col gap-3">
          <div className="skeleton aspect-video rounded-control-sm" />
          <div className="skeleton h-4 w-2/5 rounded-thumb" />
          <div className="skeleton h-3 w-3/5 rounded-thumb" />
        </div>
      ))}
    </div>
  );
}
