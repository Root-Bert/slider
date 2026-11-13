import { useEffect, useSyncExternalStore } from 'react';
import type { KnowsWord } from './words';

/** Where the dictionaries are served (`spellAssets` in `vite.config.ts`). */
const SPELL_BASE = '/spell/';
/** A word is right when one of them knows it: decks mix German and English. */
const LANGUAGES = ['de', 'en'] as const;

let knows: KnowsWord | null = null;
let suggest: ((word: string) => string[]) | null = null;
/** At most this many words offered for a misspelt one (its right click). */
const MAX_SUGGESTIONS = 3;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Letters to add, drop or change to turn one word into the other (Levenshtein). */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        row[j]! + 1,
        next[j - 1]! + 1,
        row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return row[b.length]!;
}

async function load(): Promise<void> {
  // Hunspell as WebAssembly: the JavaScript checkers do not know German compounds. Its CommonJS
  // build: the ES one imports its runtime as a namespace, which no bundler can call
  // („runtimeModule is not a function“).
  const [{ loadModule }, files] = await Promise.all([
    import('hunspell-asm/dist/cjs/index.js'),
    Promise.all(
      LANGUAGES.flatMap((language) =>
        ['aff', 'dic'].map(async (kind) => {
          const response = await fetch(`${SPELL_BASE}${language}.${kind}`);
          if (!response.ok) throw new Error(`Wörterbuch ${language}.${kind} fehlt.`);
          return new Uint8Array(await response.arrayBuffer());
        }),
      ),
    ),
  ]);
  const factory = await loadModule();
  const checkers = LANGUAGES.map((language, index) =>
    factory.create(
      factory.mountBuffer(files[index * 2]!, `${language}.aff`),
      factory.mountBuffer(files[index * 2 + 1]!, `${language}.dic`),
    ),
  );
  const seen = new Map<string, boolean>();
  knows = (word) => {
    let known = seen.get(word);
    if (known === undefined) {
      known = checkers.some((checker) => checker.spell(word));
      seen.set(word, known);
    }
    return known;
  };
  // Nearest to the word first, from either dictionary – a German slip's fix before an English
  // guess; alike near, each dictionary's own order.
  suggest = (word) => {
    const ranked = checkers.flatMap((checker) =>
      checker.suggest(word).map((fix, rank) => ({ fix, rank, distance: distance(word, fix) })),
    );
    ranked.sort((a, b) => a.distance - b.distance || a.rank - b.rank);
    return [...new Set(ranked.map(({ fix }) => fix))].slice(0, MAX_SUGGESTIONS);
  };
  for (const listener of listeners) listener();
}

/** Words that may have been meant by a misspelt one – none until the dictionaries are there. */
export const suggestionsFor = (word: string): string[] => suggest?.(word) ?? [];

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * The spell check of the guides view: `null` until its dictionaries are there. Loaded once
 * `wanted` (the view is shown) – a megabyte or two nobody else pays for – and kept from then on,
 * so the guides button can tell of misspelt words with the view hidden again. Without the
 * dictionaries (offline) it stays `null`: nothing is marked, and the next time tries again.
 */
export function useSpellChecker(wanted: boolean): KnowsWord | null {
  const current = useSyncExternalStore(subscribe, () => knows);
  useEffect(() => {
    if (!wanted || knows || loading) return;
    loading = load().catch(() => {
      loading = null;
    });
  }, [wanted]);
  return current;
}
