import { useEffect, useState } from 'react';
import { centredWays, type Cover, type SlideZoom } from '../lib/slide-zoom';

/** Not moved for this long (ms), the slide is let go of: its lines go (the wheel has no release). */
const STILL_MS = 350;

/**
 * The centre lines of its frame a slide zoomed out lies on while it is moved (`snappedCentre`
 * catches it there): `'x'`, `'y'`, both or none – shown as long as it moves along them, as the
 * lines a dragged element is caught on; gone once it rests or leaves them. Zoomed (another
 * scale), nothing was moved: none.
 */
export function useCentreLines(
  zoom: Pick<SlideZoom, 'scale' | 'x' | 'y'> | null,
  cover: Cover,
): string {
  const scale = zoom?.scale ?? 1;
  const ways = zoom && scale < 1 ? centredWays(zoom, cover) : '';
  const at = zoom ? `${zoom.x},${zoom.y}` : '';
  const [seen, setSeen] = useState({ scale, at });
  const [moving, setMoving] = useState(false);
  if (seen.scale !== scale || seen.at !== at) {
    setSeen({ scale, at });
    setMoving(seen.scale === scale);
  }
  useEffect(() => {
    if (!moving) return;
    const rest = setTimeout(() => setMoving(false), STILL_MS);
    return () => clearTimeout(rest);
  }, [moving, at]);
  return moving ? ways : '';
}
