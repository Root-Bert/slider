import type { Rect, TurnedBox } from '@slider/shared';
import { cn } from '@/ui';
import { shapeOutlineStyle } from './lib/shape-outline-style';

/**
 * The AI at work on a thread (BER-183), on its mark on the slide: the AI reads the marked area.
 * A soft sage light sweeps across it, leaving a shimmer of dots in its wake, and four corner
 * brackets close in on the area like a viewfinder focusing (index.css: `ai-scan-*`). Positioned
 * in percent of the slide box; it takes no pointer.
 */
export function AiScan({
  rect,
  shape,
  pinOnCorner = false,
  raised = false,
}: {
  rect: Rect;
  /**
   * The element the thread hangs on, when the area is its box: drawn as its outline in box mode
   * is – a little off it, turned and tilted as it shows.
   */
  shape?: TurnedBox | null;
  /** The pin sits on the top left corner: it is that corner of the viewfinder, no bracket there. */
  pinOnCorner?: boolean;
  /** Over a sticker: its opaque box would hide it, also when lifted as emphasized. */
  raised?: boolean;
}) {
  // A shape reference can bind a small area too. Keep that area, and transform it as its mark
  // is transformed.
  const geometry = shapeOutlineStyle({ bbox: rect, rotation: shape?.rotation, tilt: shape?.tilt });
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute', raised && 'z-(--z-raised)')}
      style={geometry}
    >
      <div
        className={cn('absolute inset-0 overflow-hidden', shape ? 'rounded-mark' : 'rounded-thumb')}
        style={{ borderRadius: geometry.borderRadius }}
      >
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
