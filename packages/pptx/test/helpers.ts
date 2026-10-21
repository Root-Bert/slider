import { openPptx, type PptxPackage } from '../src';
import { buildPptx, type DeckSpec } from './fixtures/build-pptx';

/** Builds a fixture deck and opens it with the parser. */
export async function openDeck(deck: DeckSpec): Promise<PptxPackage> {
  return openPptx(await buildPptx(deck));
}

/** Throws unless the value is defined – keeps tests free of non-null assertions. */
export function defined<T>(value: T | undefined | null, what = 'value'): T {
  if (value === undefined || value === null) throw new Error(`Expected ${what} to be defined`);
  return value;
}
