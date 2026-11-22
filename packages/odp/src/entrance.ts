import { ENTRANCE_SECONDS, type Entrance, type ElementEntranceEffect } from '@slider/shared';
import {
  attr,
  childrenOf,
  descendants,
  element,
  elementChildren,
  removeChild,
  setAttr,
  tagOf,
  type XmlNode,
} from './xml';

/*
 * How elements come in when a slide is presented: the entrance effects of the page's main sequence
 * (`anim:seq presentation:node-type="main-sequence"` in its timing root), written as LibreOffice
 * writes its own presets, so LibreOffice and PowerPoint (export) play them too. The sequence holds
 * groups started by a click or – the first – as the slide comes, each of effects one after the
 * other or together. Slider writes no clicks: every effect after the one before or with it.
 * Effects it does not offer (emphasis, exit, other presets) stay as they are.
 */

const PRESET: Record<ElementEntranceEffect, string> = {
  appear: 'ooo-entrance-appear',
  fade: 'ooo-entrance-fade-in',
  rise: 'ooo-entrance-ascend',
  fly: 'ooo-entrance-fly-in',
  zoom: 'ooo-entrance-zoom',
  wipe: 'ooo-entrance-wipe',
};

const START_OF = {
  'on-click': 'click',
  'with-previous': 'with',
  'after-previous': 'after',
} as const;

/** One effect of the main sequence, in order. */
interface Effect {
  node: XmlNode;
  target: string | null;
  start: 'after' | 'with' | 'click';
  /** One Slider offers; `null`: another, kept as it is. */
  entrance: Entrance | null;
}

const isTimingRoot = (node: XmlNode) =>
  tagOf(node) === 'anim:par' && attr(node, 'presentation:node-type') === 'timing-root';
const isMainSequence = (node: XmlNode) =>
  tagOf(node) === 'anim:seq' && attr(node, 'presentation:node-type') === 'main-sequence';

/** The page's main sequence – made (with its timing root) when `create`. */
function mainSequence(page: XmlNode, create: boolean): XmlNode | undefined {
  const children = childrenOf(page);
  let root = children.find(isTimingRoot);
  if (!root) {
    if (!create) return undefined;
    root = element('anim:par', { 'presentation:node-type': 'timing-root' });
    // Before the notes, as the schema has it.
    const notes = children.findIndex((child) => tagOf(child) === 'presentation:notes');
    children.splice(notes < 0 ? children.length : notes, 0, root);
  }
  let sequence = childrenOf(root).find(isMainSequence);
  if (!sequence && create) {
    sequence = element('anim:seq', { 'presentation:node-type': 'main-sequence' });
    childrenOf(root).push(sequence);
  }
  return sequence;
}

/** What an effect's node says, if it is an entrance Slider offers. */
function entranceOf(node: XmlNode): Entrance | null {
  if (attr(node, 'presentation:preset-class') !== 'entrance') return null;
  const id = attr(node, 'presentation:preset-id');
  const effect = (Object.keys(PRESET) as ElementEntranceEffect[]).find((key) => PRESET[key] === id);
  if (!effect) return null;
  const start = START_OF[attr(node, 'presentation:node-type') as keyof typeof START_OF] ?? 'after';
  const sub = attr(node, 'presentation:preset-sub-type');
  const from = effect === 'fly' && sub?.startsWith('from-') ? sub.slice(5) : undefined;
  return {
    effect,
    start,
    ...(from === 'left' || from === 'right' || from === 'top' ? { from } : {}),
  };
}

/** The sequence's effects in order: groups, their times, their effects. */
function effectsOf(sequence: XmlNode): Effect[] {
  const effects: Effect[] = [];
  for (const group of elementChildren(sequence)) {
    for (const time of elementChildren(group)) {
      for (const node of elementChildren(time)) {
        if (tagOf(node) !== 'anim:par') continue;
        let target: string | null = null;
        for (const inner of descendants(node)) {
          target = attr(inner, 'smil:targetElement') ?? null;
          if (target) break;
        }
        const type = attr(node, 'presentation:node-type') as keyof typeof START_OF;
        effects.push({
          node,
          target,
          start: START_OF[type] ?? 'after',
          entrance: entranceOf(node),
        });
      }
    }
  }
  return effects;
}

/** The page's entrances Slider offers, by target id, with their place among them (0 first). */
export function readEntrances(page: XmlNode): Map<string, Entrance & { order: number }> {
  const sequence = mainSequence(page, false);
  const found = new Map<string, Entrance & { order: number }>();
  if (!sequence) return found;
  for (const effect of effectsOf(sequence)) {
    if (!effect.entrance || !effect.target || found.has(effect.target)) continue;
    found.set(effect.target, { ...effect.entrance, order: found.size });
  }
  return found;
}

/** An effect's longest part, in seconds (what the next one after it waits for). */
function secondsOf(node: XmlNode): number {
  let longest = 0;
  for (const inner of descendants(node)) {
    const match = /^([\d.]+)s?$/.exec(attr(inner, 'smil:dur') ?? '');
    if (match) longest = Math.max(longest, Number(match[1]));
  }
  return longest || ENTRANCE_SECONDS;
}

