import type { EditableElement, EditSlide, FillLayer, SlideOperation } from '@slider/shared';
import { applyToElement, richFromLive } from './live/model';

/*
 * Undo in the browser: what takes an edit back, worked out from the elements as shown when the
 * edit is made – sent like any edit, shown in the same frame, queued while offline. An edit whose
 * way back the browser cannot write (a slide deleted, a picture swapped, a tilt, text the live
 * editor cannot read) has none: the server takes its step back (`revertChange`) instead.
 */

/** What the browser knows when an edit is made: the elements and slides as shown. */
export interface UndoContext {
  /** An element as shown now (`null`/`undefined`: none). */
  element: (elementId: string) => EditableElement | null | undefined;
  /** The group an element lies in as shown now (entered, Figma); none at the slide's top. */
  groupOf?: (elementId: string) => EditableElement | undefined;
  /** The page id of the slide an element lies on. */
  pageOf: (elementId: string) => string | undefined;
  /** A slide's elements as shown, bottom first. */
  elementsOn: (pageId: string) => readonly EditableElement[];
  /** The slides, in their order in the file. */
  slides: readonly EditSlide[];
  /** A slide has edits still on their way: what the server says of it may be behind. */
  slidePending: (pageId: string) => boolean;
}

/** An edit's way back, and the elements it needs to bring back what it deletes. */
export interface Inverse {
  operations: SlideOperation[];
  /** Elements as they were, by id – what a `copyElement` of a deleted one shows. */
  sources: Map<string, EditableElement>;
}

/** A fill only the server can draw back: a picture in it, or layers drawn as one picture. */
const needsServer = (fills: readonly FillLayer[]) => fills.some((layer) => layer.type === 'image');

/**
 * The operations that take `operations` back – each against the state the ones before it left,
 * in reverse order – or `null` when one of them has no way back the browser can write.
 */
export function inverseOf(
  operations: readonly SlideOperation[],
  context: UndoContext,
): Inverse | null {
  // Elements as each operation finds them: the ones before it in this edit applied.
  const scratch = new Map<string, EditableElement | null>();
  const element = (id: string) => (scratch.has(id) ? scratch.get(id) : context.element(id));
  const sources = new Map<string, EditableElement>();
  const steps: SlideOperation[][] = [];

  for (const operation of operations) {
    const back = inverseOne(operation, element, context, sources);
    if (!back) return null;
    steps.push(back);
    if ('elementId' in operation && operation.type !== 'copyElement') {
      const before = element(operation.elementId);
      if (before) scratch.set(operation.elementId, applyToElement(before, operation));
    }
  }
  return { operations: steps.reverse().flat(), sources };
}

