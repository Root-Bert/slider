import { useMemo } from 'react';
import { withSlideLines, type SnapLines } from '../stage/lib/rect-edit';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';
import { useLayoutGridLines } from './useLayoutGridLines';
import { useLayoutGuides } from './useTemplate';

/**
 * What a box on `slideId` is caught at while moved or resized: the slide's own edges and middles
 * always, the guides as shown – a template's its layout's own always (`TemplateLayer`), else the
 * slide's with „Hilfslinien zeigen“ on – and, with „Layout-Ansicht“ on, the edges of the layout
 * grid's columns and rows.
 */
export function useSnapLines(slideId: string): SnapLines {
  const { showGuides } = useViewerState();
  const { slides } = useViewerData();
  const layout = useLayoutGuides(slideId);
  const slideGuides = slides.find((slide) => slide.id === slideId)?.guides;
  const guides = layout ? layout.guides : showGuides ? slideGuides : undefined;
  const grid = useLayoutGridLines();
  return useMemo(() => {
    if (!guides?.length) return withSlideLines(grid);
    const at = (orientation: 'vertical' | 'horizontal') =>
      guides.filter((guide) => guide.orientation === orientation).map((guide) => guide.position);
    return withSlideLines({
      x: [...(grid?.x ?? []), ...at('vertical')],
      y: [...(grid?.y ?? []), ...at('horizontal')],
    });
  }, [guides, grid]);
}