/** The effect's node as LibreOffice writes its preset. */
function effectNode(target: string, entrance: Entrance): XmlNode {
  const dur = `${ENTRANCE_SECONDS}s`;
  const on = { 'smil:targetElement': target };
  const animate = (name: string, values: string) =>
    element('anim:animate', {
      'smil:dur': dur,
      'smil:fill': 'hold',
      ...on,
      'smil:attributeName': name,
      'smil:values': values,
      'smil:keyTimes': '0;1',
      'presentation:additive': 'base',
    });
  const filter = (type: string, subtype: string) =>
    element('anim:transitionFilter', {
      'smil:dur': dur,
      ...on,
      'smil:type': type,
      'smil:subtype': subtype,
    });
  const from = entrance.from ?? 'bottom';
  const parts: XmlNode[] = [
    element('anim:set', {
      'smil:begin': '0s',
      'smil:dur': '0.001s',
      'smil:fill': 'hold',
      ...on,
      'smil:attributeName': 'visibility',
      'smil:to': 'visible',
    }),
  ];
  let sub: string | null = null;
  switch (entrance.effect) {
    case 'appear':
      break;
    case 'fade':
      parts.push(filter('fade', 'crossfade'));
      break;
    case 'rise':
      parts.push(animate('x', 'x;x'), animate('y', 'y+.05;y'), filter('fade', 'crossfade'));
      break;
    case 'fly':
      sub = `from-${from}`;
      parts.push(
        animate('x', from === 'left' ? '0-width/2;x' : from === 'right' ? '1+width/2;x' : 'x;x'),
        animate('y', from === 'top' ? '0-height/2;y' : from === 'bottom' ? '1+height/2;y' : 'y;y'),
      );
      break;
    case 'zoom':
      sub = 'in';
      parts.push(
        animate('width', '0;width'),
        animate('height', '0;height'),
        filter('fade', 'crossfade'),
      );
      break;
    case 'wipe':
      sub = 'from-left';
      parts.push(filter('barWipe', 'leftToRight'));
      break;
  }
  return element(
    'anim:par',
    {
      'smil:begin': '0s',
      'smil:fill': 'hold',
      'presentation:node-type': 'after-previous',
      'presentation:preset-class': 'entrance',
      'presentation:preset-id': PRESET[entrance.effect],
      ...(sub ? { 'presentation:preset-sub-type': sub } : {}),
    },
    parts,
  );
}

/** Writes `effects` as the sequence anew: groups by click, times by „after“, in order. */
function rebuild(sequence: XmlNode, effects: readonly Effect[]): void {
  const groups = childrenOf(sequence);
  groups.length = 0;
  let group: XmlNode | null = null;
  let time: XmlNode | null = null;
  // Seconds into the group the current time starts, and how long it lasts.
  let at = 0;
  let lasts = 0;
  for (const effect of effects) {
    if (effect.start === 'click' || !group) {
      // The first group starts with the slide unless a click starts it.
      group = element('anim:par', {
        'smil:begin': effect.start === 'click' ? 'indefinite' : 'next',
      });
      groups.push(group);
      time = null;
      at = 0;
      lasts = 0;
    }
    if (effect.start !== 'with' || !time) {
      at += lasts;
      lasts = 0;
      time = element('anim:par', { 'smil:begin': `${Math.round(at * 1000) / 1000}s` });
      childrenOf(group).push(time);
    }
    const first = childrenOf(time).length === 0 && childrenOf(group).length === 1;
    setAttr(effect.node, 'smil:begin', '0s');
    setAttr(
      effect.node,
      'presentation:node-type',
      effect.start === 'click' && first
        ? 'on-click'
        : effect.start === 'with'
          ? 'with-previous'
          : 'after-previous',
    );
    childrenOf(time).push(effect.node);
    lasts = Math.max(lasts, secondsOf(effect.node));
  }
}

/**
 * Sets how the element with id `target` comes in: a new entrance after the page's others, a
 * changed one in its place, `null` none (its other effects stay).
 */
export function writeEntrance(page: XmlNode, target: string, entrance: Entrance | null): void {
  const sequence = mainSequence(page, entrance !== null);
  if (!sequence) return;
  const effects = effectsOf(sequence);
  const at = effects.findIndex((effect) => effect.target === target && effect.entrance);
  // Slider's entrances start after the one before or with it – never on a click.
  const start = entrance?.start === 'click' ? 'after' : entrance?.start;
  const made: Effect | null =
    entrance && start
      ? {
          node: effectNode(target, { ...entrance, start }),
          target,
          start,
          entrance: { ...entrance, start },
        }
      : null;
  if (at >= 0) {
    if (made) effects[at] = made;
    else effects.splice(at, 1);
  } else if (made) {
    effects.push(made);
  } else {
    return;
  }
  rebuild(sequence, effects);
  if (effects.length === 0) {
    // Nothing left to play: the sequence goes (the timing root stays for a transition).
    const root = childrenOf(page).find(isTimingRoot);
    if (root) removeChild(root, sequence);
  }
}
