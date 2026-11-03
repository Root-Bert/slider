import type { Anchor } from '@slider/shared';
import { createContext, useContext } from 'react';

/**
 * Draws a box for the AI on a slide (`Draft.aiBox`) – where one's own request is still at work,
 * one adding to it (`Draft.aiThreadId`). With `threadId` (its pin clicked): only to add to that
 * thread's request at work – false when it is not, for the click to do what it does else.
 */
export type PlaceAiBox = (slideId: string, anchor: Anchor, threadId?: string) => boolean;

/** Apart from the voice state: the slides change with it only when listening starts or ends. */
export const AiBoxContext = createContext<PlaceAiBox | null>(null);

/**
 * Speaking to the AI, a box drawn on a slide – in every mode – is for the AI: no chooser, no
 * comment composer, a small field beside it takes what is said (`AiBoxComposer`). `null` while it
 * does not listen (the box is drawn as ever).
 */
export function usePlaceAiBox(): PlaceAiBox | null {
  return useContext(AiBoxContext);
}
