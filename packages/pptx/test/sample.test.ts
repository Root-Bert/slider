import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { SAMPLE_PATH, sampleDeck } from '../scripts/sample-deck';
import { openPptx } from '../src';
import { buildPptx } from './fixtures/build-pptx';

describe('samples/slider-demo.pptx', () => {
  it('is byte-identical to a fresh build (run `bun run sample` after changing the deck)', async () => {
    const [committed, fresh] = await Promise.all([readFile(SAMPLE_PATH), buildPptx(sampleDeck)]);
    expect(Buffer.from(fresh).equals(committed)).toBe(true);
  });

  it('builds deterministically', async () => {
    const [first, second] = await Promise.all([buildPptx(sampleDeck), buildPptx(sampleDeck)]);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it('parses into the advertised demo content', async () => {
    const { presentation } = await openPptx(await readFile(SAMPLE_PATH));
    expect(presentation.slides).toHaveLength(6);
    expect(presentation.slides.filter((slide) => slide.hidden)).toHaveLength(1);
    expect(presentation.sections.map((section) => section.name)).toEqual([
      'Einleitung',
      'Analyse',
      'Abschluss',
    ]);
    expect(presentation.comments.map((comment) => comment.format).sort()).toEqual([
      'legacy',
      'modern',
      'modern',
    ]);
  });
});
