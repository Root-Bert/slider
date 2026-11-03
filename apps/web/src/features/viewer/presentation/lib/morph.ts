import type { EditableElement, SlideLayers } from '@slider/shared';

/*
 * The morph transition (Slider's own, in the file a crossfade): the slide left and the one coming
 * in, each taken apart by LibreOffice (its page without elements, each element alone – the layers
 * view's pictures); an element on both glides from where it was to where it is now, changing its
 * look on the way, one only on the slide left fades out, one only on the new slide fades in. Who
 * is who across slides: `morphKey` (an element copied with its slide keeps the first one's id).
 */

type Box = { x: number; y: number; w: number; h: number };

/** One element's picture and where it lies on its slide (0–1). */
export interface MorphPicture {
  url: string;
  box: Box;
}

export interface MorphPart {
  key: string;
  from: MorphPicture | null;
  to: MorphPicture | null;
}

export interface MorphPlan {
  from: string;
  to: string;
  /** On the slide left only, bottom first: they fade out. */
  leaving: MorphPart[];
  /** On the new slide, bottom first – met on the slide left too (`from`) or new. */
  coming: MorphPart[];
}

type MorphElement = Pick<EditableElement, 'id' | 'morphKey'> &
  Partial<Pick<EditableElement, 'name' | 'kind' | 'paragraphs'>>;

const keyOf = (element: MorphElement) => element.morphKey ?? element.id;

/** The same text in the same kind of element (PowerPoint matches so too). */
const textOf = (element: MorphElement | undefined) => {
  const text = element?.paragraphs?.join('\n').trim();
  return text ? `${element!.kind}:${text}` : null;
};
const nameOf = (element: MorphElement | undefined) =>
  element?.name ? `${element.kind}:${element.name}` : null;

function pictures(layers: SlideLayers, elements: readonly MorphElement[]) {
  const byId = new Map(elements.map((element) => [element.id, element]));
  return layers.layers.flatMap((layer) => {
    if (!layer.url || !layer.box) return [];
    const element = byId.get(layer.elementId);
    return [
      {
        key: element ? keyOf(element) : layer.elementId,
        text: textOf(element),
        name: nameOf(element),
        url: layer.url,
        box: layer.box,
      },
    ];
  });
}

/**
 * What glides, fades out and fades in from slide `from` to slide `to`. Met by key first (copied
 * with its slide or pasted: `morphKey`; two of one key met in order), then what is left by the
 * same text in the same kind of element, then by the same name in the same kind.
 */
export function morphPlan(
  from: SlideLayers,
  fromElements: readonly MorphElement[],
  to: SlideLayers,
  toElements: readonly MorphElement[],
): MorphPlan {
  const before = pictures(from, fromElements);
  const after = pictures(to, toElements);
  const met = new Set<number>();
  const match = new Map<number, number>();
  for (const field of ['key', 'text', 'name'] as const) {
    after.forEach((item, j) => {
      if (match.has(j) || item[field] === null) return;
      const at = before.findIndex((was, i) => !met.has(i) && was[field] === item[field]);
      if (at < 0) return;
      met.add(at);
      match.set(j, at);
    });
  }
  const coming = after.map(({ key, url, box }, j) => {
    const was = before[match.get(j) ?? -1];
    return { key, from: was ? { url: was.url, box: was.box } : null, to: { url, box } };
  });
  const leaving = before
    .filter((_, i) => !met.has(i))
    .map(({ key, url, box }) => ({ key, from: { url, box }, to: null }));
  return { from: from.background, to: to.background, leaving, coming };
}

/** Every picture the plan shows – decoded before it plays. */
export const morphPictures = (plan: MorphPlan): string[] => [
  plan.from,
  plan.to,
  ...[...plan.leaving, ...plan.coming].flatMap((part) =>
    [part.from?.url, part.to?.url].filter((url): url is string => !!url),
  ),
];
