import type { AccountAuthor, Author } from '@slider/shared';
import type { UserRow } from './db/schema';

export const ownerAuthor = (user: UserRow): AccountAuthor => ({
  id: user.id,
  name: user.name,
  type: 'owner',
  color: user.color,
});

/** Someone who commented in PowerPoint without a matching Slider account; identified by name only. */
export const externalAuthor = (name: string): Author => ({
  id: `pptx:${name.trim().toLowerCase()}`,
  name: name.trim() || 'Unbekannt',
  type: 'external',
  color: 'powerpoint',
});

/**
 * An author snapshot as shown: PowerPoint authors are always orange. Older imports stored them
 * with a colour hashed from the name.
 */
export const displayAuthor = (author: Author): Author =>
  author.type === 'external' && author.color !== 'powerpoint'
    ? { ...author, color: 'powerpoint' }
    : author;
