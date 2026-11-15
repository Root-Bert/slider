import { and, asc, count, eq } from 'drizzle-orm';
import { SPELLING_WORDS_MAX, type SpellingWord } from '@slider/shared';
import { userWords, users, workspaceWords } from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest } from '../http/errors';
import { requireRole } from './workspaces';

/*
 * The spell check's own words (`@slider/shared` spelling): the account's and each workspace's.
 * Adding one twice keeps the first; each call answers with the whole list as it is now.
 */

const tooMany = () =>
  badRequest(`Mehr als ${SPELLING_WORDS_MAX.toLocaleString('de-DE')} Wörter gehen nicht.`);

/** The account's own words, A–Z. */
export async function listUserWords(deps: AppDeps, userId: string): Promise<SpellingWord[]> {
  const rows = await deps.db
    .select({ word: userWords.word, createdAt: userWords.createdAt })
    .from(userWords)
    .where(eq(userWords.userId, userId))
    .orderBy(asc(userWords.word));
  return rows.map((row) => ({
    word: row.word,
    createdAt: row.createdAt.toISOString(),
    addedBy: null,
  }));
}

export async function addUserWord(
  deps: AppDeps,
  userId: string,
  word: string,
): Promise<SpellingWord[]> {
  const [{ n } = { n: 0 }] = await deps.db
    .select({ n: count() })
    .from(userWords)
    .where(eq(userWords.userId, userId));
  if (n >= SPELLING_WORDS_MAX) throw tooMany();
  await deps.db.insert(userWords).values({ userId, word }).onConflictDoNothing();
  return listUserWords(deps, userId);
}

/** A word that isn't there (any more) is no error: the list is as asked either way. */
export async function removeUserWord(
  deps: AppDeps,
  userId: string,
  word: string,
): Promise<SpellingWord[]> {
  await deps.db
    .delete(userWords)
    .where(and(eq(userWords.userId, userId), eq(userWords.word, word)));
  return listUserWords(deps, userId);
}

/** The workspace's words, A–Z, with who said each is right – everyone in it sees them. */
export async function listWorkspaceWords(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<SpellingWord[]> {
  await requireRole(deps.db, workspaceId, userId);
  return workspaceWordRows(deps, workspaceId);
}

async function workspaceWordRows(deps: AppDeps, workspaceId: string): Promise<SpellingWord[]> {
  const rows = await deps.db
    .select({ word: workspaceWords.word, createdAt: workspaceWords.createdAt, name: users.name })
    .from(workspaceWords)
    .leftJoin(users, eq(users.id, workspaceWords.addedById))
    .where(eq(workspaceWords.workspaceId, workspaceId))
    .orderBy(asc(workspaceWords.word));
  return rows.map((row) => ({
    word: row.word,
    createdAt: row.createdAt.toISOString(),
    addedBy: row.name,
  }));
}

/** Whoever may comment on its decks (reviewers up): „Passt so“ is part of reviewing. */
export async function addWorkspaceWord(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  word: string,
): Promise<SpellingWord[]> {
  await requireRole(
    deps.db,
    workspaceId,
    userId,
    'reviewer',
    'Wörter aufnehmen kann, wer in diesem Workspace kommentieren darf.',
  );
  const [{ n } = { n: 0 }] = await deps.db
    .select({ n: count() })
    .from(workspaceWords)
    .where(eq(workspaceWords.workspaceId, workspaceId));
  if (n >= SPELLING_WORDS_MAX) throw tooMany();
  await deps.db
    .insert(workspaceWords)
    .values({ workspaceId, word, addedById: userId })
    .onConflictDoNothing();
  return workspaceWordRows(deps, workspaceId);
}

/** Members and admins: a word taken out is marked again for everyone in the workspace. */
export async function removeWorkspaceWord(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  word: string,
): Promise<SpellingWord[]> {
  await requireRole(
    deps.db,
    workspaceId,
    userId,
    'member',
    'Wörter löschen können Mitglieder und Admins.',
  );
  await deps.db
    .delete(workspaceWords)
    .where(and(eq(workspaceWords.workspaceId, workspaceId), eq(workspaceWords.word, word)));
  return workspaceWordRows(deps, workspaceId);
}
