import type { SlideTransition } from '@slider/shared';
import {
  attr,
  childrenOf,
  firstChild,
  removeAttr,
  removeChild,
  setAttr,
  tagOf,
  type XmlNode,
} from './xml';

/*
 * How a slide comes in when presenting. The page style keeps it (`smil:type` and co. of its
 * drawing-page properties); LibreOffice also writes it into the page's timing root as an
 * `anim:transitionFilter`, which wins over the style when it reads the file – so both are kept
 * alike. Each transition here is one LibreOffice and PowerPoint play the same way – `morph` too:
 * a crossfade for them, marked for Slider on the style (`slider:transition`), which plays it as
 * its own (the elements glide).
 */

interface Smil {
  type: string;
  subtype: string;
  fadeColor?: string;
}

const SMIL: Record<Exclude<SlideTransition, 'none'>, Smil> = {
  fade: { type: 'fade', subtype: 'crossfade' },
  fadeBlack: { type: 'fade', subtype: 'fadeOverColor', fadeColor: '#000000' },
  push: { type: 'pushWipe', subtype: 'fromRight' },
  cover: { type: 'slideWipe', subtype: 'fromRight' },
  wipe: { type: 'barWipe', subtype: 'leftToRight' },
  dissolve: { type: 'dissolve', subtype: 'defaultSubtype' },
  zoom: { type: 'irisWipe', subtype: 'rectangle' },
  morph: { type: 'fade', subtype: 'crossfade' },
};

/** On the drawing-page properties: the crossfade is Slider's morph. */
const MORPH_MARK = 'slider:transition';

const SMIL_ATTRIBUTES = ['smil:type', 'smil:subtype', 'smil:direction', 'smil:fadeColor'];

/** The page's `anim:par`s that hold its transition (LibreOffice writes one). */
function transitionPars(page: XmlNode): XmlNode[] {
  const root = childrenOf(page).find(
    (child) =>
      tagOf(child) === 'anim:par' && attr(child, 'presentation:node-type') === 'timing-root',
  );
  return (root ? childrenOf(root) : []).filter(
    (child) =>
      tagOf(child) === 'anim:par' &&
      attr(child, 'presentation:node-type') === undefined &&
      !!firstChild(child, 'anim:transitionFilter'),
  );
}

/**
 * The slide's transition from its page and the drawing-page properties of its style: `'none'`
 * without one, `null` for one Slider does not offer.
 */
export function readTransition(
  page: XmlNode,
  properties: XmlNode | undefined,
): SlideTransition | null {
  const par = transitionPars(page)[0];
  const source = (par && firstChild(par, 'anim:transitionFilter')) ?? properties;
  const type = source && attr(source, 'smil:type');
  if (!source || !type || type === 'none') return 'none';
  const subtype = attr(source, 'smil:subtype');
  const direction = attr(source, 'smil:direction') ?? 'forward';
  const fadeColor = attr(source, 'smil:fadeColor')?.toLowerCase() ?? '#000000';
  const morph = !!properties && attr(properties, MORPH_MARK) === 'morph';
  for (const [name, smil] of Object.entries(SMIL) as [SlideTransition, Smil][]) {
    if (name === 'morph' || (name === 'fade' && morph)) continue;
    if (
      smil.type === type &&
      smil.subtype === subtype &&
      direction === 'forward' &&
      (smil.fadeColor === undefined || smil.fadeColor === fadeColor)
    ) {
      return name;
    }
  }
  if (morph && type === SMIL.morph.type && subtype === SMIL.morph.subtype) return 'morph';
  return null;
}

/** Sets the transition on the drawing-page properties (`'none'`: without one). */
export function writeTransitionProperties(properties: XmlNode, transition: SlideTransition): void {
  for (const name of [...SMIL_ATTRIBUTES, MORPH_MARK]) removeAttr(properties, name);
  if (transition === 'none') return;
  writeSmil(properties, SMIL[transition]);
  if (transition === 'morph') setAttr(properties, MORPH_MARK, 'morph');
}

/**
 * Brings the page's own transition (in its timing root) in line: changed in place, so its
 * duration stays, or gone with `'none'`.
 */
export function writeTransitionFilters(page: XmlNode, transition: SlideTransition): void {
  for (const par of transitionPars(page)) {
    const filter = firstChild(par, 'anim:transitionFilter') as XmlNode;
    if (transition === 'none') {
      const root = childrenOf(page).find(
        (child) => attr(child, 'presentation:node-type') === 'timing-root',
      );
      if (root) removeChild(root, par);
      continue;
    }
    for (const name of SMIL_ATTRIBUTES) removeAttr(filter, name);
    writeSmil(filter, SMIL[transition]);
  }
}

function writeSmil(node: XmlNode, smil: Smil): void {
  setAttr(node, 'smil:type', smil.type);
  setAttr(node, 'smil:subtype', smil.subtype);
  if (smil.fadeColor) setAttr(node, 'smil:fadeColor', smil.fadeColor);
}
