import type { ImageCredit } from '@slider/shared';
import {
  attr,
  buildPart,
  childrenOf,
  descendants,
  element,
  parsePart,
  removeChild,
  setAttr,
  tagOf,
  textNode,
  textOf,
  type XmlNode,
} from './xml';

/*
 * Stock photos keep their credit in the file: the frame's description (`svg:desc`, the „Alt
 * text“ of office suites) names the photographer and links the photo, so it travels with the
 * picture wherever the file goes – and Slider reads it back to show the credit.
 */

const LINK = String.raw`(https://unsplash\.com/[^\s)]+)`;
const CREDIT = new RegExp(String.raw`^Foto von (.+) \(${LINK}\) auf Unsplash \(${LINK}\)$`);

export const creditText = (credit: ImageCredit): string =>
  `Foto von ${credit.name} (${credit.profileUrl}) auf Unsplash (${credit.photoUrl})`;

const descriptionsOf = (frame: XmlNode) =>
  childrenOf(frame).filter((child) => tagOf(child) === 'svg:desc');

const textIn = (node: XmlNode) =>
  childrenOf(node)
    .map((child) => textOf(child) ?? '')
    .join('');

/** The stock photo credit of a picture frame, if it has one. */
export function readCredit(frame: XmlNode): ImageCredit | null {
  for (const description of descriptionsOf(frame)) {
    const match = CREDIT.exec(textIn(description).trim());
    if (match) return { name: match[1]!, profileUrl: match[2]!, photoUrl: match[3]! };
  }
  return null;
}

/**
 * Sets a frame's credit when its picture changed: an old credit goes; a new one comes after the
 * picture and its title – where ODF puts the description – and replaces any description (it was
 * about the old picture). Without a credit, descriptions written by people stay.
 */
export function writeCredit(frame: XmlNode, credit: ImageCredit | null): void {
  for (const description of descriptionsOf(frame)) {
    if (credit || CREDIT.test(textIn(description).trim())) removeChild(frame, description);
  }
  if (!credit) return;
  const children = childrenOf(frame);
  const after = children.findLastIndex((child) =>
    ['draw:image', 'svg:title', 'draw:text-box'].includes(tagOf(child) ?? ''),
  );
  children.splice(after + 1, 0, element('svg:desc', {}, [textNode(creditText(credit))]));
}

/** The frames below `root` that show the picture `path`. */
export function framesShowing(root: XmlNode, path: string): XmlNode[] {
  return [root, ...descendants(root)].filter(
    (node) =>
      tagOf(node) === 'draw:frame' &&
      childrenOf(node).some(
        (child) => tagOf(child) === 'draw:image' && attr(child, 'xlink:href') === path,
      ),
  );
}

/**
 * A slide's XML with the picture `from` swapped for `to` – with its credit – in every frame that
 * shows it. The frames keep their size: the new picture is cut to it beforehand.
 */
export function swapPicture(
  pageXml: string,
  from: string,
  to: { path: string; credit: ImageCredit | null },
): string {
  const part = parsePart(pageXml, 'slide');
  for (const root of part.nodes) {
    for (const frame of framesShowing(root, from)) {
      for (const image of childrenOf(frame).filter((child) => tagOf(child) === 'draw:image')) {
        if (attr(image, 'xlink:href') === from) setAttr(image, 'xlink:href', to.path);
      }
      writeCredit(frame, to.credit);
    }
  }
  return buildPart(part);
}

/** The id of the first frame in a slide's XML that shows `path` (`xml:id`, else `draw:id`). */
export function frameIdShowing(pageXml: string, path: string): string | null {
  const part = parsePart(pageXml, 'slide');
  for (const root of part.nodes) {
    const [frame] = framesShowing(root, path);
    if (frame) return attr(frame, 'xml:id') ?? attr(frame, 'draw:id') ?? null;
  }
  return null;
}
