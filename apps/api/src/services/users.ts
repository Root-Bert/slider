import type { AccentColor } from '@slider/shared';
import type { Executor } from '../db/client';
import { users, type UserRow } from '../db/schema';

export interface PersonInput {
  name: string;
  email: string;
  color?: AccentColor;
  avatarKey?: string | null;
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
      avatarKey: person.avatarKey ?? null,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        name: person.name,
        ...(person.color ? { color: person.color } : {}),
        ...(person.avatarKey !== undefined ? { avatarKey: person.avatarKey } : {}),
      },
    })
    .returning();
  if (!row) throw new Error(`Could not upsert user ${person.email}`);
  return row;
}
