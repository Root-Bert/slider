import type {
  EditableElement,
  ElementFlip,
  ElementTilt,
  SlideLayers,
  SlideOperation,
} from '@slider/shared';
import { useEffect, useRef } from 'react';
import { useSlideLayers, useUploadEditImage } from '@/lib/api';
import { useViewerData } from '../../state/viewer-data';
import { useOutboxSending } from '../edit-outbox-app';
import { useEditing } from '../editing-context';
import { bakeTilt } from './bake-tilt';
import { isTilted, mirroredOnScreen } from './tilt-math';

/** A picture's address without its query (signed links change, the picture does not). */
const sourceOf = (url: string) => url.split('?')[0] ?? url;

/** An element's picture alone and where it lies on the slide. */
export interface AlonePicture {
  url: string;
  box: NonNullable<SlideLayers['layers'][number]['box']>;
}

/**
 * The slide's elements alone, as drawn at the deck's current step – what a tilted picture is drawn
 * from. Asked for in the background while `enabled` (an element picked, or the turning handle of one
 * aimed at – so a tilt starts at once; the server takes the slide apart with LibreOffice for it).
 */
export function useAlonePictures(
  slideId: string,
  enabled: boolean,
): (elementId: string) => AlonePicture | null {
  const editing = useEditing();
  const { deck } = useViewerData();
  const seq = editing.state?.seq;
  const parts: SlideLayers | undefined = useSlideLayers(deck.id, slideId, seq, {
    enabled,
    priority: 'background',
  }).data;
  return (elementId) => {
    const layer =
      parts?.seq === seq ? parts?.layers.find((item) => item.elementId === elementId) : null;
    return layer?.url && layer.box ? { url: layer.url, box: layer.box } : null;
  };
}

/**
 * Draws the element tilted, uploads that picture and tilts it in the file – or lays it flat.
 * Tilted over the edge (`mirror`, on screen): mirrored and turned so in the file too, in the same
 * step, its picture drawn from its picture alone mirrored so.
 */
export function useTiltElement() {
  const editing = useEditing();
  const { deck } = useViewerData();
  const upload = useUploadEditImage(deck.id);
  const { width, height } = editing.pageSize;
  return async (
    element: EditableElement,
    tilt: ElementTilt,
    alone: AlonePicture,
    mirror?: ElementFlip,
  ) => {
    const { bbox } = element;
    const mirrored: SlideOperation[] =
      mirror && element.flip
        ? [
            {
              type: 'setBox',
              elementId: element.id,
              box: bbox,
              ...mirroredOnScreen(element.rotation, element.flip, mirror),
            },
          ]
        : [];
    if (!isTilted(tilt)) {
      await editing.apply([
        ...mirrored,
        { type: 'setTilt', elementId: element.id, tilt: null, picture: null },
      ]);
      return;
    }
    const baked = await bakeTilt({
      url: alone.url,
      box: alone.box,
      centre: { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 },
      tilt,
      aspect: width / height,
      mirror: mirrored.length > 0 ? mirror : undefined,
    });
    const image = await upload.mutateAsync(
      new File([baked.blob], 'gekippt.png', { type: 'image/png' }),
    );
    await editing.apply([
      ...mirrored,
      {
        type: 'setTilt',
        elementId: element.id,
        tilt: { x: tilt.x, y: tilt.y, source: sourceOf(alone.url) },
        picture: { imageId: image.imageId, box: baked.box },
      },
    ]);
  };
}

/**
 * A tilted element changed since its picture was drawn (its text, look, size or turn): drawn
 * tilted anew from its new picture alone, once that is there. `onDone`: its tilted picture is
 * as the element is now (drawn anew, or nothing to draw).
 */
export function useTiltRefresh(element: EditableElement, slideId: string, onDone?: () => void) {
  const editing = useEditing();
  const { deck } = useViewerData();
  // An edit (or a take-back) on its way: the picture may not be the element's as it will be.
  const busy = useOutboxSending(deck.id) || editing.busy;
  const tilt = element.tilt;
  const alone = useAlonePictures(slideId, !!tilt)(element.id);
  const tiltElement = useTiltElement();
  const tried = useRef<string | null>(null);
  const source = alone ? sourceOf(alone.url) : null;
  const stale = !!tilt && !!source && tilt.source !== source && !busy;
  const fresh = !tilt || (!!source && tilt.source === source && !busy);
  const latest = useRef({ tiltElement, element, alone, onDone });
  useEffect(() => {
    latest.current = { tiltElement, element, alone, onDone };
  });
  useEffect(() => {
    if (fresh) latest.current.onDone?.();
  }, [fresh]);
  useEffect(() => {
    if (!stale || !source || tried.current === source) return;
    tried.current = source;
    const { tiltElement: run, element: now, alone: picture } = latest.current;
    // Not drawn: given up on, it is not waited for any longer.
    if (now.tilt && picture)
      void run(now, now.tilt, picture).catch(() => latest.current.onDone?.());
  }, [stale, source]);
}
