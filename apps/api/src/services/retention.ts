import { and, lt, notExists, or, eq } from 'drizzle-orm';
import {
  authChallenges,
  sessions,
  workspaceInvites,
  workspaceMembers,
  workspaces,
} from '../db/schema';
import { SESSION_MAX_AGE_MS } from '../auth/session';
import type { AppDeps } from '../deps';
import { retryBlobDeletions } from './blob-deletions';
import { sweepDowngrades } from './downgrade';
import { DAY_MS, INVITE_KEEP_DAYS } from './retention-rules';
import { sweepUnusedAccounts } from './unused-accounts';
import { sweepUnusedDecks } from './unused-decks';
import { purgeIfEmpty } from './workspaces/workspaces';

/**
 * Deletion deadlines (BER-143, see `docs/self-hosting.md` → Datenschutz), enforced by one
 * hourly job: unused accounts (`unused-accounts`) and decks (`unused-decks`) after reminders,
 * old invitations and expired sessions without.
 */

/** Rows nobody needs any more: old invitations, expired sessions and passkey challenges. */
export async function purgeStaleRows(deps: AppDeps): Promise<void> {
  const now = deps.clock.now();
  const inviteCutoff = new Date(now.getTime() - INVITE_KEEP_DAYS * DAY_MS);
  await deps.db
    .delete(workspaceInvites)
    .where(
      or(
        lt(workspaceInvites.expiresAt, inviteCutoff),
        lt(workspaceInvites.acceptedAt, inviteCutoff),
        lt(workspaceInvites.revokedAt, inviteCutoff),
      ),
    );
  await deps.db
    .delete(sessions)
    .where(
      or(
        lt(sessions.expiresAt, now),
        lt(sessions.createdAt, new Date(now.getTime() - SESSION_MAX_AGE_MS)),
      ),
    );
  await deps.db.delete(authChallenges).where(lt(authChallenges.expiresAt, now));
}

/**
 * Organisations without members: their last one deleted the account, and purging them right
 * after failed. Older than a day, so none is caught between being created and its first member.
 */
export async function purgeEmptyWorkspaces(deps: AppDeps): Promise<void> {
  const createdBefore = new Date(deps.clock.now().getTime() - DAY_MS);
  const empty = await deps.db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(
        lt(workspaces.createdAt, createdBefore),
        notExists(
          deps.db
            .select({ id: workspaceMembers.userId })
            .from(workspaceMembers)
            .where(eq(workspaceMembers.workspaceId, workspaces.id)),
        ),
      ),
    );
  for (const { id } of empty) {
    try {
      await purgeIfEmpty(deps, id);
    } catch (error) {
      deps.log.error(`Could not purge empty organisation ${id}`, error);
    }
  }
}

/** Everything above, once; one step failing doesn't hold up the others. */
export async function enforceRetention(deps: AppDeps): Promise<void> {
  const steps = [
    purgeStaleRows,
    purgeEmptyWorkspaces,
    sweepUnusedDecks,
    sweepUnusedAccounts,
    retryBlobDeletions,
    // Not a deletion deadline, but the same hourly rhythm: paid organisations without payment.
    sweepDowngrades,
  ] as const;
  for (const step of steps) {
    try {
      await step(deps);
    } catch (error) {
      deps.log.error(`Enforcing deletion deadlines failed (${step.name})`, error);
    }
  }
}

/** Runs {@link enforceRetention} every hour; overlapping runs are skipped. */
export class RetentionSweeper {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly deps: AppDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 60 * 60 * 1000);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await enforceRetention(this.deps);
    } catch (error) {
      this.deps.log.error('Enforcing deletion deadlines failed', error);
    } finally {
      this.running = false;
    }
  }
}
