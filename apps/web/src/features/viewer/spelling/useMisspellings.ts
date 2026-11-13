import type { Shape } from '@slider/shared';
import { useMemo } from 'react';
import { useAcceptedWords } from './accepted-words';
import { useSpellChecker } from './spell-checker';
import { misspelledWords, type KnowsWord } from './words';

export interface Misspelling {
  shape: Shape;
  /** Its words no dictionary knows, each once. */
  words: string[];
}

const NONE: Misspelling[] = [];

/**
 * The spell check with the words one said are right (`acceptWord`): `null` until the
 * dictionaries are there (`useSpellChecker`).
 */
export function useKnowsWord(wanted: boolean): KnowsWord | null {
  const knows = useSpellChecker(wanted);
  const accepted = useAcceptedWords();
  return useMemo(
    () => knows && (accepted.size === 0 ? knows : (word) => accepted.has(word) || knows(word)),
    [knows, accepted],
  );
}

/**
 * The boxes of a slide with misspelt words (`GuideLayer` marks them, the guides button tells of
 * them). `wanted`: loads the dictionaries if they are not there yet (`useSpellChecker`); empty
 * until they are.
 */
export function useMisspellings(
  shapes: readonly Shape[] | undefined,
  wanted: boolean,
): Misspelling[] {
  const knows = useKnowsWord(wanted);
  return useMemo(() => {
    if (!knows || !shapes) return NONE;
    const found = shapes.flatMap((shape) => {
      const words = shape.text ? misspelledWords(shape.text, knows) : [];
      return words.length > 0 ? [{ shape, words }] : [];
    });
    return found.length > 0 ? found : NONE;
  }, [knows, shapes]);
}
