import type { LayoutGrid } from '@slider/shared';
import { useEditing } from '../editing/editing-context';
import { useViewerState } from '../state/viewer-state';
import { gridTracks } from './layout-grid';

/**
 * „Layout-Ansicht“: a template's layout grid over a slide, as in Figma – its columns and rows in
 * the viewer's own colour, faint. While one direction is being set, only it shows. Never a
 * pointer target.
 */
export function LayoutGridLayer({ grid, color }: { grid: LayoutGrid; color: string }) {
  const { pageSize } = useEditing();
  const { layoutGridAxis } = useViewerState();
  const fill = `color-mix(in srgb, ${color} 12%, transparent)`;
  const columns = layoutGridAxis === 'rows' ? [] : gridTracks(grid.columns, pageSize.width);
  const rows = layoutGridAxis === 'columns' ? [] : gridTracks(grid.rows, pageSize.height);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0" data-layout-grid>
      {columns.map((track, index) => (
        <div
          key={`c${index}`}
          className="absolute inset-y-0"
          style={{
            left: `${track.start * 100}%`,
            width: `${track.size * 100}%`,
            backgroundColor: fill,
          }}
        />
      ))}
      {rows.map((track, index) => (
        <div
          key={`r${index}`}
          className="absolute inset-x-0"
          style={{
            top: `${track.start * 100}%`,
            height: `${track.size * 100}%`,
            backgroundColor: fill,
          }}
        />
      ))}
    </div>
  );
}
