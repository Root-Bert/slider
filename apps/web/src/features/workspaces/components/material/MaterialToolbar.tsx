import type { ReactNode } from 'react';
import { SegmentedControl, Select, type Segment } from '@/ui';
import type { MaterialView } from '../../lib/font-families';
import { ViewSearch } from '../ViewSearch';
import { ViewToolbar } from '../ViewToolbar';

/**
 * What the page shows, in the filter's order – the workspace's templates (its slide masters),
 * its own fonts and Slider's; logos and images come later.
 */
export type MaterialKind = 'masters' | 'workspace-fonts' | 'slider-fonts';
export type MaterialSort = 'name' | 'faces' | 'size';

/** `faces`: a font's faces, a design's layouts. Designs show no size, so they sort by none. */
const sortOptions = (kind: MaterialKind) =>
  (
    [
      { value: 'name', label: 'Name' },
      { value: 'faces', label: kind === 'masters' ? 'Layouts' : 'Schnitte' },
      { value: 'size', label: 'Größe' },
    ] satisfies { value: MaterialSort; label: string }[]
  ).filter((option) => kind !== 'masters' || option.value !== 'size');

/** What the search's button adds to the names: a template's layouts, a font's stand-ins and origin. */
const CONTENT_SEARCH = {
  masters: {
    contentLabel: 'Auch Layouts durchsuchen',
    contentPlaceholder: 'Namen, Layouts…',
  },
  fonts: {
    contentLabel: 'Auch ersetzte Schriften und Herkunft durchsuchen',
    contentPlaceholder: 'Namen, ersetzte Schriften…',
  },
};

interface MaterialToolbarProps {
  kind: MaterialKind;
  onKindChange: (kind: MaterialKind) => void;
  counts: Record<MaterialKind, number>;
  query: string;
  onQueryChange: (query: string) => void;
  /** Layouts, stand-ins and origins are searched too, not only the names. */
  content: boolean;
  onContentChange: (content: boolean) => void;
  sort: MaterialSort;
  onSortChange: (sort: MaterialSort) => void;
  view: MaterialView;
  onViewChange: (view: MaterialView) => void;
  /** Right next to the filter – the "Hinzufügen" menu. */
  action?: ReactNode;
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
  action,
}: MaterialToolbarProps) {
  const segments: Segment<MaterialKind>[] = [
    { value: 'masters', label: 'Vorlagen', icon: 'slideMaster', count: counts.masters },
    {
      value: 'workspace-fonts',
      label: 'Workspace-Schriften',
      icon: 'fontFile',
      count: counts['workspace-fonts'],
    },
    {
      value: 'slider-fonts',
      label: 'Slider-Schriften',
      icon: 'textFields',
      count: counts['slider-fonts'],
    },
  ];

  return (
    <ViewToolbar
      filter={
        <SegmentedControl
          label="Bibliothek filtern"
          segments={segments}
          value={kind}
          onChange={onKindChange}
        />
      }
      action={action}
      search={
        <ViewSearch
          label="Bibliothek durchsuchen"
          {...CONTENT_SEARCH[kind === 'masters' ? 'masters' : 'fonts']}
          value={query}
          onChange={onQueryChange}
          content={content}
          onContentChange={onContentChange}
        />
      }
      sort={
        <Select
          aria-label="Sortieren nach"
          size="toolbar"
          value={kind === 'masters' && sort === 'size' ? 'name' : sort}
          onChange={onSortChange}
          options={sortOptions(kind)}
        />
      }
      view={view}
      onViewChange={onViewChange}
    />
  );
}
