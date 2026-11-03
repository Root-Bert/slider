import type { EditableElement, FillLayer } from '@slider/shared';
import { useViewerData } from '../../state/viewer-data';
import { useEditing } from '../editing-context';
import { drawsFillsAtOnce, fillArea, pictureFit } from '../picture-fit';
import { useSetFills } from './useFills';

/**
 * The layer of a shape's fill whose part a double click chooses on the slide („Ausschnitt“, as
 * Figma crops an image fill): its top picture shown – `-1` for none, or for a shape with text
 * (typed in on a double click) or tilted.
 */
export function fillToCrop(element: EditableElement): number {
  if (element.tilt || element.picture) return -1;
  if (element.paragraphs?.some((paragraph) => paragraph.trim())) return -1;
  return (element.look?.fills ?? []).findLastIndex(
    (layer) => layer.visible && layer.type === 'image',
  );
}

/**
 * Starts choosing the part of a shape's picture fill on the slide (`fillToCrop`): taken, the
 * layer fills the shape with it – shown at once over the shape (`FillsDrawn`) until LibreOffice's
 * picture of it. `false` when it has none to choose.
 */
export function useCropFill(slideId: string) {
  const editing = useEditing();
  const { slides } = useViewerData();
  const set = useSetFills();
  return (element: EditableElement): boolean => {
    const layer = fillToCrop(element);
    const picture = element.look?.fills[layer];
    if (picture?.type !== 'image') return false;
    pictureFit.crop(element.id, {
      layer,
      src: picture.src,
      fit: picture.fit,
      focus: picture.focus ?? null,
      take: (focus) => {
        // The shape as it is now: taken a while after it began.
        const now = editing.elementsOf(slideId).find((item) => item.id === element.id) ?? element;
        const fills = now.look?.fills ?? [];
        const own = fills[layer];
        if (own?.type !== 'image') return;
        const next = fills.map((item, at): FillLayer =>
          at === layer ? { ...own, fit: 'fill', focus } : item,
        );
        if (drawsFillsAtOnce(next) && fillArea(now, editing.pageSize)) {
          const since = slides.find((slide) => slide.id === slideId)?.imageUrl ?? null;
          pictureFit.drawUntilNew(now.id, slideId, since, next);
        }
        void set(now, next);
      },
    });
    return true;
  };
}
