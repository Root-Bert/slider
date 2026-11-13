import { Link } from 'react-router';
import type { TemplateColor, WorkspaceMaster } from '@slider/shared';
import { pluralize } from '@/lib/format';
import { routes } from '@/lib/routes';
import { cn, collectionGridClass, type ShowToast } from '@/ui';
import type { MaterialView } from '../../lib/font-families';

/** A design's page, its way back leading to „Farben“ again. */
const masterLink = (workspaceId: string, masterId: string) =>
  `${routes.workspaceMaster(workspaceId, masterId)}?from=farben`;

/** A colour as the pickers name it: `2563EB`. */
const hexName = (color: string) => color.slice(1).toUpperCase();

interface ColorCollectionProps {
  workspaceId: string;
  /** Designs with colours, in the order shown. */
  masters: readonly WorkspaceMaster[];
  view: MaterialView;
  onNotify: ShowToast;
}

/**
 * The workspace's colours: each design's („Farben“ – set where it is designed, its theme's when
 * uploaded), the ones its decks' pickers offer. A click on a colour copies its value; the
 * design's name opens its page. Nothing to pick or remove – they belong to their design.
 */
export function ColorCollection({ workspaceId, masters, view, onNotify }: ColorCollectionProps) {
  const copy = ({ color, name }: TemplateColor) =>
    navigator.clipboard
      ?.writeText(`#${hexName(color)}`)
      .then(() => onNotify(`${name || `#${hexName(color)}`} kopiert`))
      .catch(() => onNotify('Konnte nicht in die Zwischenablage kopieren.', 'danger'));
  if (view === 'list') {
    return (
      <ul className="glass flex flex-col gap-1 rounded-panel p-1.5">
        {masters.map((master) => (
          <li
            key={master.id}
            className="flex items-center gap-4 rounded-control-sm px-3 py-2.5 transition-colors hover:bg-surface-1"
          >
            <h3 className="w-48 shrink-0 truncate text-sm font-medium text-fg max-sm:w-28">
              <Link to={masterLink(workspaceId, master.id)}>{master.name}</Link>
            </h3>
            <div className="-m-0.5 flex min-w-0 flex-1 flex-wrap gap-2 p-0.5">
              {(master.colors ?? []).map((color) => (
                <Swatch key={color.color} color={color} size="sm" onCopy={copy} />
              ))}
            </div>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className={collectionGridClass}>
      {masters.map((master) => (
        <li key={master.id} className="min-w-0">
          <article className="glass flex min-w-0 flex-col gap-5 rounded-panel p-5">
            <div className="flex min-w-0 items-baseline gap-2">
              <h3 className="min-w-0 flex-1 truncate text-lg font-medium text-fg">
                <Link to={masterLink(workspaceId, master.id)}>{master.name}</Link>
              </h3>
              <span className="shrink-0 text-sm text-fg-subtle">
                {pluralize(master.colors?.length ?? 0, 'Farbe', 'Farben')}
              </span>
            </div>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-x-2 gap-y-4">
              {(master.colors ?? []).map((color) => (
                <li key={color.color} className="min-w-0">
                  <Swatch color={color} size="lg" onCopy={copy} />
                </li>
              ))}
            </ul>
          </article>
        </li>
      ))}
    </ul>
  );
}

/** One colour: a dot (list) or a dot with its name and value under it (card). */
function Swatch({
  color,
  size,
  onCopy,
}: {
  color: TemplateColor;
  size: 'sm' | 'lg';
  onCopy: (color: TemplateColor) => void;
}) {
  const title = color.name ? `${color.name} · ${hexName(color.color)}` : hexName(color.color);
  const dot = (
    <span
      aria-hidden
      className={cn(
        'block shrink-0 rounded-full ring-hairline-strong transition-transform duration-150 group-hover/swatch:scale-110',
        size === 'lg' ? 'size-11' : 'size-6',
      )}
      style={{ backgroundColor: color.color }}
    />
  );
  return (
    <button
      type="button"
      title={`${title} – Klick kopiert`}
      aria-label={`${title} kopieren`}
      onClick={() => onCopy(color)}
      className={cn(
        'group/swatch rounded-control-sm focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none',
        size === 'lg' && 'flex w-full min-w-0 flex-col items-center gap-1.5 py-1',
      )}
    >
      {dot}
      {size === 'lg' && (
        <>
          <span className="w-full truncate text-center text-xs text-fg">
            {color.name || hexName(color.color)}
          </span>
          <span className="text-caption text-fg-subtle tabular-nums">{hexName(color.color)}</span>
        </>
      )}
    </button>
  );
}

export function ColorCollectionSkeleton({ view }: { view: MaterialView }) {
  const items = [0, 1, 2];
  if (view === 'list') {
    return (
      <div className="glass flex flex-col gap-1 rounded-panel p-1.5" aria-hidden>
        {items.map((index) => (
          <div key={index} className="flex items-center gap-4 px-3 py-2.5">
            <div className="skeleton h-3.5 w-40 rounded-thumb" />
            <div className="skeleton h-6 w-64 rounded-full" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={collectionGridClass} aria-hidden>
      {items.map((index) => (
        <div key={index} className="skeleton h-56 rounded-panel" />
      ))}
    </div>
  );
}
