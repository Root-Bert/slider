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
