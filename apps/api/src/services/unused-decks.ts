import { and, eq, sql } from 'drizzle-orm';
import { decks, users, workspaceMembers, workspaces, type DeckRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { inviteMail } from '../mail/mailer';
import { sendMail } from './data-requests';
import { justAfter } from './account-deletion';
import { deleteDeck } from './decks';
import { addMonths, formatDate, retentionStep, type Reminder } from './retention-rules';
import { unusedDeletionSince } from './unused-deletion';

/**
 * Unused decks are deleted (BER-143): a deck nobody opened or changed for 18 months goes with its
 * files and comments. Use is the latest of creating, changing (a comment, a new version) and
 * opening it (`decks.last_viewed_at`, by anyone). The owner gets a mail a month, a week and a day
 * before; opening it once keeps it. Same rules as for accounts (`retentionStep`): only with
 * `DELETE_UNUSED`, counted from switching it on at the earliest (`unused-deletion`), deleted on
 * time whatever the mails did, missed reminders not made up.
 */

export const UNUSED_DECK_MONTHS = 18;

export const DECK_REMINDERS: readonly Reminder[] = [
  { months: 1, when: 'in einem Monat' },
  { days: 7, when: 'in einer Woche' },
  { days: 1, when: 'morgen' },
];

/**
 * Who hears about a deck about to go: its owner while still in the workspace, else (they were
 * removed, the uploaded deck stayed) its admins – an outsider learns nothing about it.
 */
async function reminderRecipients(deps: AppDeps, deck: DeckRow, ownerEmail: string) {
  const [owner] = await deps.db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, deck.workspaceId),
        eq(workspaceMembers.userId, deck.ownerId),
      ),
    );
  if (owner) return [ownerEmail];
  const admins = await deps.db
    .select({ email: users.email })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(eq(workspaceMembers.workspaceId, deck.workspaceId), eq(workspaceMembers.role, 'admin')),
    );
  return admins.map((admin) => admin.email);
}

/** Last use of a deck, as SQL – but not before `DELETE_UNUSED` was switched on (`since`). */
const lastUseSince = (since: Date) =>
  sql<Date>`greatest(${decks.createdAt}, ${decks.updatedAt}, coalesce(${decks.lastViewedAt}, ${decks.createdAt}), ${since.toISOString()}::timestamptz)`;

export async function sweepUnusedDecks(
  deps: AppDeps,
): Promise<{ reminded: string[]; deleted: string[] }> {
  const reminded: string[] = [];
  const deleted: string[] = [];
  const since = await unusedDeletionSince(deps);
  if (!since) return { reminded, deleted };
  const lastUse = lastUseSince(since);
  const now = deps.clock.now();
  const unusedSince = addMonths(now, -(UNUSED_DECK_MONTHS - 1));
  const candidates = await deps.db
    .select({
      deck: decks,
      lastUse: lastUse.mapWith((value: string | Date) => new Date(value)),
      ownerEmail: users.email,
      workspace: workspaces.name,
    })
    .from(decks)
    .innerJoin(users, eq(users.id, decks.ownerId))
    .innerJoin(workspaces, eq(workspaces.id, decks.workspaceId))
    // As ISO text: postgres-js can't send a `Date` in a raw `sql` template.
    .where(sql`${lastUse} <= ${unusedSince.toISOString()}::timestamptz`);

  for (const { deck, lastUse: usedAt, ownerEmail, workspace } of candidates) {
    // Reminders from before the deck was used again don't count.
    const fresh = deck.deletionNoticeAt !== null && deck.deletionNoticeAt >= usedAt;
    const sent = fresh ? deck.deletionNotices : 0;
    const step = retentionStep(DECK_REMINDERS, addMonths(usedAt, UNUSED_DECK_MONTHS), now, sent);
    if (step?.action === 'delete') {
      try {
        // Opened or changed since it was read above: it stays.
        const stillUnused = sql`${lastUse} < ${justAfter(usedAt).toISOString()}::timestamptz`;
        if (!(await deleteDeck(deps, deck.id, stillUnused))) continue;
        deleted.push(deck.id);
        deps.log.info(`Deleted deck ${deck.id}, unused since ${usedAt.toISOString()}`);
      } catch (error) {
        deps.log.error(`Could not delete unused deck ${deck.id}`, error);
      }
    } else if (step?.action === 'remind' && deps.mailer.configured) {
      const when = DECK_REMINDERS[step.stage]?.when ?? 'bald';
      let sentOk = false;
      for (const to of await reminderRecipients(deps, deck, ownerEmail)) {
        const ok = await sendMail(
          deps,
          inviteMail({
            to,
            url: new URL(`/d/${deck.id}`, deps.config.webOrigin).toString(),
            subject: `„${deck.title}“ wird ${when} gelöscht`,
            heading: 'Präsentation behalten?',
            intro: `„${deck.title}“ in „${workspace}“ hat seit langem niemand geöffnet. Ungenutzte Präsentationen werden nach 18 Monaten gelöscht, diese am ${formatDate(step.deletesAt)}, mit allen Kommentaren.`,
            button: 'Präsentation öffnen',
            outro: 'Einmal öffnen genügt, dann bleibt sie.',
          }),
        );
        sentOk ||= ok;
      }
      if (sentOk) {
        await deps.db
          .update(decks)
          .set({ deletionNotices: step.stage + 1, deletionNoticeAt: now })
          .where(eq(decks.id, deck.id));
        reminded.push(deck.id);
      }
    }
  }
  return { reminded, deleted };
}
