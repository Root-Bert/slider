import type { OdpSlide } from '@slider/odp';
import { describe, expect, it } from 'vitest';
import { pairSlides } from '../src/services/edits/commit';

/* How a step's slides are the slides of the file before it (`commitStep`). */

/** Slides of a file: page id and what is drawn of it (`fingerprint`), in file order. */
const file = (...slides: [pageId: string, fingerprint: string, hidden?: boolean][]): OdpSlide[] =>
  slides.map(([pageId, fingerprint, hidden = false], index) => ({
    index,
    name: pageId,
    hidden,
    background: null,
    ownBackground: false,
    backgroundFills: [],
    transition: null,
    notes: '',
    variantOf: null,
    elements: [],
    title: pageId,
    fingerprint,
    pageId,
  }));

describe('pairing the slides of two steps', () => {
  it('follows slides by page id, hidden or shown counting as changed, and by position before page ids', () => {
    {
      const before = file(['a', '1'], ['b', '1'], ['c', '1']);
      const after = file(['c', '1'], ['a', '2'], ['n', '1']);
      expect(pairSlides(before, after, true)).toEqual({
        source: [2, 0, null],
        removed: [1],
        changed: new Set([1, 2]),
      });
    }
    {
      const before = file(['a', '1'], ['b', '1']);
      const after = file(['a', '1'], ['b', '1', true]);
      expect(pairSlides(before, after, true).changed).toEqual(new Set([1]));
    }
    {
      const before = file(['x1', '1'], ['x2', '1']);
      const after = file(['y1', '1'], ['y2', '2'], ['y3', '1']);
      expect(pairSlides(before, after, false)).toEqual({
        source: [0, 1, null],
        removed: [],
        changed: new Set([1, 2]),
      });
    }
  });
});