function inverseOne(
  operation: SlideOperation,
  element: (id: string) => EditableElement | null | undefined,
  context: UndoContext,
  sources: Map<string, EditableElement>,
): SlideOperation[] | null {
  switch (operation.type) {
    case 'addElement':
    case 'addImage':
      return [{ type: 'deleteElement', elementId: operation.elementId }];
    case 'copyElement': {
      // Pasted again by redo from the element as it was copied.
      const source = element(operation.elementId);
      if (source) sources.set(operation.elementId, source);
      return [{ type: 'deleteElement', elementId: operation.newElementId }];
    }
    case 'deleteElement': {
      const was = element(operation.elementId);
      const pageId = context.pageOf(operation.elementId);
      if (!was || !pageId) return null;
      sources.set(operation.elementId, was);
      // In a group: back into it, at its place there.
      const holder = context.groupOf?.(operation.elementId);
      if (holder?.children) {
        const at = holder.children.findIndex((item) => item.id === operation.elementId);
        return [
          {
            type: 'copyElement',
            elementId: operation.elementId,
            pageId,
            newElementId: RESTORED,
            box: was.bbox,
            groupId: holder.id,
          },
          ...(at >= 0 ? [{ type: 'moveElement' as const, elementId: RESTORED, to: at }] : []),
        ];
      }
      const below = context.elementsOn(pageId).findIndex((item) => item.id === operation.elementId);
      // Brought back from the file before its delete (`loadSources`), under an id of its own
      // that `freshIds` gives it when it is sent; back at its place in the stacking order.
      return [
        {
          type: 'copyElement',
          elementId: operation.elementId,
          pageId,
          newElementId: RESTORED,
          box: was.bbox,
        },
        ...(below >= 0 ? [{ type: 'moveElement' as const, elementId: RESTORED, to: below }] : []),
      ];
    }
    case 'groupElements': {
      // Taken apart again, each back at its place in the stacking order (bottom first: each one
      // put back finds those under it in place – `moveElement` counts without itself).
      const pageId = context.pageOf(operation.elementIds[0] ?? '');
      if (!pageId) return null;
      const elements = context.elementsOn(pageId);
      const places = operation.elementIds
        .map((elementId) => ({
          elementId,
          at: elements.findIndex((item) => item.id === elementId),
        }))
        .sort((a, b) => a.at - b.at);
      if (places.some((place) => place.at < 0)) return null;
      return [
        { type: 'ungroupElements', elementId: operation.newElementId },
        ...places.map(({ elementId, at }) => ({ type: 'moveElement' as const, elementId, to: at })),
      ];
    }
    case 'moveElement': {
      const holder = context.groupOf?.(operation.elementId);
      if (holder?.children) {
        const at = holder.children.findIndex((item) => item.id === operation.elementId);
        return at < 0 ? null : [{ type: 'moveElement', elementId: operation.elementId, to: at }];
      }
      const pageId = context.pageOf(operation.elementId);
      const below = pageId
        ? context.elementsOn(pageId).findIndex((item) => item.id === operation.elementId)
        : -1;
      return below < 0
        ? null
        : [{ type: 'moveElement', elementId: operation.elementId, to: below }];
    }
    case 'setBox': {
      const was = element(operation.elementId);
      if (!was) return null;
      return [
        {
          type: 'setBox',
          elementId: operation.elementId,
          box: was.bbox,
          ...(operation.rotation !== undefined && { rotation: was.rotation }),
          // A line runs as it did – turned, the way it runs changed too.
          ...((operation.flip || was.line) && was.flip && { flip: was.flip }),
        },
      ];
    }
    case 'setText':
    case 'setRichText': {
      const was = element(operation.elementId);
      // Only text the live editor reads comes back whole, with its formatting.
      if (!was?.live) return null;
      return [
        {
          type: 'setRichText',
          elementId: operation.elementId,
          paragraphs: richFromLive(was.live.paragraphs),
        },
      ];
    }
    case 'setShapeStyle': {
      const was = element(operation.elementId);
      if (!was?.look) return null;
      const back: Extract<SlideOperation, { type: 'setShapeStyle' }> = {
        type: 'setShapeStyle',
        elementId: operation.elementId,
      };
      if (operation.fills !== undefined || operation.fill !== undefined) {
        if (needsServer(was.look.fills) || was.look.fillAspect !== null) return null;
        back.fills = was.look.fills;
      }
      if (operation.stroke !== undefined) back.stroke = was.look.stroke;
      if (operation.heads !== undefined) {
        if (!was.line) return null;
        back.heads = was.line.heads;
      }
      if (operation.effects !== undefined) back.effects = was.look.effects;
      if (operation.verticalAlign !== undefined) {
        if (!was.live) return null;
        back.verticalAlign = was.live.verticalAlign;
      }
      return [back];
    }
    case 'setCornerRadius': {
      const was = element(operation.elementId);
      return was?.cornerRadius === undefined
        ? null
        : [{ type: 'setCornerRadius', elementId: operation.elementId, radius: was.cornerRadius }];
    }
    case 'setImageFit': {
      const picture = element(operation.elementId)?.picture;
      if (!picture) return null;
      return [
        {
          type: 'setImageFit',
          elementId: operation.elementId,
          fit: picture.fit,
          ...(picture.fit === 'fill' && picture.focus && { focus: picture.focus }),
        },
      ];
    }
    case 'setLocked': {
      const was = element(operation.elementId);
      return was
        ? [{ type: 'setLocked', elementId: operation.elementId, locked: was.locked === true }]
        : null;
    }
    case 'addSlide':
    case 'duplicateSlide':
    case 'addVariant':
      return [{ type: 'deleteSlide', pageId: operation.newPageId }];
    case 'setSlideHidden':
    case 'setSlideTransition':
    case 'setSlideBackground':
    case 'setSlideNotes':
    case 'moveSlide': {
      // The slides as the server last said: right only while nothing else on it is on its way.
      if (context.slidePending(operation.pageId)) return null;
      const index = context.slides.findIndex((slide) => slide.pageId === operation.pageId);
      const slide = context.slides[index];
      if (!slide) return null;
      const pageId = operation.pageId;
      switch (operation.type) {
        case 'setSlideHidden':
          return [{ type: 'setSlideHidden', pageId, hidden: slide.hidden }];
        case 'setSlideTransition':
          return slide.transition === null
            ? null
            : [{ type: 'setSlideTransition', pageId, transition: slide.transition }];
        case 'setSlideBackground':
          if (!slide.ownBackground) return [{ type: 'setSlideBackground', pageId, color: null }];
          return needsServer(slide.backgroundFills)
            ? null
            : [{ type: 'setSlideBackground', pageId, fills: slide.backgroundFills }];
        case 'setSlideNotes':
          return [
            {
              type: 'setSlideNotes',
              pageId,
              text: slide.notes,
              ...(slide.notesRich && { paragraphs: slide.notesRich }),
            },
          ];
        case 'moveSlide':
          return [{ type: 'moveSlide', pageId, after: context.slides[index - 1]?.pageId ?? null }];
      }
      return null;
    }
    // A picture swapped, a tilt (its picture drawn by the server), a slide deleted, a variant
    // taken: only the server has what they replaced.
    default:
      return null;
  }
}

