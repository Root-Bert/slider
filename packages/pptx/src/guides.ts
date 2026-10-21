import type { Guide } from '@slider/shared';
import { attr, child, findByLocalName, intAttr, path, type MaybeElement } from './xml';

/** A guide as stored: its direction and its position in EMU from the slide's top/left edge. */
export interface EmuGuide {
  orientation: Guide['orientation'];
  emu: number;
}

/** Guide positions are in master units: 1/576 inch (an eighth of a point). */
const EMU_PER_MASTER_UNIT = 914400 / 576;

/** `p:guide` / `p15:guide` elements of a guide list; `orient` defaults to `vert`. */
function readGuides(list: MaybeElement): EmuGuide[] {
  return (list?.children ?? []).map((guide) => ({
    orientation: attr(guide, 'orient') === 'horz' ? 'horizontal' : 'vertical',
    emu: (intAttr(guide, 'pos') ?? 0) * EMU_PER_MASTER_UNIT,
  }));
}

/**
 * Guides PowerPoint 2013+ keeps in an `p:extLst` of the presentation, a slide master or a
 * layout (`p15:sldGuideLst`). The presentation's own list also has `p15:notesGuideLst`, which
 * the local name keeps apart.
 */
export function readExtGuides(element: MaybeElement): EmuGuide[] {
  return readGuides(findByLocalName(child(element, 'p:extLst'), 'sldGuideLst'));
}

/** Older files keep the slide guides in `viewProps.xml` only. */
export function readViewPropsGuides(viewProps: MaybeElement): EmuGuide[] {
  return readGuides(path(viewProps, 'p:slideViewPr', 'p:cSldViewPr', 'p:guideLst'));
}

/** Normalised to the slide, off-slide ones dropped, duplicates (master and layout) merged. */
export function normaliseGuides(guides: EmuGuide[], size: { cx: number; cy: number }): Guide[] {
  const seen = new Set<string>();
  const result: Guide[] = [];
  for (const guide of guides) {
    const extent = guide.orientation === 'horizontal' ? size.cy : size.cx;
    const position = guide.emu / extent;
    if (position < 0 || position > 1) continue;
    const key = `${guide.orientation}:${position.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ orientation: guide.orientation, position });
  }
  return result;
}
