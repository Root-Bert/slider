import { describe, expect, it } from 'vitest';

/**
 * The text fields in a `field-well` (AutosizeTextarea sets `outline-none`) show their focus only
 * through the well's `focus-field` edge – a well without it leaves keyboard users no focus at all
 * (WCAG 2.4.7): the comment edit field, the notes of the voice/video and sketch replies.
 */
const sources = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('text fields in a well', () => {
  it('show their focus (field-well comes with focus-field)', () => {
    const wells = Object.entries(sources).flatMap(([path, source]) =>
      [...source.matchAll(/(["'`])([^"'`\n]*\bfield-well\b[^"'`\n]*)\1/g)].map(
        (match) => [path, match[2]!] as const,
      ),
    );
    expect(wells.length).toBeGreaterThanOrEqual(5);
    expect(wells.filter(([, classes]) => !/\bfocus-field\b/.test(classes))).toEqual([]);
  });
});
