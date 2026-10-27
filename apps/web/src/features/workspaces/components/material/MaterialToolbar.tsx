import type { ReactNode } from 'react';
import {
  GlassPanel,
  IconButton,
  SegmentedControl,
  Select,
  TextField,
  Toolbar,
  type Segment,
} from '@/ui';
import type { MaterialView } from '../../lib/font-families';

/**
 * What the page shows – for now fonts, Slider's and the workspace's own; logos, images,
 * templates come later, "Alle" then spans them.
 */
export type MaterialKind = 'all' | 'slider-fonts' | 'workspace-fonts';
export type MaterialSort = 'name' | 'faces' | 'size';

const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'faces', label: 'Schnitte' },
  { value: 'size', label: 'Größe' },
] satisfies { value: MaterialSort; label: string }[];

interface MaterialToolbarProps {
  kind: MaterialKind;
  onKindChange: (kind: MaterialKind) => void;
  counts: Record<MaterialKind, number>;
  query: string;
  onQueryChange: (query: string) => void;
  sort: MaterialSort;
  onSortChange: (sort: MaterialSort) => void;
  view: MaterialView;
  onViewChange: (view: MaterialView) => void;
  /** Right next to the filter – the "Neue Schrift" button. */
  action?: ReactNode;
}

/** The reviews' toolbar for the workspace's material: filter and action left, search, sort, view right. */
export function MaterialToolbar({
  kind,
  onKindChange,
  counts,
  query,
  onQueryChange,
  sort,
  onSortChange,
  view,
  onViewChange,
  action,
}: MaterialToolbarProps) {
  const segments: Segment<MaterialKind>[] = [
    { value: 'all', label: 'Alle', icon: 'layers', count: counts.all },
    {
      value: 'slider-fonts',
      label: 'Slider-Schriften',
      icon: 'textFields',
      count: counts['slider-fonts'],
    },
    {
      value: 'workspace-fonts',
      label: 'Workspace-Schriften',
      icon: 'upload',
      count: counts['workspace-fonts'],
    },
  ];

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <GlassPanel className="p-1">
          <SegmentedControl
            label="Material filtern"
            segments={segments}
            value={kind}
            onChange={onKindChange}
          />
        </GlassPanel>
        {action}
      </div>
      {/* Below sm the search takes its own full-width row, sort and view sit under it. */}
      <div className="flex items-center gap-2 max-sm:w-full max-sm:flex-wrap">
        <search className="w-[300px] max-sm:w-full max-sm:basis-full">
          <TextField
            type="search"
            icon="search"
            aria-label="Material durchsuchen"
            placeholder="Material durchsuchen…"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query !== '') {
                event.preventDefault();
                onQueryChange('');
              }
            }}
            className="[&_input::-webkit-search-cancel-button]:hidden"
          />
        </search>
        <Select
          aria-label="Sortieren nach"
          size="toolbar"
          value={sort}
          onChange={onSortChange}
          options={SORT_OPTIONS}
        />
        <Toolbar role="group" label="Ansicht">
          <IconButton
            icon="gridView"
            label="Kachelansicht"
            size="sm"
            iconSize={18}
            active={view === 'grid'}
            onClick={() => onViewChange('grid')}
          />
          <IconButton
            icon="viewList"
            label="Listenansicht"
            size="sm"
            iconSize={18}
            active={view === 'list'}
            onClick={() => onViewChange('list')}
          />
        </Toolbar>
      </div>
    </div>
  );
}
