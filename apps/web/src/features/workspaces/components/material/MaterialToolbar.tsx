import type { ReactNode } from 'react';
import { ICON_KINDS, type IconFilter } from '@/features/icons';
import { SegmentedControl, Select, type Segment } from '@/ui';
import type { MaterialView } from '../../lib/font-families';
import { ViewSearch } from '../ViewSearch';
import { ViewToolbar } from '../ViewToolbar';

/**
 * What the page shows, in the filter's order – the workspace's templates (its slide masters),
 * their colours, the fonts (its own and Slider's), the symbols (icons and pictograms) Slider
 * brings along.
 */
export type MaterialKind = 'masters' | 'colors' | 'fonts' | 'icons';
export type MaterialSort = 'name' | 'faces' | 'size';
/** Which fonts „Schriften“ shows: both, Slider's or the workspace's own. */
export type FontSource = 'all' | 'slider' | 'workspace';

const SOURCE_OPTIONS = [
  { value: 'all', label: 'Alle Schriften' },
  { value: 'slider', label: 'Slider-Schriften' },
  { value: 'workspace', label: 'Workspace-Schriften' },
] satisfies { value: FontSource; label: string }[];

/** Which symbols „Symbole“ shows – named as the editor's symbol search names them. */
const ICON_KIND_OPTIONS = [{ value: 'all', label: 'Alle Symbole' }, ...ICON_KINDS] satisfies {
  value: IconFilter;
  label: string;
}[];

/** Per design, not per file: no size to sort by. */
const byDesign = (kind: MaterialKind) => kind === 'masters' || kind === 'colors';

/** `faces`: a font's faces, a design's layouts or colours. Symbols: no sort, best first. */
const sortOptions = (kind: MaterialKind) =>
  (
    [
      { value: 'name', label: 'Name' },
      {
        value: 'faces',
        label: kind === 'masters' ? 'Layouts' : kind === 'colors' ? 'Farben' : 'Schnitte',
      },
      { value: 'size', label: 'Größe' },
    ] satisfies { value: MaterialSort; label: string }[]
  ).filter((option) => !byDesign(kind) || option.value !== 'size');

/**
 * What the search's button adds to the names: a template's layouts, a font's stand-ins and origin.
 * Symbols: no button – their names and keywords always, as the editor's symbol search.
 */
const CONTENT_SEARCH = {
  masters: {
    contentLabel: 'Auch Layouts durchsuchen',
    contentPlaceholder: 'Namen, Layouts…',
  },
  colors: {
    contentLabel: 'Auch Farbnamen und Werte durchsuchen',
    contentPlaceholder: 'Vorlagen, Farbnamen, Werte…',
  },
  icons: {
    contentPlaceholder: 'Namen, Stichwörter, z. B. Idee…',
  },
  fonts: {
    contentLabel: 'Auch ersetzte Schriften und Herkunft durchsuchen',
    contentPlaceholder: 'Namen, ersetzte Schriften…',
  },
};

interface MaterialToolbarProps {
  kind: MaterialKind;
  onKindChange: (kind: MaterialKind) => void;
  /** `icons`: unknown until the sets are loaded (opened once). */
  counts: Record<Exclude<MaterialKind, 'icons'>, number> & { icons?: number };
  query: string;
  onQueryChange: (query: string) => void;
  /** Layouts, stand-ins and origins are searched too, not only the names. */
  content: boolean;
  onContentChange: (content: boolean) => void;
  sort: MaterialSort;
  onSortChange: (sort: MaterialSort) => void;
  view: MaterialView;
  onViewChange: (view: MaterialView) => void;
  /** „Schriften“ only: whose fonts, picked left of the sort select. */
  source: FontSource;
  onSourceChange: (source: FontSource) => void;
  /** „Symbole“ only, the same way: icons, pictograms or both. */
  iconKind: IconFilter;
  onIconKindChange: (kind: IconFilter) => void;
  /** Right next to the filter – the "Neues Asset" button, only its icon when asked. */
  action?: ((iconOnly: boolean) => ReactNode) | undefined;
}

/** The reviews' toolbar for the workspace's material: filter and action left, search, sort, view right. */
export function MaterialToolbar({
  kind,
  onKindChange,
  counts,
  query,
  onQueryChange,
  content,
  onContentChange,
  sort,
  onSortChange,
  view,
  onViewChange,
  source,
  onSourceChange,
  iconKind,
  onIconKindChange,
  action,
}: MaterialToolbarProps) {
  const segments: Segment<MaterialKind>[] = [
    { value: 'masters', label: 'Vorlagen', icon: 'slideMaster', count: counts.masters },
    { value: 'colors', label: 'Farben', icon: 'palette', count: counts.colors },
    { value: 'fonts', label: 'Schriften', icon: 'textFields', count: counts.fonts },
    { value: 'icons', label: 'Symbole', icon: 'shapes', count: counts.icons },
  ];

  return (
    <ViewToolbar
      filter={(iconOnly) => (
        <SegmentedControl
          label="Bibliothek filtern"
          segments={segments}
          value={kind}
          onChange={onKindChange}
          iconOnly={iconOnly}
        />
      )}
      action={action}
      search={
        <ViewSearch
          label="Bibliothek durchsuchen"
          value={query}
          onChange={onQueryChange}
          {...(kind === 'icons'
            ? { ...CONTENT_SEARCH.icons, content: true }
            : { ...CONTENT_SEARCH[kind], content, onContentChange })}
        />
      }
      sort={
        <div className="flex items-center gap-2">
          {kind === 'fonts' && (
            <Select
              aria-label="Schriften von"
              size="toolbar"
              value={source}
              onChange={onSourceChange}
              options={SOURCE_OPTIONS}
            />
          )}
          {kind === 'icons' ? (
            <Select
              aria-label="Symbole filtern"
              size="toolbar"
              value={iconKind}
              onChange={onIconKindChange}
              options={ICON_KIND_OPTIONS}
            />
          ) : (
            <Select
              aria-label="Sortieren nach"
              size="toolbar"
              value={byDesign(kind) && sort === 'size' ? 'name' : sort}
              onChange={onSortChange}
              options={sortOptions(kind)}
            />
          )}
        </div>
      }
      view={view}
      onViewChange={onViewChange}
    />
  );
}
