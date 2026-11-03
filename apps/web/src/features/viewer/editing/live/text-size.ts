import { mirroredInset, type EditableElement } from '@slider/shared';
import type { TextSize } from '../../stage/lib/rect-edit';

/**
 * The text's size as `TextSizeMeasure` draws `element`, of the slide – the copy laid out anew for
 * each width and put back after. `null` before it is drawn. A height is the box's around the
 * text: its padding in, and a drawn shape's text area (a share of the box, `boxCss`) around that
 * – the box as high as that, LibreOffice lays the text out in it exactly. Each laying out forces
 * the browser to lay the page out at once, so it is taken once per resize (the text stays the
 * same while dragging): the width read here, a height once per width asked (`heightAt`, kept).
 */
export function measureTextSize(
  node: HTMLDivElement | null,
  element: Pick<EditableElement, 'bbox' | 'flip' | 'live'>,
): TextSize | null {
  const layer = node?.parentElement;
  if (!node || !layer) return null;
  // Read once: laying the copy out does not change the slide's size. Read to the fraction of a
  // pixel (`offsetHeight` rounds – a pixel of a small slide is a point of the text), the copy
  // unturned and untilted while it is read.
  const { width: layerWidth, height: layerHeight } = layer.getBoundingClientRect();
  if (layerWidth <= 0 || layerHeight <= 0) return null;
  // The text area's insets are shares of the box drawn (`element.bbox.h`): the box asked for
  // has them of its own height.
  const area = element.live?.textArea && mirroredInset(element.live.textArea, element.flip);
  const share = area ? area.top + area.bottom : 0;
  const { width, height, minHeight, transform } = node.style;
  const read = (w: string) => {
    Object.assign(node.style, { width: w, height: 'auto', minHeight: '0', transform: 'none' });
    const size = node.getBoundingClientRect();
    const h = size.height / layerHeight - share * element.bbox.h;
    return { w: size.width / layerWidth, h: share < 1 ? h / (1 - share) : h };
  };
  const restore = () => Object.assign(node.style, { width, height, minHeight, transform });
  const natural = read('max-content').w;
  restore();
  const heights = new Map<number, number>();
  return {
    width: natural,
    heightAt: (at) => {
      let h = heights.get(at);
      if (h === undefined) {
        h = read(`${at * 100}%`).h;
        restore();
        heights.set(at, h);
      }
      return h;
    },
  };
}
