import { and, count, eq, lte, sql } from 'drizzle-orm';
import {
  MAX_DRAFTS,
  senderDraftKeySchema,
  type SenderDraft,
  type SenderDraftTarget,
} from '@slider/shared';
import { senderDrafts, type SenderDraftRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest } from '../http/errors';
import { requireRole } from './workspaces/roles';

/**
 * Drafts (`sender_drafts`): what a person wrote and did not send, kept for their account so it
 * waits on every device. Only they read and write their own – a member's are never another's,
 * not even an admin's. The newer one wins: a write older than what is kept (an offline device
 * catching up) changes nothing; a time from the server's future counts as now.
 */

const dto = (row: SenderDraftRow): SenderDraft => ({
  key: row.key,
  text: row.text,
  target: row.target,
  at: row.updatedAt.toISOString(),
});

function keyOf(key: string): string {
  if (!senderDraftKeySchema.safeParse(key).success)
    throw badRequest('Diesen Entwurf gibt es nicht.');
  return key;
}

/** When it was written, never later than now. */
const writtenAt = (deps: AppDeps, at: string) => {
  const now = deps.clock.now();
  const asked = new Date(at);
  return asked.getTime() > now.getTime() ? now : asked;
};

/** One's drafts in a workspace, the newest first. */
export async function listDrafts(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<SenderDraft[]> {
  await requireRole(deps.db, workspaceId, userId);
  const rows = await deps.db
    .select()
    .from(senderDrafts)
    .where(and(eq(senderDrafts.userId, userId), eq(senderDrafts.workspaceId, workspaceId)));
  return rows.map(dto).sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Keeps a draft – unless a newer one is kept already (then that one is answered). Empty words
 * keep a new mail's other fields (to whom, its subject) and a mail's files; elsewhere they are no
 * draft – deleted.
 */
export async function putDraft(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  rawKey: string,
  input: { text: string; target: SenderDraftTarget; at: string },
): Promise<SenderDraft | null> {
  const key = keyOf(rawKey);
  await requireRole(deps.db, workspaceId, userId);
  const empty =
    !input.text.trim() &&
    !(
      input.target.kind === 'mail-new' &&
      (input.target.to.trim() || input.target.subject.trim())
    ) &&
    !(
      (input.target.kind === 'mail' || input.target.kind === 'mail-new') &&
      (input.target.uploads?.length ?? 0) > 0
    );
  if (empty) {
    await deleteDraft(deps, userId, workspaceId, key, input.at);
    return null;
  }
  const at = writtenAt(deps, input.at);
  const mine = and(eq(senderDrafts.userId, userId), eq(senderDrafts.workspaceId, workspaceId));
  const [counted] = await deps.db.select({ kept: count() }).from(senderDrafts).where(mine);
  const known = await deps.db
    .select({ id: senderDrafts.id })
    .from(senderDrafts)
    .where(and(mine, eq(senderDrafts.key, key)));
  if (known.length === 0 && (counted?.kept ?? 0) >= MAX_DRAFTS)
    throw badRequest(
      `Mehr als ${MAX_DRAFTS} Entwürfe gehen nicht – schick oder lösch erst welche.`,
    );
  const [row] = await deps.db
    .insert(senderDrafts)
    .values({
      id: crypto.randomUUID(),
      userId,
      workspaceId,
      key,
      kind: input.target.kind,
      target: input.target,
      text: input.text,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: [senderDrafts.userId, senderDrafts.workspaceId, senderDrafts.key],
      set: {
        kind: sql`excluded.kind`,
        target: sql`excluded.target`,
        text: sql`excluded.text`,
        updatedAt: sql`excluded.updated_at`,
      },
      // The newer wins: an older write (a device catching up) leaves the kept one.
      setWhere: lte(senderDrafts.updatedAt, sql`excluded.updated_at`),
    })
    .returning();
  if (row) return dto(row);
  const [newer] = await deps.db
    .select()
    .from(senderDrafts)
    .where(and(mine, eq(senderDrafts.key, key)));
  return newer ? dto(newer) : null;
}

/** Deletes a draft (sent, thrown away) – not one written after `at` (on another device). */
export async function deleteDraft(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  rawKey: string,
  at?: string,
): Promise<void> {
  const key = keyOf(rawKey);
  await requireRole(deps.db, workspaceId, userId);
  await deps.db
    .delete(senderDrafts)
    .where(
      and(
        eq(senderDrafts.userId, userId),
        eq(senderDrafts.workspaceId, workspaceId),
        eq(senderDrafts.key, key),
        ...(at && !Number.isNaN(new Date(at).getTime())
          ? [lte(senderDrafts.updatedAt, writtenAt(deps, at))]
          : []),
      ),
    );
}
