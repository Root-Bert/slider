import type { Author } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { insertMention, mentionQueryAt, mentions, suggestPeople } from './mentions';

const person = (name: string) => ({ id: name, name }) as Author;
const people = [person('Anna Becker'), person('Ben Ott'), person('Annika Roth')];

describe('mentionQueryAt', () => {
  it('finds the @… right before the caret', () => {
    expect(mentionQueryAt('Hallo @An', 9)).toEqual({ start: 6, query: 'An' });
    expect(mentionQueryAt('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQueryAt('@Anna Be', 8)).toEqual({ start: 0, query: 'Anna Be' });
  });

  it('ignores e-mail addresses, a space right after @ and text after the caret', () => {
    expect(mentionQueryAt('mail@host', 9)).toBeNull();
    expect(mentionQueryAt('@ Anna', 6)).toBeNull();
    expect(mentionQueryAt('Hallo', 5)).toBeNull();
    expect(mentionQueryAt('@Anna und', 1)).toEqual({ start: 0, query: '' });
  });
});

describe('suggestPeople', () => {
  it('matches the start of the name or of any word, case-insensitive', () => {
    expect(suggestPeople(people, 'an').map((p) => p.name)).toEqual(['Anna Becker', 'Annika Roth']);
    expect(suggestPeople(people, 'ro').map((p) => p.name)).toEqual(['Annika Roth']);
    expect(suggestPeople(people, 'anna b').map((p) => p.name)).toEqual(['Anna Becker']);
    expect(suggestPeople(people, '')).toHaveLength(3);
    expect(suggestPeople(people, 'xyz')).toEqual([]);
  });
});

describe('insertMention', () => {
  it('replaces the typed part and adds one space', () => {
    expect(insertMention('Hallo @An', { start: 6, query: 'An' }, 9, 'Anna Becker')).toEqual({
      text: 'Hallo @Anna Becker ',
      caret: 19,
    });
    expect(insertMention('@B schau', { start: 0, query: 'B' }, 2, 'Ben Ott')).toEqual({
      text: '@Ben Ott schau',
      caret: 8,
    });
  });
});

describe('mentions', () => {
  const names = people.map((p) => p.name);

  it('counts only whole mentions of the name', () => {
    expect(mentions('Bitte @Anna Becker prüfen', 'Anna Becker', names)).toBe(true);
    expect(mentions('mail@Anna Becker', 'Anna Becker', names)).toBe(false);
    expect(mentions('@Annika Roth', 'Anna Becker', names)).toBe(false);
  });
});
