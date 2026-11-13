import type { EditableElement, LiveElement } from '@slider/shared';
import type { TextFit } from '../editing-context';
import { useLayoutEffect, useMemo, type RefObject } from 'react';
import { loadFonts } from './fonts';
import { measureTextSize } from './text-size';
import { LiveElementView } from './render';

/**
 * The picked text drawn unseen, to read its own size: as wide as its longest line, and how high
 * its box is around it at a width (`measureTextSize`) – read when its box is resized or fitted to
 * it, and kept in `onMeasure` („An Text anpassen“): its width, its height at the box's width and
 * at its own. Its parent spans the slide.
 */
export function TextSizeMeasure({
  element,
  live,
  nodeRef,
  onMeasure,
}: {
  element: EditableElement;
  live: LiveElement;
  nodeRef: RefObject<HTMLDivElement | null>;
  onMeasure: (elementId: string, fit: TextFit | null) => void;
}) {
  // At its own size: shrunk to fit, a text would be as high as its box.
  const own = useMemo(() => (live.shrink ? { ...live, shrink: false } : live), [live]);
  // Measured anew as what it is measured by changes – not each time the element is read anew.
  const { id } = element;
  const { w, h } = element.bbox;
  const flipX = element.flip?.x ?? false;
  const flipY = element.flip?.y ?? false;
  useLayoutEffect(() => {
    const node = nodeRef.current;
    const layer = node?.parentElement;
    if (!node || !layer) return;
    const shown = { bbox: { x: 0, y: 0, w, h }, flip: { x: flipX, y: flipY }, live: own };
    const update = () => {
      const text = measureTextSize(node, shown);
      onMeasure(
        id,
        text && {
          width: text.width,
          height: text.heightAt(w),
          fittedHeight: text.heightAt(text.width),
        },
      );
    };
    update();
    // Measured in its own fonts: laid out anew as they come, and as the slide is resized – the
    // text itself watched, the box may stay as high when it changes.
    let gone = false;
    void loadFonts(own).then(() => !gone && update());
    const observer = new ResizeObserver(update);
    observer.observe(node.querySelector('[data-live-text]') ?? node);
    observer.observe(layer);
    return () => {
      gone = true;
      observer.disconnect();
      onMeasure(id, null);
    };
  }, [id, w, h, flipX, flipY, own, nodeRef, onMeasure]);
  return <LiveElementView ref={nodeRef} element={element} live={own} textOnly />;
}
