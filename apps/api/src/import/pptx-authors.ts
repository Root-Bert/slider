import { eq, inArray } from 'drizzle-orm';
import type { Author } from '@slider/shared';
import type { CommentAuthor } from '@slider/pptx';
import { externalAuthor, ownerAuthor } from '../authors';
import type { Executor } from '../db/client';
import { decks, userIdentities, users, workspaceMembers, type UserRow } from '../db/schema';

/** Maps a PowerPoint comment author to the Slider author shown for the comment. */
export type PptxAuthorResolver = (author: CommentAuthor) => Author;

/** `providerId`s whose `userId` names a Microsoft account. */
const MICROSOFT_PROVIDERS = new Set(['AD', 'Windows Live']);

/**
 * Hex digits of an account id, lower case and without leading zeros. Makes the forms of one
 * Microsoft account comparable: the CID of a personal account (`Windows Live`) is the tail of
 * its object id `00000000-0000-0000-xxxx-xxxxxxxxxxxx`.
 */
const idKey = (id: string): string | null => {
  if (!/^[0-9a-f-]{16,36}$/i.test(id)) return null;
  return id.toLowerCase().replaceAll('-', '').replace(/^0+/, '') || null;
};

const emailKey = (value: string | null | undefined): string | null =>
  value?.includes('@') ? value.trim().toLowerCase() : null;

/**
 * Account keys of a PowerPoint author: `S::<upn>::<object id>` for work accounts (`AD`), the CID
 * for personal ones (`Windows Live`). Names are never used – two people may share one.
 */
function keysOf(author: CommentAuthor): { ids: string[]; emails: string[] } {
  if (!author.userId || !author.providerId || !MICROSOFT_PROVIDERS.has(author.providerId)) {
    return { ids: [], emails: [] };
  }
  const parts = author.userId.split('::');
  return {
    ids: parts.map(idKey).filter((key): key is string => key !== null),
    emails: parts.map(emailKey).filter((key): key is string => key !== null),
  };
}

/**
 * Recognises PowerPoint comments written by members of the deck's workspace through the
 * Microsoft account in the file (`ppt/authors.xml`): its object id or CID against the Microsoft
 * login and the connected OneDrive account, its UPN against their e-mail addresses. Recognised
 * authors show as themselves (avatar, colour, own comment); everyone else stays a PowerPoint
 * author. Legacy comments name nobody's account.
 */
export async function pptxAuthorResolver(
  db: Executor,
  deckId: string,
): Promise<PptxAuthorResolver> {
  const [deck] = await db
    .select({ workspaceId: decks.workspaceId, ownerId: decks.ownerId })
    .from(decks)
    .where(eq(decks.id, deckId));
  const members: UserRow[] = deck
    ? (
        await db
          .select({ user: users })
          .from(workspaceMembers)
          .innerJoin(users, eq(users.id, workspaceMembers.userId))
          .where(eq(workspaceMembers.workspaceId, deck.workspaceId))
      ).map((row) => row.user)
    : [];
  const identities = members.length
    ? await db
        .select()
        .from(userIdentities)
        .where(
          inArray(
            userIdentities.userId,
            members.map((member) => member.id),
          ),
        )
    : [];

  const byId = new Map<string, Set<string>>();
  const byEmail = new Map<string, Set<string>>();
  const add = (index: Map<string, Set<string>>, key: string | null, userId: string) => {
    if (!key) return;
    const set = index.get(key) ?? new Set<string>();
    set.add(userId);
    index.set(key, set);
  };
  for (const member of members) {
    add(byId, member.msSubject ? idKey(member.msSubject) : null, member.id);
    add(byEmail, emailKey(member.msAccount), member.id);
    add(byEmail, emailKey(member.email), member.id);
  }
  for (const identity of identities) {
    // Microsoft login subjects are `<tenant id>:<object id>`.
    if (identity.provider === 'microsoft')
      add(byId, idKey(identity.subject.split(':').at(-1) ?? ''), identity.userId);
    add(byEmail, emailKey(identity.email), identity.userId);
  }

  const userById = new Map(members.map((member) => [member.id, member]));
  // One Microsoft account may be connected to two Slider accounts: then the deck owner's wins,
  // otherwise nobody is guessed.
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
    const { ids, emails } = keysOf(author);
    const user =
      ids.map((key) => pick(byId.get(key))).find(Boolean) ??
      emails.map((key) => pick(byEmail.get(key))).find(Boolean) ??
      null;
    const resolved = user ? ownerAuthor(user) : externalAuthor(author.name);
    cache.set(cacheKey, resolved);
    return resolved;
  };
}
