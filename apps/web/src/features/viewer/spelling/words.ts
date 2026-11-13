/** Whether a dictionary knows the word as it is written. */
export type KnowsWord = (word: string) => boolean;

/** A run of letters and digits, with the hyphens and apostrophes inside it. */
const TOKEN = /[\p{L}\p{N}](?:[\p{L}\p{N}\p{M}'’-]*[\p{L}\p{N}\p{M}])?-?/gu;
/** Addresses are no words: a link, a mail address, a file or host name. */
const ADDRESS = /\S*(?:@|:\/\/|www\.|\.[a-z]{2,}\b)\S*/giu;

/** A misspelt word where it stands in a text: its characters `start` to `end` (not included). */
export interface WordAt {
  word: string;
  start: number;
  end: number;
}

/**
 * The words of `text` no dictionary knows, each where it stands. Left alone: what is no word
 * (numbers, „Q4“, addresses), single letters and abbreviations in capitals. A hyphenated word is
 * right when it is known whole or each of its parts is – „Controlling-Report“, „Vertriebs- und
 * Produktplanung“.
 */
export function misspeltAt(text: string, knows: KnowsWord): WordAt[] {
  const found: WordAt[] = [];
  // Addresses blanked out as long as they are: the words keep their places.
  const words = text.replace(ADDRESS, (address) => ' '.repeat(address.length));
  for (const match of words.matchAll(TOKEN)) {
    const token = match[0];
    if (/\p{N}/u.test(token)) continue;
    const word = token.replace(/-$/, '');
    if (word.length < 2 || word === word.toUpperCase()) continue;
    if (knows(word) || knows(token)) continue;
    const parts = word.split('-');
    const known = (part: string) =>
      part.length < 2 || part === part.toUpperCase() || knows(part) || knows(`${part}-`);
    if (parts.length > 1 && parts.every(known)) continue;
    found.push({ word, start: match.index, end: match.index + word.length });
  }
  return found;
}

/** The words of `text` no dictionary knows, each once, in the order they come (`misspeltAt`). */
export function misspelledWords(text: string, knows: KnowsWord): string[] {
  return [...new Set(misspeltAt(text, knows).map(({ word }) => word))];
}
