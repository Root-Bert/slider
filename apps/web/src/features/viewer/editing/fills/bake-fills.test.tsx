import { afterEach, expect, it, vi } from 'vitest';
import type { FillLayer } from '@slider/shared';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('evicts local images and decoded pictures, falling back to the server URL', async () => {
  vi.resetModules();
  let serial = 0;
  const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:fill-${++serial}`);
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const { rememberUpload, pictureUrl } = await import('./bake-fills');
  const file = new Blob(['picture']);
  rememberUpload('first', file);
  rememberUpload('first', file);
  expect(revoke).toHaveBeenCalledWith('blob:fill-1');
  for (let index = 0; index < 16; index++) rememberUpload(`image-${index}`, file);
  expect(revoke).toHaveBeenCalledWith('blob:fill-2');
  expect(pictureUrl('deck', 'first')).toContain('/decks/deck/edit/images/first');
  expect(create).toHaveBeenCalledTimes(18);

  // Decoded pictures are evicted too, not every image ever baked retained.
  vi.resetModules();
  const loaded: string[] = [];
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 1;
      naturalHeight = 1;
      onload: (() => void) | null = null;
      set src(url: string) {
        loaded.push(url);
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  const context = {
    globalAlpha: 1,
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
    callback(new Blob(['picture'])),
  );
  const { bakeFills } = await import('./bake-fills');
  const draw = (src: string) =>
    bakeFills(
      [{ type: 'image', src, fit: 'fill', opacity: 1, visible: true }] satisfies FillLayer[],
      { width: 1, height: 1 },
      'deck',
    );
  for (let index = 0; index < 17; index++) await draw(`image-${index}`);
  expect(loaded).toHaveLength(17);
  await draw('image-16');
  expect(loaded).toHaveLength(17);
  await draw('image-0');
  expect(loaded).toHaveLength(18);

  // A picture filled with a part chosen (as a picture element's): that part cut from it, laid
  // over the whole box – the square picture zoomed 2× around its top left quarter's middle.
  context.drawImage.mockClear();
  await bakeFills(
    [
      {
        type: 'image',
        src: 'image-0',
        fit: 'fill',
        focus: { x: 0.25, y: 0.25, zoom: 2 },
        opacity: 1,
        visible: true,
      },
    ] satisfies FillLayer[],
    { width: 1, height: 1 },
    'deck',
  );
  expect(context.drawImage).toHaveBeenCalledWith(
    expect.anything(),
    0,
    0,
    0.5,
    0.5,
    0,
    0,
    1600,
    1600,
  );

  // Drawn at once over the shape until LibreOffice's picture of it (`FillsDrawn`), cut to its area
  // inside its line (a mask): an ellipse, a star, an outline of its own, text or not – over the
  // area's upright bounds, turned or not, never mirrored (as LibreOffice lays a picture fill).
  const { fillArea } = await import('../picture-fit');
  const shape = (outline: Record<string, unknown>, stroke: number | null, more = {}) =>
    ({
      id: 'x',
      bbox: { x: 0, y: 0, w: 0.5, h: 0.5 },
      rotation: 0,
      tilt: null,
      flip: null,
      outline,
      paragraphs: ['Hallo'],
      look: { stroke: stroke === null ? null : { color: '#000000', width: stroke } },
      ...more,
    }) as unknown as Parameters<typeof fillArea>[0];
  const page = { width: 20, height: 10 };
  const svg = (area: ReturnType<typeof fillArea>) =>
    decodeURIComponent(/^url\("data:image\/svg\+xml,(.*)"\)$/.exec(area!.mask)![1]!);
  const ellipse = fillArea(shape({ type: 'ellipse' }, null), page)!;
  expect(ellipse.box).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
  expect(svg(ellipse)).toContain('viewBox="0 0 10 5"');
  expect(svg(ellipse)).not.toContain('stroke=');
  // 2 pt = 0.0706 cm of line taken off (half of it inside the outline).
  expect(svg(fillArea(shape({ type: 'ellipse' }, 2), page))).toContain('stroke-width="0.0706"');
  const star = svg(fillArea(shape({ type: 'star5' }, 2), page));
  expect(star.match(/[ML][\d.]+ [\d.]+/g)).toHaveLength(10);
  // A preset the browser does not know, without a path of its own: LibreOffice's picture then.
  expect(fillArea(shape({ type: 'cloud' }, null), page)).toBeNull();
  // An outline of its own (a quarter of an ellipse, as LibreOffice reads `B`): over its bounds.
  const quarter = {
    type: 'non-primitive',
    path: { path: 'B 0 0 21600 21600 21600 10800 10800 0 L 10800 10800 Z N' },
  };
  expect(fillArea(shape(quarter, null), page)!.box).toEqual({ x: 0.25, y: 0, w: 0.25, h: 0.25 });
  // Mirrored: the bounds mirrored, the outline in them too.
  const mirrored = fillArea(shape(quarter, null, { flip: { x: true, y: false } }), page)!;
  expect(mirrored.box).toEqual({ x: 0, y: 0, w: 0.25, h: 0.25 });
  // Turned a quarter: a 10 × 5 cm box lies 5 × 10 cm upright about its centre.
  const turned = fillArea(shape({ type: 'diamond' }, null, { rotation: 90 }), page)!.box;
  expect(turned.x).toBeCloseTo(0.125);
  expect(turned.y).toBeCloseTo(-0.25);
  expect(turned.w).toBeCloseTo(0.25);
  expect(turned.h).toBeCloseTo(1);
});

it('lays the colours between dragged handles onto the file’s line, cut where it ends', async () => {
  const { stopsBetween, stopsOnLine, colorAt } = await import('./gradient');
  const stops = [
    { color: '#000000', at: 0 },
    { color: '#ff0000', at: 0.5 },
    { color: '#ffffff', at: 1 },
  ];
  // Handles inside the line: the colours sit between them, in their place.
  const inside = stopsOnLine(stopsBetween(stops, 0, 1), 0.2, 0.6);
  expect(inside).toEqual([
    { color: '#000000', at: 0.2 },
    { color: '#ff0000', at: 0.4 },
    { color: '#ffffff', at: 0.6 },
  ]);
  // Taken back between those handles: as before.
  expect(stopsBetween(inside, 0.2, 0.6)).toEqual(stops);
  // Handles past both ends: cut at 0 and 1, in the colours the gradient has there.
  const past = stopsOnLine(stopsBetween(stops, 0, 1), -0.5, 1.5);
  expect(past.map((stop) => stop.at)).toEqual([0, 0.5, 1]);
  expect(past[0]!.color).toBe(colorAt(stops, 0.25));
  expect(past[2]!.color).toBe(colorAt(stops, 0.75));
  // See-through colours keep their opacity; one cut at an end has the opacity there.
  const fading = [
    { color: '#000000', at: 0 },
    { color: '#ffffff', at: 1, opacity: 0 },
  ];
  expect(stopsOnLine(stopsBetween(fading, 0, 1), -1, 1)).toEqual([
    { color: '#808080', at: 0, opacity: 0.5 },
    { color: '#ffffff', at: 1, opacity: 0 },
  ]);
  // Never more than eight colours: the least missed go.
  const many = Array.from({ length: 10 }, (_, i) => ({
    color: i % 2 ? '#ffffff' : '#000000',
    at: i / 9,
  }));
  expect(stopsOnLine(many, 0, 1)).toHaveLength(8);
});
