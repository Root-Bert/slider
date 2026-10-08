import { expect, it } from 'vitest';
import { gapLabel, locationLabel, shapeLabel } from './labels';

const index = new Map([
  ['s1', 0],
  ['s2', 1],
]);
const indexOf = (id: string) => index.get(id);

it('describes gaps between, before and after slides', () => {
  expect(gapLabel({ type: 'gap', afterSlideId: 's1', beforeSlideId: 's2' }, indexOf)).toBe(
    'Zwischen Folie 1 und 2',
  );
  expect(gapLabel({ type: 'gap', afterSlideId: 's2', beforeSlideId: null }, indexOf)).toBe(
    'Nach Folie 2',
  );
  expect(gapLabel({ type: 'gap', afterSlideId: null, beforeSlideId: 's1' }, indexOf)).toBe(
    'Vor Folie 1',
  );
});

it('labels slide comments with their 1-based number', () => {
  expect(locationLabel({ type: 'slide' }, 's2', indexOf)).toBe('Folie 2');
});

it('names a PowerPoint shape with the start of its text', () => {
  expect(shapeLabel({ name: 'Bild 4', text: '' })).toBe('Bild 4');
  expect(shapeLabel({ name: 'Titel 1', text: 'So funktioniert\n„Vorstand“' })).toBe(
    'Titel 1 · „So funktioniert „Vorstand““',
  );
  expect(shapeLabel({ name: 'Textfeld 3', text: 'a'.repeat(40) })).toBe(
    `Textfeld 3 · „${'a'.repeat(32)}…“`,
  );
});
