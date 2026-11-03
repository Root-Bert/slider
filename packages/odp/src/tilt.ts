import type { ElementTilt } from '@slider/shared';
import { childrenOf, element, removeChild, tagOf, textNode, textOf, type XmlNode } from './xml';

/*
 * An element tilted in depth (`setTilt`) stays in the file, unseen (`draw:display="none"`); right
 * over it lies a picture frame with it drawn so tilted, which the slide shows. The frame's
 * description (`svg:desc`, which LibreOffice keeps) names the element and the tilt.
 */

const MARK = 'Slider 3D: ';

export interface TiltMark {
  /** The `xml:id` of the element the picture shows. */
  of: string;
  tilt: ElementTilt;
}

const descriptionsOf = (frame: XmlNode) =>
  childrenOf(frame).filter((child) => tagOf(child) === 'svg:desc');

const textIn = (node: XmlNode) =>
  childrenOf(node)
    .map((child) => textOf(child) ?? '')
    .join('');

/** The element and tilt a picture frame shows, `null` when it is no tilted element's picture. */
export function readTiltMark(frame: XmlNode): TiltMark | null {
  if (tagOf(frame) !== 'draw:frame') return null;
  for (const description of descriptionsOf(frame)) {
    const text = textIn(description).trim();
    if (!text.startsWith(MARK)) continue;
    try {
      const data = JSON.parse(text.slice(MARK.length)) as Partial<{
        of: string;
        x: number;
        y: number;
        source: string;
      }>;
      if (typeof data.of === 'string' && typeof data.x === 'number' && typeof data.y === 'number') {
        const tilt: ElementTilt = { x: data.x, y: data.y };
        if (typeof data.source === 'string') tilt.source = data.source;
        return { of: data.of, tilt };
      }
    } catch {
      // Not ours after all.
    }
  }
  return null;
}

/** Marks a picture frame as the picture of a tilted element. */
export function writeTiltMark(frame: XmlNode, mark: TiltMark): void {
  for (const description of descriptionsOf(frame)) removeChild(frame, description);
  childrenOf(frame).push(
    element('svg:desc', {}, [textNode(`${MARK}${JSON.stringify({ of: mark.of, ...mark.tilt })}`)]),
  );
}
