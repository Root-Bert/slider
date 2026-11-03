import { useEffect, useId, useRef, useState } from 'react';
import type { RectCorner } from './lib/rect-edit';
import {
  frameOutline,
  handleMarks,
  type BracketOpening,
  type FrameHandle,
} from './lib/frame-outline';
import { markTint } from './lib/mark-chrome';

interface FrameOutlineProps {
  /** The box's size (px). */
  width: number;
  height: number;
  color: string;
  /** Corners with a resize handle: the line runs out around each as a bracket. */
  corners: readonly RectCorner[];
  /**
   * Handles the pointer is near: only these open into brackets or the dome, the others stay plain
   * line. Unset, every one is open.
   */
  near?: readonly FrameHandle[];
  /** The turning handle: a dome over the top edge. */
  dome: boolean;
  /** Lit (emphasised or dragged): a soft band along the line, out around the handles too. */
  halo?: boolean;
  /** Under the pointer, not picked: the look of the box under the pointer (`ShapeOutline` target). */
  hovered?: boolean;
  /** How large a px of the box shows on screen (`useFrameSize`). */
  scale?: number;
  /**
   * The shape's own outline (a triangle), in screen px of the box: the line follows it, the
   * handles stand on their own at the box's corners.
   */
  shape?: string | null;
}

/** How long a bracket takes to open or close (ms). */
const OPENING_MS = 160;

/**
 * Each handle's bracket or dome opened as far as it has got on its way to `target` – the line
 * growing out and back, eased; at once where motion is reduced.
 */
function useOpening(corners: readonly FrameHandle[], near: readonly FrameHandle[] | undefined) {
  const target = (corner: FrameHandle) => (!near || near.includes(corner) ? 1 : 0);
  const key = corners.map((corner) => `${corner}${target(corner)}`).join();
  const [opening, setOpening] = useState<BracketOpening>(() =>
    Object.fromEntries(corners.map((corner) => [corner, target(corner)])),
  );
  const current = useRef(opening);
  current.current = opening;
  useEffect(() => {
    const goal: BracketOpening = Object.fromEntries(
      corners.map((corner) => [corner, target(corner)]),
    );
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setOpening(goal);
      return;
    }
    const from = { ...current.current };
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const delta = (now - last) / OPENING_MS;
      last = now;
      let moving = false;
      const next: BracketOpening = {};
      for (const corner of corners) {
        const at = from[corner] ?? 0;
        const to = goal[corner]!;
        next[corner] = to > at ? Math.min(to, at + delta) : Math.max(to, at - delta);
        if (next[corner] !== to) moving = true;
      }
      Object.assign(from, next);
      setOpening({ ...next });
      if (moving) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
    // `key` holds the corners and their targets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return opening;
}

/** Eased: the line shoots out and settles into the bracket. */
const ease = (t: number) => 1 - (1 - t) ** 3;

/**
 * A picked slide element's line: one stroke centred on its edge that runs out around its handles,
 * so it never crosses one. The line alone shows them, nothing filled; the grabbing is left to the
 * spans above it. A handle the pointer is not near is plain line, its bracket or dome growing out
 * of it as the pointer comes. Drawn in screen px (`scale`): on a zoomed
 * or spread 3D slide its line, brackets and halo are as thick and as large as on the flat one.
 */
export function FrameOutline({
  width,
  height,
  color,
  corners,
  near,
  dome,
  halo = false,
  hovered = false,
  scale = 1,
  shape = null,
}: FrameOutlineProps) {
  const handles: FrameHandle[] = dome ? [...corners, 'turn'] : [...corners];
  const opening = useOpening(handles, near);
  const eased: BracketOpening = Object.fromEntries(
    handles.map((handle) => [handle, ease(opening[handle] ?? 1)]),
  );
  const line = shape ?? frameOutline(width * scale, height * scale, corners, dome, eased);
  const marks = shape ? handleMarks(width * scale, height * scale, corners, dome, eased) : '';
  const outside = `frame-halo-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
      width={Math.max(width, 1)}
      height={Math.max(height, 1)}
    >
      <g transform={`scale(${1 / scale})`}>
        {halo && (
          // As `frameHalo`: 3px of the colour at 30% beyond the line – only outside the box, so
          // it never lies over the element (an ellipse touching its box looked cut flat by it).
          <>
            <mask
              id={outside}
              maskUnits="userSpaceOnUse"
              x="-50"
              y="-50"
              width={width * scale + 100}
              height={height * scale + 100}
            >
              <rect
                x="-50"
                y="-50"
                width={width * scale + 100}
                height={height * scale + 100}
                fill="white"
              />
              {shape ? (
                <path d={shape} fill="black" />
              ) : (
                <rect width={width * scale} height={height * scale} fill="black" />
              )}
            </mask>
            <path
              data-frame-halo=""
              d={`${line} ${marks}`}
              fill="none"
              stroke={color}
              strokeOpacity={0.3}
              strokeWidth={8}
              strokeLinejoin="round"
              mask={`url(#${outside})`}
            />
          </>
        )}
        <path
          d={line}
          // Under the pointer, not picked: as the box under the pointer shows in review
          // (`ShapeOutline` target) – its thinner line and faint fill, the handles on top.
          fill={hovered ? markTint(color) : 'none'}
          stroke={color}
          strokeWidth={hovered ? 1.5 : 2}
          strokeLinejoin="round"
        />
        {marks && (
          <path
            d={marks}
            fill="none"
            stroke={color}
            strokeWidth={hovered ? 1.5 : 2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
      </g>
    </svg>
  );
}