/** Stands for the id a restored element gets once its way back is sent (`freshIds`). */
export const RESTORED = 'sl-restored';

/**
 * `operations` as they go out: each restored element (`RESTORED`) under a new id – and which ids
 * that renames (the deleted element's id → its new one), for the steps still to undo or redo.
 */
export function freshIds(
  operations: readonly SlideOperation[],
  newId: () => string,
): { operations: SlideOperation[]; renames: Map<string, string> } {
  const renames = new Map<string, string>();
  let current: string | null = null;
  const out = operations.map((operation): SlideOperation => {
    if (operation.type === 'copyElement' && operation.newElementId === RESTORED) {
      current = newId();
      renames.set(operation.elementId, current);
      return { ...operation, newElementId: current };
    }
    if ('elementId' in operation && operation.elementId === RESTORED && current) {
      return { ...operation, elementId: current };
    }
    return operation;
  });
  return { operations: out, renames };
}

/** `operations` with the element ids `renames` names replaced. */
export function renamed(
  operations: readonly SlideOperation[],
  renames: ReadonlyMap<string, string>,
): SlideOperation[] {
  if (renames.size === 0) return [...operations];
  return operations.map((operation) => {
    let next = operation;
    if ('elementId' in next && renames.has(next.elementId)) {
      next = { ...next, elementId: renames.get(next.elementId)! } as SlideOperation;
    }
    if (next.type === 'copyElement' && renames.has(next.newElementId)) {
      next = { ...next, newElementId: renames.get(next.newElementId)! };
    }
    return next;
  });
}

/** The elements an edit changes – what is compared before it is taken back or done again. */
export function touchedElements(operations: readonly SlideOperation[]): string[] {
  const ids = new Set<string>();
  for (const operation of operations) {
    if (operation.type === 'copyElement') {
      if (operation.newElementId !== RESTORED) ids.add(operation.newElementId);
    } else if (operation.type === 'groupElements') {
      ids.add(operation.newElementId);
      for (const id of operation.elementIds) ids.add(id);
    } else if ('elementId' in operation && operation.elementId !== RESTORED) {
      ids.add(operation.elementId);
    }
  }
  return [...ids];
}

/** What of an element an undo compares: what edits change, not how the server words it. */
function comparable(element: EditableElement | null | undefined): unknown {
  if (!element) return null;
  return {
    bbox: element.bbox,
    rotation: element.rotation,
    flip: element.flip,
    text: element.paragraphs?.join('\n') ?? null,
    fills: element.look?.fills.map((layer) =>
      layer.type === 'solid' ? { ...layer, color: layer.color.toLowerCase() } : layer,
    ),
    stroke: element.look?.stroke
      ? { ...element.look.stroke, color: element.look.stroke.color.toLowerCase() }
      : null,
    radius: element.cornerRadius ?? null,
    heads: element.line?.heads ?? null,
    fit: element.picture ? { fit: element.picture.fit, focus: element.picture.focus } : null,
    locked: element.locked === true,
  };
}

/** The touched elements as they are now: what an undo or redo expects to find. */
export type Snapshot = Map<string, unknown>;

export function snapshotOf(
  ids: readonly string[],
  element: (id: string) => EditableElement | null | undefined,
): Snapshot {
  return new Map(ids.map((id) => [id, comparable(element(id))]));
}

/**
 * Numbers alike within what the file's own rounding makes of them (cm with three places, pt);
 * anything else exactly alike.
 */
function alike(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= Math.max(0.002, 0.02 * Math.max(Math.abs(a), Math.abs(b)));
  }
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return (a ?? null) === (b ?? null);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!alike((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}

/** The elements of `expected` that changed since – someone else's edit, to be left as it is. */
export function changedSince(
  expected: Snapshot,
  element: (id: string) => EditableElement | null | undefined,
): Set<string> {
  const changed = new Set<string>();
  for (const [id, value] of expected) if (!alike(value, comparable(element(id)))) changed.add(id);
  return changed;
}

/** `operations` without those on `skipped` elements (and a restored one that rides on them). */
export function without(
  operations: readonly SlideOperation[],
  skipped: ReadonlySet<string>,
): SlideOperation[] {
  if (skipped.size === 0) return [...operations];
  let dropRestored = false;
  return operations.filter((operation) => {
    if (operation.type === 'copyElement') {
      const drop = skipped.has(operation.newElementId) || skipped.has(operation.elementId);
      if (operation.newElementId === RESTORED) dropRestored = drop;
      return !drop;
    }
    if (!('elementId' in operation)) return true;
    if (operation.elementId === RESTORED) return !dropRestored;
    return !skipped.has(operation.elementId);
  });
}

/** `snapshot` with its ids renamed. */
export function renamedSnapshot(
  snapshot: Snapshot,
  renames: ReadonlyMap<string, string>,
): Snapshot {
  if (renames.size === 0) return snapshot;
  return new Map([...snapshot].map(([id, value]) => [renames.get(id) ?? id, value]));
}
