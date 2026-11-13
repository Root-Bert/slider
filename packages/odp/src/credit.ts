import type { ImageCredit, ImageSymbol, PhotoProvider } from '@slider/shared';
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
 * picture wherever the file goes – and Slider reads it back to show the credit. Slider's symbols
 * keep there which they are and their colour (an alt text naming them too), so a symbol picked
 * again is offered other colours and symbols.
 */

/** Each photo service by the name its credits carry, and the host its links lead to. */
const SOURCES = {
  unsplash: { name: 'Unsplash', host: String.raw`unsplash\.com` },
  pexels: { name: 'Pexels', host: String.raw`(?:www\.)?pexels\.com` },
} as const satisfies Record<PhotoProvider, { name: string; host: string }>;

const CREDITS = Object.entries(SOURCES).map(([source, { name, host }]) => {
  const link = String.raw`(https://${host}/[^\s)]+)`;
  return {
    source: source as PhotoProvider,
    pattern: new RegExp(String.raw`^Foto von (.+) \(${link}\) auf ${name} \(${link}\)$`),
  };
});
const SYMBOL = /^Symbol „(.+)“ \(([\w.-]+\/[\w.-]+), (#[0-9a-fA-F]{6})\)$/;
/** A description Slider wrote: it goes when the picture changes. */
const isOwn = (text: string) =>
  SYMBOL.test(text) || CREDITS.some(({ pattern }) => pattern.test(text));

export const creditText = (credit: ImageCredit): string =>
  `Foto von ${credit.name} (${credit.profileUrl}) auf ${SOURCES[credit.source ?? 'unsplash'].name} (${credit.photoUrl})`;

export const symbolText = (symbol: ImageSymbol): string =>
  `Symbol „${symbol.label}“ (${symbol.id}, ${symbol.color.toUpperCase()})`;

const descriptionsOf = (frame: XmlNode) =>
  childrenOf(frame).filter((child) => tagOf(child) === 'svg:desc');

const textIn = (node: XmlNode) =>
  childrenOf(node)
    .map((child) => textOf(child) ?? '')
    .join('');

/** The stock photo credit of a picture frame, if it has one. */
export function readCredit(frame: XmlNode): ImageCredit | null {
  for (const description of descriptionsOf(frame)) {
    const text = textIn(description).trim();
    for (const { source, pattern } of CREDITS) {
      const match = pattern.exec(text);
      if (!match) continue;
      const credit = { name: match[1]!, profileUrl: match[2]!, photoUrl: match[3]! };
      // Unsplash's credits stay as they were before there were others.
      return source === 'unsplash' ? credit : { ...credit, source };
    }
  }
  return null;
}

/** The symbol a picture frame shows, if it is one of Slider's. */
export function readSymbol(frame: XmlNode): ImageSymbol | null {
  for (const description of descriptionsOf(frame)) {
    const match = SYMBOL.exec(textIn(description).trim());
    if (match) return { label: match[1]!, id: match[2]!, color: match[3]!.toLowerCase() };
  }
  return null;
}

/**
 * Sets a frame's credit (or symbol) when its picture changed: an old one goes; a new one comes
 * after the picture and its title – where ODF puts the description – and replaces any description
 * (it was about the old picture). Without either, descriptions written by people stay.
 */
export function writeCredit(
  frame: XmlNode,
  credit: ImageCredit | null,
  symbol: ImageSymbol | null = null,
): void {
  const text = credit ? creditText(credit) : symbol ? symbolText(symbol) : null;
  for (const description of descriptionsOf(frame)) {
    if (text || isOwn(textIn(description).trim())) removeChild(frame, description);
  }
  if (!text) return;
  const children = childrenOf(frame);
  const after = children.findLastIndex((child) =>
    ['draw:image', 'svg:title', 'draw:text-box'].includes(tagOf(child) ?? ''),
  );
  children.splice(after + 1, 0, element('svg:desc', {}, [textNode(text)]));
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
