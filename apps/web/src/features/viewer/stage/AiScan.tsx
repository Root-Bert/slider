import type { Rect } from '@slider/shared';

/**
 * The AI at work on a thread (BER-183), on its mark on the slide: the AI reads the marked area.
 * A soft sage light sweeps across it, leaving a shimmer of dots in its wake, and four corner
 * brackets close in on the area like a viewfinder focusing (index.css: `ai-scan-*`). Positioned
 * in percent of the slide box; it takes no pointer.
 */
export function AiScan({
  rect,
  pinOnCorner = false,
}: {
  rect: Rect;
  /** The pin sits on the top left corner: it is that corner of the viewfinder, no bracket there. */
  pinOnCorner?: boolean;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute"
      style={{
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.w * 100}%`,
        height: `${rect.h * 100}%`,
      }}
    >
      <div className="absolute inset-0 overflow-hidden rounded-thumb">
        <span className="ai-scan-tint absolute inset-0" />
        <span className="ai-scan-wash absolute inset-0" />
        {/* The dots stay put; only the light behind them moves. */}
        <span className="ai-scan-dots absolute inset-0">
          <span className="ai-scan-wash ai-scan-wash-bright absolute inset-0" />
        </span>
      </div>
      {CORNERS.filter((corner) => !(pinOnCorner && corner === 'ai-scan-corner-tl')).map(
        (corner) => (
          <span key={corner} className={`ai-scan-corner absolute ${corner}`} />
        ),
      )}
    </div>
  );
}

/** The viewfinder's brackets, one per corner (spelled out so Tailwind sees the classes). */
const CORNERS = [
  'ai-scan-corner-tl',
  'ai-scan-corner-tr',
  'ai-scan-corner-br',
  'ai-scan-corner-bl',
] as const;
