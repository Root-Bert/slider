import { gridTracks } from '@/features/viewer';
import { GUIDE_COLORS } from '@/lib/palette';
import type { PageMetrics } from '../lib/paginate';
import { usePageGuides, type Overflow } from './guides';

const CM = 96 / 2.54;

/**
 * „Hilfslinien“ and „Layout-Ansicht“ over every page, as over a slide: the margins as thin lines
 * across the whole sheet (the head's and foot's edges, where there are those), what sticks out
 * over them outlined and hatched; the grid's columns and rows faint in the text's room. Never a
 * pointer target.
 */
export function PageGuides({
  pages,
  metrics,
  overflows,
}: {
  pages: number;
  metrics: PageMetrics;
  overflows: readonly Overflow[];
}) {
  const { guides, grid, layout } = usePageGuides();
  if (!guides && !grid) return null;
  const { width, height, left, right, top, bottom, head, foot, pitch } = metrics;
  const roomWidth = width - left - right;
  const roomHeight = height - top - bottom - foot;
  const fill = `color-mix(in srgb, ${GUIDE_COLORS.guide} 12%, transparent)`;
  const columns = gridTracks(layout.columns, roomWidth / CM);
  const rows = gridTracks(layout.rows, roomHeight / CM);
  const line = (key: string, style: React.CSSProperties) => (
    <div key={key} className="absolute" style={{ backgroundColor: GUIDE_COLORS.guide, ...style }} />
  );
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-1 print:hidden">
      {Array.from({ length: pages }, (_, index) => {
        const y = index * pitch;
        return (
          <div key={index} className="absolute inset-x-0" style={{ top: y, height }}>
            {grid &&
              columns.map((track, at) => (
                <div
                  key={`c${at}`}
                  className="absolute"
                  style={{
                    left: left + track.start * roomWidth,
                    width: track.size * roomWidth,
                    top,
                    height: roomHeight,
                    backgroundColor: fill,
                  }}
                />
              ))}
            {grid &&
              rows.map((track, at) => (
                <div
                  key={`r${at}`}
                  className="absolute"
                  style={{
                    top: top + track.start * roomHeight,
                    height: track.size * roomHeight,
                    left,
                    width: roomWidth,
                    backgroundColor: fill,
                  }}
                />
              ))}
            {guides && (
              <>
                {line('l', { left, top: 0, bottom: 0, width: 1 })}
                {line('r', { left: width - right - 1, top: 0, bottom: 0, width: 1 })}
                {line('t', { top, left: 0, right: 0, height: 1 })}
                {line('b', { top: height - bottom - 1, left: 0, right: 0, height: 1 })}
                {head > 0 &&
                  line('h', { top: top - head, left: 0, right: 0, height: 1, opacity: 0.5 })}
                {foot > 0 &&
                  line('f', {
                    top: height - bottom - foot,
                    left: 0,
                    right: 0,
                    height: 1,
                    opacity: 0.5,
                  })}
              </>
            )}
          </div>
        );
      })}
      {guides &&
        overflows.map((box) => (
          <div
            key={box.key}
            className="absolute"
            style={{
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              outline: `1.5px solid ${GUIDE_COLORS.overflow}`,
              backgroundImage: `repeating-linear-gradient(135deg, color-mix(in srgb, ${GUIDE_COLORS.overflow} 25%, transparent) 0 2px, transparent 2px 7px)`,
            }}
          />
        ))}
    </div>
  );
}
