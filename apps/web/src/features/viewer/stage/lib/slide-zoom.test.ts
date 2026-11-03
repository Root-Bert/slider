import { describe, expect, it } from 'vitest';
import {
  centredWays,
  CENTRE_SNAP_PX,
  panBy,
  SLIDE_ZOOM_MIN,
  snappedCentre,
  zoomAround,
  zoomedBox,
} from './slide-zoom';

const middle = { x: 0.5, y: 0.5 };

describe('zoomAround', () => {
  it('zooms out to half around the pointer, the slide whole in its frame', () => {
    const out = zoomAround(null, 0.5, middle);
    expect(out).toEqual({ scale: 0.5, x: -0.5, y: -0.5 });
    expect(zoomedBox(out!, 800, 450)).toEqual({ left: 200, top: 112.5, width: 400, height: 225 });
    // Towards a corner: the spot under the pointer stays, the slide stays in the frame.
    const corner = zoomAround(null, 0.5, { x: 0.1, y: 0.9 })!;
    expect(corner.x).toBeCloseTo(-0.1);
    expect(corner.y).toBeCloseTo(-0.9);
    expect(zoomAround(null, 0.5, { x: 0, y: 1.2 })?.y).toBe(-1);
    // No further out than half.
    expect(zoomAround(out, 0.5, middle)?.scale).toBe(SLIDE_ZOOM_MIN);

    // It stops at 1× on the way through, and ends the zoom there.
    expect(zoomAround({ scale: 0.8, x: -0.125, y: -0.125 }, 2, middle)).toBeNull();
    const zoomedIn = zoomAround(null, 2, middle);
    expect(zoomedIn?.scale).toBe(2);
    expect(zoomAround(zoomedIn, 0.25, middle)).toBeNull();
    // From 1× on, it goes on.
    expect(zoomAround(null, 0.8, middle)?.scale).toBeCloseTo(0.8);

    // Moving a slide smaller than its frame keeps it whole in it.
    const moved = panBy(out!, 0.2, -0.1);
    expect(moved.x).toBeCloseTo(-0.1);
    expect(moved.y).toBeCloseTo(-0.7);
    expect(panBy(out!, 5, -5)).toMatchObject({ x: 0, y: -1 });
  });
});

describe('snappedCentre', () => {
  // At 0.5× in a 1000 × 500 frame the slide is 500 × 250 px: centred, its view starts at -0.5.
  const centred = { scale: 0.5, x: -0.5, y: -0.5 };

  it('catches a slide zoomed out close to the middle of its frame, each way, and names the ways', () => {
    const near = (CENTRE_SNAP_PX - 1) / 500;
    expect(snappedCentre({ ...centred, x: -0.5 + near }, 1000, 500)).toEqual(centred);
    const nearY = (CENTRE_SNAP_PX - 1) / 250;
    expect(snappedCentre({ ...centred, y: -0.5 - nearY }, 1000, 500)).toEqual(centred);
    // Farther off it stays where it was moved.
    const far = { ...centred, x: -0.5 + (CENTRE_SNAP_PX + 2) / 500, y: -0.2 };
    expect(snappedCentre(far, 1000, 500)).toEqual(far);
    // No centring a way the slide fills its frame.
    const zoomedIn = { scale: 2, x: 0.25, y: 0.25 };
    expect(snappedCentre({ ...zoomedIn, x: 0.251 }, 1000, 500)).toEqual({ ...zoomedIn, x: 0.251 });

    const caught = snappedCentre({ scale: 0.5, x: -0.49, y: -0.2 }, 1000, 500);
    expect(centredWays(caught)).toBe('x');
    expect(centredWays({ scale: 0.5, x: -0.5, y: -0.5 })).toBe('xy');
    expect(centredWays({ scale: 0.5, x: -0.3, y: -0.2 })).toBe('');
    // As large as its frame: nothing to centre.
    expect(centredWays({ scale: 1, x: 0, y: 0 })).toBe('');
  });
});
