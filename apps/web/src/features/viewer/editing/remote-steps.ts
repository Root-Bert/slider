import {
  findElement,
  type EditableElement,
  type LiveStep,
  type SlideOperation,
} from '@slider/shared';
import { addedElement, addedImage, applyToElement, copiedElement, withCopyIn } from './live/model';

/*
 * Someone else's step, shown at once (`LiveStep`, sent with the live stream's `slides` event):
 * its operations applied here to the elements as the server's last answer has them – an overlay
 * dropped once the edit state is at that step. The editor's own edits on their way stay on top:
 * replayed over it (`rebased`), so what someone else changed shows under them, a property of
 * one's own not jumping back.
 */

/** An element as someone else's step left it (`null`: deleted), until the edit state has it. */
export interface RemoteChange {
  slideId: string;
  element: EditableElement | null;
  /** The step that changed it last. */
  seq: number;
}

export interface RemoteContext {
  /** The element as shown under the editor's own edits (`undefined`: not known here). */
  element: (id: string) => EditableElement | null | undefined;
  slideOfElement: (id: string) => string | undefined;
  slideOfPage: (pageId: string) => string | undefined;
  pageSize: { width: number; height: number };
  /**
   * The slide's top element that holds `id` in a group (at any depth), else `id` itself – a step
   * on an element in a group changes its group.
   */
  topOf?: (id: string) => string | undefined;
}

/** The ids `operation` changes or makes. */
export function idsOf(operation: SlideOperation): string[] {
  if (operation.type === 'addElement' || operation.type === 'addImage')
    return [operation.elementId];
  if (operation.type === 'copyElement') return [operation.newElementId];
  if (operation.type === 'groupElements') return [operation.newElementId, ...operation.elementIds];
  return 'elementId' in operation ? [operation.elementId] : [];
}

/**
 * `step` applied over `overlay`; what it touched. Operations on slides (added, moved, deleted
 * slides) wait for the refetch – the editor shows elements only.
 */
export function withRemoteStep(
  overlay: ReadonlyMap<string, RemoteChange>,
  step: LiveStep,
  context: RemoteContext,
): { next: Map<string, RemoteChange>; touched: string[] } {
  const next = new Map(overlay);
  const touched: string[] = [];
  const current = (id: string) => {
    const change = next.get(id);
    return change ? change.element : context.element(id);
  };
  const slideOf = (id: string) => next.get(id)?.slideId ?? context.slideOfElement(id);
  const aspect = context.pageSize.width / context.pageSize.height;
  const topOf = (id: string) => context.topOf?.(id) ?? id;
  for (const operation of step.operations) {
    if (operation.type === 'addElement' || operation.type === 'addImage') {
      const slideId = context.slideOfPage(operation.pageId);
      if (!slideId) continue;
      const element =
        operation.type === 'addImage'
          ? addedImage(operation)
          : addedElement(operation, context.pageSize);
      next.set(operation.elementId, { slideId, element, seq: step.seq });
      touched.push(operation.elementId);
      continue;
    }
    if (operation.type === 'copyElement') {
      const sourceTop = current(topOf(operation.elementId));
      const source =
        sourceTop?.id === operation.elementId
          ? sourceTop
          : sourceTop?.children && findElement(sourceTop.children, operation.elementId);
      const slideId = context.slideOfPage(operation.pageId);
      if (!source || !slideId) continue;
      const element = copiedElement(
        source,
        operation.newElementId,
        operation.box,
        operation.partIds,
      );
      if (operation.groupId) {
        const top = topOf(operation.groupId);
        const holder = current(top);
        if (!holder) continue;
        next.set(top, {
          slideId,
          element: withCopyIn(holder, operation.groupId, element, aspect),
          seq: step.seq,
        });
        touched.push(top);
        continue;
      }
      next.set(operation.newElementId, { slideId, element, seq: step.seq });
      touched.push(operation.newElementId);
      continue;
    }
    if (!('elementId' in operation)) continue;
    // One in a group: a change of its group.
    const id = topOf(operation.elementId);
    const element = current(id);
    const slideId = slideOf(id);
    if (!element || !slideId) continue;
    next.set(id, {
      slideId,
      element: applyToElement(element, operation, aspect),
      seq: step.seq,
    });
    touched.push(id);
  }
  return { next, touched };
}

/** The overlay without what the edit state at `seq` has already. */
export function settledAt(
  overlay: ReadonlyMap<string, RemoteChange>,
  seq: number,
): ReadonlyMap<string, RemoteChange> {
  if (![...overlay.values()].some((change) => change.seq <= seq)) return overlay;
  return new Map([...overlay].filter(([, change]) => change.seq > seq));
}

/**
 * Element `id` as the editor's own edits on their way (`operations`, oldest first) make it of
 * `base` – one of them makes it anew (added, copied): `undefined`, it is not rebased.
 */
export function rebased(
  base: EditableElement | null,
  id: string,
  operations: readonly SlideOperation[],
): EditableElement | null | undefined {
  let element = base;
  for (const operation of operations) {
    // One on an element in its group (entered) changes it too.
    const inside =
      'elementId' in operation &&
      operation.type !== 'copyElement' &&
      !!element?.children &&
      !!findElement(element.children, operation.elementId);
    if (inside) {
      element = applyToElement(element!, operation);
      continue;
    }
    if (!idsOf(operation).includes(id)) continue;
    const made =
      operation.type === 'addElement' ||
      operation.type === 'addImage' ||
      operation.type === 'copyElement' ||
      (operation.type === 'groupElements' && operation.newElementId === id);
    if (made) return undefined;
    // Grouped: it is in the group now, no element of the slide of its own.
    if (operation.type === 'groupElements') return null;
    if (!element) return element;
    element = applyToElement(element, operation);
  }
  return element;
}

/**
 * A slide's elements with stacking moves on their way applied, in order (`moveElement`: `to`
 * counts from the bottom without the element itself) – a move of an element not on it is skipped.
 */
export function restacked(
  elements: readonly EditableElement[],
  moves: readonly Extract<SlideOperation, { type: 'moveElement' }>[],
): readonly EditableElement[] {
  let out = elements;
  for (const move of moves) {
    const at = out.findIndex((element) => element.id === move.elementId);
    if (at < 0) continue;
    const rest = out.filter((_, index) => index !== at);
    const to = Math.min(move.to, rest.length);
    out = [...rest.slice(0, to), out[at]!, ...rest.slice(to)];
  }
  return out;
}
