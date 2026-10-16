import { describe, expect, it } from 'vitest';
import type { Author } from '@slider/shared';
import { displayAuthor, externalAuthor } from '../src/authors';

describe('externalAuthor', () => {
  it('identifies PowerPoint authors by their trimmed, lower-cased name', () => {
    expect(externalAuthor('  Anna Becker ')).toEqual({
      id: 'pptx:anna becker',
      name: 'Anna Becker',
      type: 'external',
      color: 'powerpoint',
    });
  });

  it('names an author without a name "Unbekannt"', () => {
    expect(externalAuthor('   ')).toMatchObject({ id: 'pptx:', name: 'Unbekannt' });
  });
});

describe('displayAuthor', () => {
  it('shows PowerPoint authors in orange, also from older imports', () => {
    const old: Author = { id: 'pptx:anna', name: 'Anna', type: 'external', color: 'blue' };
    expect(displayAuthor(old)).toEqual({ ...old, color: 'powerpoint' });
  });

  it('returns other authors unchanged (same reference)', () => {
    const external = externalAuthor('Anna');
    const owner: Author = { id: 'u1', name: 'Robert', type: 'owner', color: 'blue' };
    expect(displayAuthor(external)).toBe(external);
    expect(displayAuthor(owner)).toBe(owner);
  });
});
