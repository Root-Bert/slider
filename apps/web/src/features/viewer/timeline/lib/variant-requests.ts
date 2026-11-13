import { useSyncExternalStore } from 'react';

/**
 * „Variante erstellen“ across the viewer – kept outside the tile, which moves to another track row
 * (and mounts anew) once a variant is in, and outside the right-click menu that asks for it:
 *
 * - the requests the AI works on, by the slide they make a variant of (`setVariantRequest`);
 * - the field asked for from the slide's right-click menu, opened by its tile once it is shown
 *   (`askVariant` → the timeline shows the tile's track → `useVariantPrompted`) – on a phone,
 *   without variant tracks, in a sheet (`useVariantSheet`);
 * - the copy just made, opened for editing once it is there (`openVariantWhenThere`).
 */
export interface VariantRequest {
  proposalId: string;
  prompt: string;
}

let requests: ReadonlyMap<string, VariantRequest> = new Map();
let prompted: string | null = null;
let sheet: string | null = null;
let opening: string | null = null;
let asker: ((slideId: string) => void) | null = null;
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function setVariantRequest(slideId: string, request: VariantRequest | null): void {
  const next = new Map(requests);
  if (request) next.set(slideId, request);
  else next.delete(slideId);
  requests = next;
  changed();
}

export const useVariantRequest = (slideId: string): VariantRequest | undefined =>
  useSyncExternalStore(subscribe, () => requests.get(slideId));

export const useVariantRequests = (): ReadonlyMap<string, VariantRequest> =>
  useSyncExternalStore(subscribe, () => requests);

/**
 * The timeline: how it asks for a slide's variant – its tile brought into view, or (phones) the
 * sheet opened.
 */
export function setVariantAsker(next: (slideId: string) => void): () => void {
  asker = next;
  return () => {
    if (asker === next) asker = null;
  };
}

/**
 * The right-click menu's „Variante erstellen“: the slide's tile shown with its field open, as a
 * click on it (on a phone: the sheet) – `false` without a timeline, to make the copy at once
 * instead.
 */
export function askVariant(slideId: string): boolean {
  if (!asker) return false;
  asker(slideId);
  return true;
}

/** The tile of slide `slideId` opens its field (`null`: done). */
export function setVariantPrompt(slideId: string | null): void {
  prompted = slideId;
  changed();
}

export const useVariantPrompted = (slideId: string): boolean =>
  useSyncExternalStore(subscribe, () => prompted === slideId);

/** The sheet of „Variante erstellen“ on a phone opened for slide `slideId` (`null`: closed). */
export function setVariantSheet(slideId: string | null): void {
  sheet = slideId;
  changed();
}

export const useVariantSheet = (): string | null => useSyncExternalStore(subscribe, () => sheet);

/** The variant with page id `pageId`, just made, becomes the active slide in „Bearbeiten“ once it is there. */
export function openVariantWhenThere(pageId: string | null): void {
  opening = pageId;
  changed();
}

export const useOpeningVariant = (): string | null =>
  useSyncExternalStore(subscribe, () => opening);

/**
 * Whether page `pageId` is the variant the AI made for proposal `proposalId`: its page ids start
 * with the run's prefix (`DeckCopy` – `ai` and the proposal id's first 8 characters).
 */
export const madeByProposal = (pageId: string, proposalId: string): boolean =>
  pageId.startsWith(`ai${proposalId.slice(0, 8)}-`);

/**
 * What the AI says it does, on a variant: it works on a copy of the deck where the variant is a
 * slide after its own („Ändert Folie 2“ for a variant of Folie 1) – here it is the variant.
 */
export const variantStep = (step: string | undefined): string | undefined =>
  step?.replace(/^Ändert (Folie \d+|die Folie)$/, 'Gestaltet die Variante');
