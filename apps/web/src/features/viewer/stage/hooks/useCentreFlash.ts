import { useState } from 'react';
import { centredWays, type Cover, type SlideZoom } from '../lib/slide-zoom';

/**
 * A slide zoomed out and moved, caught in the middle of its frame (`snappedCentre`): a count per
 * way that goes up each time it is caught anew (a way not centred before, at the same zoom) –
 * for every way it is centred then. Zoomed to the middle, or centred all along, it stays.
 * `0`: never pulsed that way yet.
 */
export function useCentreFlash(
  zoom: Pick<SlideZoom, 'scale' | 'x' | 'y'> | null,
  cover: Cover,
): { x: number; y: number } {
  const scale = zoom?.scale ?? 1;
  const ways = zoom && scale < 1 ? centredWays(zoom, cover) : '';
  const [seen, setSeen] = useState({ scale, ways, x: 0, y: 0 });
  if (seen.scale !== scale || seen.ways !== ways) {
    // Caught anew one way, it pulses every way it is centred now: in the very middle, both.
    const anew = seen.scale === scale && [...ways].some((way) => !seen.ways.includes(way)) ? 1 : 0;
    const pulse = (way: 'x' | 'y') => (ways.includes(way) ? anew : 0);
    setSeen({ scale, ways, x: seen.x + pulse('x'), y: seen.y + pulse('y') });
  }
  return { x: seen.x, y: seen.y };
}
