import { describe, expect, it } from 'vitest';
import type { SlideLayers } from '@slider/shared';
import { morphPictures, morphPlan } from './morph';

const box = (x: number) => ({ x, y: 0.1, w: 0.2, h: 0.2 });
const layers = (background: string, items: [string, number | null][]): SlideLayers => ({
  seq: 1,
  background,
  layers: items.map(([elementId, x]) => ({
    elementId,
    url: x === null ? null : `/${background}/${elementId}.png`,
    box: x === null ? null : box(x),
  })),
});

describe('morphPlan', () => {
  it('glides elements met by key, fades out the left ones and in the new ones, pasted twice met in order', () => {
    const from = layers('a', [
      ['t', 0.1],
      ['gone', 0.5],
      ['dup', 0.3],
      ['blank', null],
    ]);
    const to = layers('b', [
      ['new', 0.7],
      ['t2', 0.6],
      ['dup2', 0.2],
      ['dup3', 0.4],
    ]);
    const plan = morphPlan(
      from,
      [{ id: 't' }, { id: 'gone' }, { id: 'dup' }, { id: 'blank' }],
      to,
      [
        { id: 'new' },
        { id: 't2', morphKey: 't' },
        { id: 'dup2', morphKey: 'dup' },
        { id: 'dup3', morphKey: 'dup' },
      ],
    );
    expect(plan.leaving.map((part) => part.key)).toEqual(['gone']);
    expect(plan.coming.map((part) => [part.key, part.from?.box.x ?? null, part.to?.box.x])).toEqual(
      [
        ['new', null, 0.7],
        ['t', 0.1, 0.6],
        ['dup', 0.3, 0.2],
        ['dup', null, 0.4],
      ],
    );
    expect(morphPictures(plan)).toContain('/a/gone.png');

    // Without keys (a slide made anew, the text typed or pasted before keys): the same text,
    // else the same name, in the same kind of element.
    const loose = morphPlan(
      layers('a', [
        ['shape', 0.1],
        ['title', 0.2],
        ['box', 0.3],
      ]),
      [
        { id: 'shape', kind: 'shape', name: 'Rechteck 1', paragraphs: null },
        { id: 'title', kind: 'text', name: 'Textfeld 1', paragraphs: ['Slider'] },
        { id: 'box', kind: 'text', name: 'Textfeld 2', paragraphs: ['alt'] },
      ],
      layers('b', [
        ['title2', 0.5],
        ['box2', 0.6],
      ]),
      [
        { id: 'title2', kind: 'text', name: 'Textfeld 9', paragraphs: ['Slider'] },
        { id: 'box2', kind: 'text', name: 'Textfeld 2', paragraphs: ['neu'] },
      ],
    );
    expect(loose.coming.map((part) => part.from?.box.x)).toEqual([0.2, 0.3]);
    expect(loose.leaving.map((part) => part.key)).toEqual(['shape']);
    expect(morphPictures(plan)).not.toContain('/a/blank.png');
  });
});
