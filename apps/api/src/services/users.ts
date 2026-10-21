import { eq, sql } from 'drizzle-orm';
import type { AccentColor, Viewer } from '@slider/shared';
import type { Database, Executor } from '../db/client';
import { comments, users, type UserRow } from '../db/schema';

export interface PersonInput {
  name: string;
  email: string;
  color?: AccentColor;
}

/** Finds a user by e-mail or creates them. Existing rows are updated with any given fields. */
export async function upsertUser(db: Executor, person: PersonInput): Promise<UserRow> {
  const [row] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      name: person.name,
      email: person.email,
      color: person.color ?? 'red',
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        name: person.name,
        ...(person.color ? { color: person.color } : {}),
      },
    })
    .returning();
  if (!row) throw new Error(`Could not upsert user ${person.email}`);
  return row;
}

/**
 * Someone used Slider: the clock for unused accounts starts over and reminders already sent no
 * longer count (BER-147). Called on login and on the (daily) session renewal.
 */
export async function markActive(db: Executor, userId: string, now: Date): Promise<void> {
  await db
    .update(users)
    .set({ lastActiveAt: now, inactivityNotices: 0, inactivityNoticeAt: null })
    .where(eq(users.id, userId));
}

/**
 * Renames the viewer. Comments keep a snapshot of their author, so their existing comments show
 * the new name too (BER-145: correcting one's own data, DSGVO Art. 16). Returns the decks whose
 * comments changed, for open viewers to reload.
 */
export async function updateViewerName(
  db: Database,
  viewer: Viewer,
  name: string,
): Promise<{ viewer: Viewer; deckIds: string[] }> {
  const { id } = viewer.author;
  const rows = await db.transaction(async (tx) => {
    await tx.update(users).set({ name }).where(eq(users.id, id));
    return tx
      .update(comments)
      .set({ author: sql`jsonb_set(${comments.author}, '{name}', to_jsonb(${name}::text))` })
      .where(sql`${comments.author}->>'id' = ${id}`)
      .returning({ deckId: comments.deckId });
  });
  return {
    viewer: { ...viewer, author: { ...viewer.author, name } },
    deckIds: [...new Set(rows.map((row) => row.deckId))],
  };
}

/**
 * Sets the viewer's accent colour. Comments keep a snapshot of their author, so the viewer's
 * existing comments are recoloured too – pins, lines and drawings always show the author's colour.
 */
export async function updateViewerColor(
  db: Database,
  viewer: Viewer,
  color: AccentColor,
): Promise<Viewer> {
  const { id } = viewer.author;
  await db.transaction(async (tx) => {
    await tx.update(users).set({ color }).where(eq(users.id, id));
    await tx
      .update(comments)
      .set({ author: sql`jsonb_set(${comments.author}, '{color}', to_jsonb(${color}::text))` })
      .where(sql`${comments.author}->>'id' = ${id}`);
  });
  return { ...viewer, author: { ...viewer.author, color } };
}

/** The account's address, e.g. to name who asks in Nextcloud's grant page. */
export async function userEmail(db: Executor, userId: string): Promise<string | null> {
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  return row?.email ?? null;
}
