import type { Author } from '@slider/shared';
import { tokenizeBody } from './comment-body';

/**
 * @mentions (BER-105): typing `@` in a comment field suggests the people in the deck; picking one
 * writes `@Name` into the text. Mentions stay plain text – `comment-body` highlights them.
 */

export interface MentionQuery {
  /** Index of the `@`. */
  start: number;
  /** What was typed after the `@`, up to the caret. */
  query: string;
}

/** The `@…` being typed right before the caret, or `null`. Names may hold spaces ("Anna Be"). */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  const match = /(?:^|[^\p{L}\p{N}])@([\p{L}\p{N}_.\- ]{0,40})$/u.exec(text.slice(0, caret));
  const query = match?.[1];
  if (query === undefined || query.startsWith(' ') || query.includes('  ')) return null;
  return { start: caret - query.length - 1, query };
}

const normalise = (value: string) => value.toLocaleLowerCase('de');

/**
 * People whose name, or a word of it, starts with `query`; in the given order. All of them – the
 * menu scrolls: a cap hid the workspace's members behind the deck's own people.
 */
export function suggestPeople(people: readonly Author[], query: string): Author[] {
  const wanted = normalise(query);
  return people.filter((person) => {
    const name = normalise(person.name);
    return name.startsWith(wanted) || name.split(/\s+/).some((word) => word.startsWith(wanted));
  });
}

/** Replaces the typed `@…` with `@Name ` and returns the new text and caret. */
export function insertMention(
  text: string,
  mention: MentionQuery,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const after = text.slice(caret);
  const inserted = `@${name}${after.startsWith(' ') ? '' : ' '}`;
  return {
    text: text.slice(0, mention.start) + inserted + after,
    caret: mention.start + inserted.length,
  };
}

/** Whether `body` mentions `name`; `knownNames` lets "@Anna Becker" count as one mention. */
export const mentions = (body: string, name: string, knownNames: readonly string[]) =>
  body.includes(`@${name}`) &&
  tokenizeBody(body, knownNames).some(
    (token) => token.type === 'mention' && token.text === `@${name}`,
  );
