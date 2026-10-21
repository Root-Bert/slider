import { eq, inArray } from 'drizzle-orm';
import type { Author, DeckSource } from '@slider/shared';
import type { CommentAuthor } from '@slider/pptx';
import { externalAuthor, ownerAuthor } from '../authors';
import type { Executor } from '../db/client';
import {
  decks,
  googleConnections,
  microsoftConnections,
  users,
  workspaceMembers,
  type UserRow,
} from '../db/schema';

/** Maps a PowerPoint comment author to the Slider author shown for the comment. */
export type PptxAuthorResolver = (author: CommentAuthor) => Author;

/** `providerId`s whose `userId` names a Microsoft account. */
const MICROSOFT_PROVIDERS = new Set(['AD', 'Windows Live']);

/**
 * Sources whose files Slider reads from the organisation's own storage. Only there is the account
 * a comment names trusted to be the member's: an uploaded file (or a plain web link) can name
 * anyone's address or id.
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
 * account, the address of a Google account. Only addresses count – no ids, never names.
 */
function emailsOf(author: CommentAuthor): string[] {
  // Google comments (BER-157) name the Google account's address, when Google shows it. Only
  // Drive's comment API sets it; a file claiming `providerId="Google"` is no Microsoft account and
  // names nobody.
  if (author.googleAccount !== undefined) {
    const email = emailKey(author.googleAccount);
    return email ? [email] : [];
  }
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
 * (`ppt/authors.xml`, Google's comment author) – never by id or name: against the members' own
 * addresses and the Microsoft and Google accounts they connected (case-insensitive, exact), never
 * a login's address, which any Nextcloud server may claim. Recognised authors show as themselves (avatar, colour, own
 * comment); everyone else, and every author of an uploaded file, stays a PowerPoint author.
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
  const memberIds = members.map((member) => member.id);
  const connections = members.length
    ? await db
        .select({ userId: microsoftConnections.userId, account: microsoftConnections.account })
        .from(microsoftConnections)
        .where(inArray(microsoftConnections.userId, memberIds))
    : [];
  const googleAccounts = members.length
    ? await db
        .select({ userId: googleConnections.userId, account: googleConnections.account })
        .from(googleConnections)
        .where(inArray(googleConnections.userId, memberIds))
    : [];

  const byEmail = new Map<string, Set<string>>();
  const add = (key: string | null, userId: string) => {
    if (!key) return;
    const set = byEmail.get(key) ?? new Set<string>();
    set.add(userId);
    byEmail.set(key, set);
  };
  for (const member of members) add(emailKey(member.email), member.id);
  // Every Microsoft account connected for file access counts as the member's, and every Google
  // account connected for Drive (BER-157).
  for (const connection of connections) add(emailKey(connection.account), connection.userId);
  for (const connection of googleAccounts) add(emailKey(connection.account), connection.userId);

  const userById = new Map(members.map((member) => [member.id, member]));
  // One account may be connected to two Slider accounts: then the deck owner's wins, otherwise
  // nobody is guessed.
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
    const cacheKey = `${author.googleAccount ?? ''}|${author.providerId ?? ''}|${author.userId ?? ''}|${author.name}`;
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
