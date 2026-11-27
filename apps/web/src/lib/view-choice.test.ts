import { describe, expect, it } from 'vitest';
import { openingView } from './view-choice';

const CLOUD = ['list', 'tiles', 'columns'] as const;
const DECKS = ['grid', 'list'] as const;
const AREAS = ['folders', 'people'] as const;

describe('openingView', () => {
  it('opens as last there on auto, else always as the setting’s rows or tiles', () => {
    // Automatisch: the page's own last, then what it inherits, then its own default.
    expect(openingView(CLOUD, 'list', 'auto', ['columns', 'tiles'])).toBe('columns');
    expect(openingView(CLOUD, 'list', 'auto', [null, 'tiles'])).toBe('tiles');
    expect(openingView(CLOUD, 'list', 'auto', ['bogus', null])).toBe('list');
    expect(openingView(DECKS, 'grid', 'auto', [null])).toBe('grid');
    // Liste / Kacheln: whatever was last – „Kacheln“ is the page's word for its tiles.
    expect(openingView(CLOUD, 'list', 'tiles', ['columns'])).toBe('tiles');
    expect(openingView(DECKS, 'list', 'tiles', ['list'])).toBe('grid');
    expect(openingView(DECKS, 'grid', 'list', ['grid'])).toBe('list');
    // A page without rows and tiles keeps its own default.
    expect(openingView(AREAS, 'folders', 'tiles', ['people'])).toBe('folders');
  });
});
