import { eq } from 'drizzle-orm';
import type { Author, DeckSource } from '@slider/shared';
import type { CommentAuthor } from '@slider/pptx';
import { externalAuthor, ownerAuthor } from '../authors';
import type { Executor } from '../db/client';
import { decks, users, workspaceMembers, type UserRow } from '../db/schema';

/** Maps a PowerPoint comment author to the Slider author shown for the comment. */
export type PptxAuthorResolver = (author: CommentAuthor) => Author;

/** `providerId`s whose `userId` names a Microsoft account. */
const MICROSOFT_PROVIDERS = new Set(['AD', 'Windows Live']);

/**
 * Sources whose files Slider reads (or once read) from the organisation's own storage. Only there
 * is the account a comment names trusted to be the member's: an uploaded file (or a plain web
 * link) can name anyone's address or id.
 */
const TRUSTED_SOURCES: ReadonlySet<DeckSource> = new Set([
  'onedrive',
  'sharepoint',
  'nextcloud',
  'google',
]);

const emailKey = (value: string | null | undefined): string | null =>
  value?.includes('@') ? value.trim().toLowerCase() : null;

/**
 * The addresses a PowerPoint author names: the UPN in `S::<upn>::<object id>` of a Microsoft
 * account. Only addresses count – no ids, never names. A file claiming `providerId="Google"` is
 * no Microsoft account and names nobody.
 */
function emailsOf(author: CommentAuthor): string[] {
  if (!author.userId || !author.providerId || !MICROSOFT_PROVIDERS.has(author.providerId)) {
    return [];
  }
  return author.userId
    .split('::')
    .map(emailKey)
    .filter((key): key is string => key !== null);
}

/**
 * Recognises comments written by members of the deck's workspace – in linked decks only (see
 * `TRUSTED_SOURCES`), and only by the address of the account named in the file
 * (`ppt/authors.xml`) – never by id or name: against the members' own addresses
 * (case-insensitive, exact), never a login's address, which any Nextcloud server may claim.
 * Recognised authors show as themselves (avatar, colour, own comment); everyone else, and every
 * author of an uploaded file, stays a PowerPoint author.
 * Legacy comments name nobody's account.
 */
export async function pptxAuthorResolver(
  db: Executor,
  deckId: string,
): Promise<PptxAuthorResolver> {
  const [deck] = await db
    .select({ workspaceId: decks.workspaceId, ownerId: decks.ownerId, source: decks.source })
    .from(decks)
    .where(eq(decks.id, deckId));
  const members: UserRow[] =
    deck && TRUSTED_SOURCES.has(deck.source)
      ? (
          await db
            .select({ user: users })
            .from(workspaceMembers)
            .innerJoin(users, eq(users.id, workspaceMembers.userId))
            .where(eq(workspaceMembers.workspaceId, deck.workspaceId))
        ).map((row) => row.user)
      : [];

  const byEmail = new Map<string, Set<string>>();
  const add = (key: string | null, userId: string) => {
    if (!key) return;
    const set = byEmail.get(key) ?? new Set<string>();
    set.add(userId);
    byEmail.set(key, set);
  };
  for (const member of members) add(emailKey(member.email), member.id);

  const userById = new Map(members.map((member) => [member.id, member]));
  // Two members with one address: then the deck owner's wins, otherwise nobody is guessed.
  const pick = (candidates: ReadonlySet<string> | undefined): UserRow | null => {
    if (!candidates?.size) return null;
    const id =
      candidates.size === 1
        ? [...candidates][0]
        : deck && candidates.has(deck.ownerId)
          ? deck.ownerId
          : undefined;
    return (id && userById.get(id)) || null;
  };

  const cache = new Map<string, Author>();
  return (author) => {
    const cacheKey = `${author.providerId ?? ''}|${author.userId ?? ''}|${author.name}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const user = emailsOf(author)
      .map((key) => pick(byEmail.get(key)))
      .find(Boolean);
    const resolved = user ? ownerAuthor(user) : externalAuthor(author.name);
    cache.set(cacheKey, resolved);
    return resolved;
  };
}
