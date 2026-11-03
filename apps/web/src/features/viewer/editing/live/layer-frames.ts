import type { SlideLayers } from '@slider/shared';
import type { Frame } from './css';

// The query result outlives either rendering surface. Keep its original geometry with it so
// switching between flat/layer mode during a pending move cannot adopt the new box as origin.
const frames = new WeakMap<SlideLayers, ReadonlyMap<string, Frame>>();

/**
 * Where a slide's elements were at each step seen lately (`slideId|seq`): pictures drawn at a
 * step the edit state has moved past (an answer late, or an older one shown meanwhile) are placed
 * from where they were drawn – never from where the element is now (it showed at its old place).
 */
const seen = new Map<string, ReadonlyMap<string, Frame>>();
/** Steps kept per slide and then some; the oldest go first. */
const KEEP = 400;

type Placed = Frame & { id: string; children?: readonly Placed[] };
type EditState = {
  seq: number;
  slides: readonly { slideId: string; elements: readonly Placed[] }[];
};

/** Each element's frame – a group's parts too (Bearbeiten draws a group from them). */
const allOf = (elements: readonly Placed[]): Placed[] =>
  elements.flatMap((item) => (item.children ? [item, ...allOf(item.children)] : [item]));

const framesOf = (elements: readonly Placed[]): ReadonlyMap<string, Frame> =>
  new Map(
    allOf(elements).map((item) => [
      item.id,
      { bbox: { ...item.bbox }, rotation: item.rotation, flip: item.flip },
    ]),
  );

export function layerFrames(
  pictures: SlideLayers | undefined,
  state: EditState | undefined,
  slideId: string,
): ReadonlyMap<string, Frame> | undefined {
  // Each step's places, as the state passes through them.
  const slide = state?.slides.find((item) => item.slideId === slideId);
  if (state && slide) {
    const key = `${slideId}|${state.seq}`;
    if (!seen.has(key)) {
      seen.set(key, framesOf(slide.elements));
      if (seen.size > KEEP) seen.delete(seen.keys().next().value!);
    }
  }
  if (!pictures) return undefined;
  const known = frames.get(pictures);
  if (known) return known;
  const drawnAt = seen.get(`${slideId}|${pictures.seq}`);
  if (!drawnAt) return undefined;
  frames.set(pictures, drawnAt);
  return drawnAt;
}
