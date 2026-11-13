import type { LiveParagraph } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { fixWord } from '../../spelling/fix-word';
import { misspeltAt, misspelledWords } from '../../spelling/words';
import { countByStatus, doneByAi, isBareSticker, type Thread } from './comment-selectors';

describe('threads', () => {
  it('sort into the filter by status', () => {
    // The filter: what the AI asks back about waits under "KI"; a done thread is done whatever
    // the AI asks, and one the AI did itself says so.
    const open = (id: string, status = 'open') => ({ id, root: { status } }) as Thread;
    const asking = new Set(['asks', 'resolved']);
    const listed = [open('plain'), open('asks'), open('resolved', 'done')];
    expect(countByStatus(listed, null, asking)).toEqual({ all: 3, open: 1, ai: 1, done: 1 });
    expect(countByStatus(listed)).toEqual({ all: 3, open: 2, ai: 0, done: 1 });
    expect(doneByAi({ status: 'done', resolvedBy: 'ai' })).toBe(true);
    expect(doneByAi({ status: 'done', resolvedBy: 'u1' })).toBe(false);
    expect(doneByAi({ status: 'open', resolvedBy: 'ai' })).toBe(false);

    // A sticker sent alone is all on the slide (no card); with a comment of its own or a reply
    // it is a thread like any.
    const sticker = (body: string, replies: unknown[] = []) =>
      ({ root: { body, strokes: [{ tool: 'text', text: 'Hallo' }] }, replies }) as Thread;
    expect(isBareSticker(sticker('Hallo '))).toBe(true);
    expect(isBareSticker(sticker('Dazu noch was'))).toBe(false);
    expect(isBareSticker(sticker('Hallo', [{}]))).toBe(false);

    // The guides view's spell check: hyphenated words are known by their parts; numbers,
    // abbreviations and addresses are no words; each misspelt word is named once.
    const known = new Set(
      'Unsere für mehr Vertriebs- und Produktplanung der Controlling Report a plan with word again Mehr auf oder an Liste'.split(
        ' ',
      ),
    );
    const knows = (word: string) => known.has(word);
    expect(
      misspelledWords(
        'Unsere Stratgie für Q4 2026: mehr Umsaz, Vertriebs- und Produktplanung, der ' +
          'Controlling-Report (KPI) – a plan with a mispelled word, Stratgie again. ' +
          'Mehr auf www.beispiel.de oder an info@beispiel.de, Tipfehler-Liste.',
        knows,
      ),
    ).toEqual(['Stratgie', 'Umsaz', 'mispelled', 'Tipfehler-Liste']);

    // Where they stand (`MisspeltWords` reads a text whole, its paragraphs joined by „\n“): a
    // repeated word each time, a paragraph's last word not run on into the next, a line break
    // inside a run a break too.
    expect(misspeltAt('Stratgie mehr Stratgie\nUmsaz\nmehr', knows)).toEqual([
      { word: 'Stratgie', start: 0, end: 8 },
      { word: 'Stratgie', start: 14, end: 22 },
      { word: 'Umsaz', start: 23, end: 28 },
    ]);

    // A suggestion picked (`fixWord`): the how-manyth time the word is misspelt, counted over
    // the paragraphs as `MisspeltWords` counts it in the text read whole; a word split over runs
    // goes into the first run's style, the rest of the runs kept; gone, `null`.
    const paragraphs = (...texts: string[][]) =>
      texts.map((runs) => ({
        runs: runs.map((text, index) => ({ text, bold: index === 0 })),
      })) as unknown as LiveParagraph[];
    const texts = (fixed: LiveParagraph[] | null) =>
      fixed?.map((paragraph) => paragraph.runs.map((run) => run.text));
    const split = paragraphs(['Die Strat', 'gie hier'], ['noch ', 'Stratgie\nmehr Stratgie']);
    expect(texts(fixWord(split, 'Stratgie', 0, 'Strategie', knows))).toEqual([
      ['Die Strategie', ' hier'],
      ['noch ', 'Stratgie\nmehr Stratgie'],
    ]);
    expect(fixWord(split, 'Stratgie', 0, 'Strategie', knows)![0]!.runs[0]!.bold).toBe(true);
    expect(texts(fixWord(split, 'Stratgie', 2, 'Strategie', knows))).toEqual([
      ['Die Strat', 'gie hier'],
      ['noch ', 'Stratgie\nmehr Strategie'],
    ]);
    const whole = split.map((p) => p.runs.map((run) => run.text).join('')).join('\n');
    expect(misspeltAt(whole, knows).filter(({ word }) => word === 'Stratgie')).toHaveLength(3);
    expect(fixWord(split, 'Stratgie', 3, 'Strategie', knows)).toBeNull();
  });
});
