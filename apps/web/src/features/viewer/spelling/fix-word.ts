import type { LiveParagraph } from '@slider/shared';
import { misspeltAt, type KnowsWord } from './words';

/**
 * The text with a misspelt word put right: its `occurrence`-th time misspelt in the text (from 0,
 * as `MisspeltWords` counts them) replaced by `fix`, in the style of its first letter. `null`:
 * the word is no longer there (the text changed meanwhile).
 */
export function fixWord(
  paragraphs: readonly LiveParagraph[],
  word: string,
  occurrence: number,
  fix: string,
  knows: KnowsWord,
): LiveParagraph[] | null {
  let seen = 0;
  for (const [index, paragraph] of paragraphs.entries()) {
    const text = paragraph.runs.map((run) => run.text).join('');
    for (const found of misspeltAt(text, knows)) {
      if (found.word !== word) continue;
      if (seen++ < occurrence) continue;
      let at = 0;
      let placed = false;
      const runs = paragraph.runs.map((run) => {
        const from = at;
        at += run.text.length;
        // Outside the word: as it was. Its letters: cut out, the fix in the first run it is in.
        if (at <= found.start || from >= found.end) return run;
        const before = run.text.slice(0, Math.max(0, found.start - from));
        const after = run.text.slice(Math.max(0, found.end - from));
        const middle = placed ? '' : fix;
        placed = true;
        return { ...run, text: before + middle + after };
      });
      return paragraphs.map((p, i) => (i === index ? { ...p, runs } : p));
    }
  }
  return null;
}
