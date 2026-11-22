import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import {
  MAX_EVENT_LOCATION,
  MAX_EVENT_NOTES,
  MAX_EVENT_TITLE,
  type CalendarEvent,
} from '@slider/shared';
import { calendars, mailAccounts, type CalendarRow, type MailAccountRow } from '../../db/schema';
import type { AppDeps } from '../../deps';
import { calendarAccessToken } from '../../mail/oauth';
import { senderLive } from '../sender';
import {
  caldavSource,
  googleSource,
  microsoftSource,
  type CalendarSource,
  type RemoteEvent,
} from './remote';

/*
 * A person's mail accounts' calendars beside Slider's own (`services/calendars.ts`). Their list is
 * kept as calendars of kind `mail` (name and address sealed), compared with the provider's now and
 * then; their events are never stored – asked for when a range is looked at and held here in
 * memory a few minutes. Read only.
 */

/** How often an account's calendars are compared with the provider's. */
const SYNC_EVERY_MS = 15 * 60_000;
/** After a refusal (no CalDAV server, no consent to calendars): tried again much later. */
const REFUSED_FOR_MS = 12 * 3_600_000;
/** After an error that may pass (the server did not answer). */
const FAILED_FOR_MS = 30 * 60_000;
/** How long a calendar's events for one range are held. */
const EVENTS_FOR_MS = 5 * 60_000;
const MAX_HELD = 500;
/** A calendar's events for one range at most (as many as a busy year), and all held at most. */
const MAX_RANGE_EVENTS = 3_000;
const MAX_HELD_EVENTS = 100_000;
/** The first look waits this long for an account's calendars; later ones come live. */
const FIRST_WAIT_MS = 5_000;

/**
 * When an account is compared next, and with which sign-in: a new one (signed in anew, another
 * password) is tried at once. `consent`: its provider did not let Slider read its calendars.
 */
const nextSync = new Map<string, { at: number; stamp: string; consent: boolean }>();
const syncing = new Map<string, Promise<void>>();
const held = new Map<string, { until: number; events: RemoteEvent[] }>();
let heldEvents = 0;
/** Holds a range's events, the oldest let go first while there are too many. */
function hold(key: string, until: number, events: RemoteEvent[]) {
  const before = held.get(key);
  if (before) {
    heldEvents -= before.events.length;
    held.delete(key);
  }
  while (held.size > 0 && (held.size >= MAX_HELD || heldEvents + events.length > MAX_HELD_EVENTS)) {
    const [oldest, gone] = held.entries().next().value!;
    heldEvents -= gone.events.length;
    held.delete(oldest);
  }
  held.set(key, { until, events });
  heldEvents += events.length;
}

/** How an account's calendars are read: tests hand in their own (`deps.mailCalendars`). */
async function sourceFor(deps: AppDeps, account: MailAccountRow): Promise<CalendarSource | null> {
  if (deps.mailCalendars) return deps.mailCalendars(account);
  if (account.auth === 'password') {
    if (!account.password) return null;
    return caldavSource({
      address: account.address,
      username: account.username,
      password: account.password,
    });
  }
  const token = await calendarAccessToken(deps, account);
  return account.auth === 'google' ? googleSource(token) : microsoftSource(token);
}

/** The sign-in an account has now, as a hash: what a refusal was for. */
const stampOf = (account: MailAccountRow) =>
  createHash('sha256')
    .update(`${account.auth}\0${account.refreshToken ?? ''}\0${account.password}`)
    .digest('base64url');

/** A refusal that will not pass by itself: no server found, no consent, the sign-in refused. */
const isRefusal = (error: unknown) =>
  error instanceof Error &&
  (/kein Kalender-Server|abgelehnt|consent|scope|insufficient|forbidden|Anmeldung/i.test(
    error.message,
  ) ||
    error.name === 'MailSignInNeeded' ||
    error.name === 'MailOAuthError');

async function syncAccount(deps: AppDeps, account: MailAccountRow) {
  const now = deps.clock.now().getTime();
  try {
    const source = await sourceFor(deps, account);
    if (!source) {
      nextSync.set(account.id, {
        at: now + REFUSED_FOR_MS,
        stamp: stampOf(account),
        consent: false,
      });
      return;
    }
    const remote = await source.list();
    const kept = await deps.db
      .select()
      .from(calendars)
      .where(eq(calendars.mailAccountId, account.id));
    const byRemote = new Map(kept.map((row) => [row.remoteId, row]));
    let changed = false;
    for (const one of remote) {
      const color = one.color?.toLowerCase() ?? null;
      const row = byRemote.get(one.remoteId);
      byRemote.delete(one.remoteId);
      if (!row) {
        await deps.db.insert(calendars).values({
          id: crypto.randomUUID(),
          workspaceId: account.workspaceId,
          ownerId: account.userId,
          mailAccountId: account.id,
          remoteId: one.remoteId,
          name: one.name.slice(0, 200),
          color,
        });
        changed = true;
      } else if (row.name !== one.name || row.color !== color) {
        await deps.db
          .update(calendars)
          .set({ name: one.name.slice(0, 200), color, updatedAt: new Date() })
          .where(eq(calendars.id, row.id));
        changed = true;
      }
    }
    for (const gone of byRemote.values()) {
      await deps.db.delete(calendars).where(eq(calendars.id, gone.id));
      changed = true;
    }
    nextSync.set(account.id, { at: now + SYNC_EVERY_MS, stamp: stampOf(account), consent: false });
    if (changed && senderLive.open(account.workspaceId)) {
      senderLive.publish(account.workspaceId, new Set([account.userId]), { type: 'calendar' });
    }
  } catch (error) {
    const refused = isRefusal(error);
    nextSync.set(account.id, {
      at: now + (refused ? REFUSED_FOR_MS : FAILED_FOR_MS),
      stamp: stampOf(account),
      // Signed in through the provider but without calendars: asked once more at sign-in.
      consent: refused && account.auth !== 'password',
    });
    deps.log.warn('Calendar: a mail account’s calendars could not be read', {
      accountId: account.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Compares the caller's mail accounts' calendars in this workspace with their providers' where it
 * is time; resolves once that is done (the caller need not wait – a change comes live).
 */
export async function syncMailCalendars(deps: AppDeps, workspaceId: string, userId: string) {
  const accounts = await deps.db
    .select()
    .from(mailAccounts)
    .where(and(eq(mailAccounts.workspaceId, workspaceId), eq(mailAccounts.userId, userId)));
  const now = deps.clock.now().getTime();
  await Promise.all(
    accounts.map((account) => {
      const running = syncing.get(account.id);
      if (running) return running;
      const next = nextSync.get(account.id);
      if (next && next.at > now && next.stamp === stampOf(account)) return undefined;
      const run = syncAccount(deps, account).finally(() => syncing.delete(account.id));
      syncing.set(account.id, run);
      return run;
    }),
  );
}

/** The sync, waited for a moment on a first look so the calendars are there; else in the back. */
export async function syncMailCalendarsBriefly(deps: AppDeps, workspaceId: string, userId: string) {
  const sync = syncMailCalendars(deps, workspaceId, userId).catch((error: unknown) =>
    deps.log.warn('Calendar: mail calendars were not compared', { error }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    sync,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, FIRST_WAIT_MS);
      timer.unref?.();
    }),
  ]);
  clearTimeout(timer);
}

/**
 * The caller's mailboxes signed in through Google or Microsoft whose calendars the provider did
 * not let Slider read – signed in before calendars were asked for: signing in anew lets it.
 */
export async function mailCalendarsRefused(deps: AppDeps, workspaceId: string, userId: string) {
  const accounts = await deps.db
    .select()
    .from(mailAccounts)
    .where(and(eq(mailAccounts.workspaceId, workspaceId), eq(mailAccounts.userId, userId)));
  return accounts
    .filter((account) => {
      const next = nextSync.get(account.id);
      return next?.consent && next.stamp === stampOf(account);
    })
    .map((account) => ({ accountId: account.id, signIn: account.auth as 'google' | 'microsoft' }));
}

/** The events of these mail calendars (the caller's own) overlapping [from, to). */
export async function mailEvents(
  deps: AppDeps,
  rows: CalendarRow[],
  from: Date,
  to: Date,
): Promise<CalendarEvent[]> {
  const accountIds = [...new Set(rows.map((row) => row.mailAccountId!))];
  if (!accountIds.length) return [];
  const accounts = await deps.db
    .select()
    .from(mailAccounts)
    .where(inArray(mailAccounts.id, accountIds));
  const now = deps.clock.now().getTime();
  const lists = await Promise.all(
    accountIds.map(async (accountId) => {
      const account = accounts.find((each) => each.id === accountId);
      if (!account) return [];
      let source: CalendarSource | null = null;
      const mine = rows.filter((row) => row.mailAccountId === accountId);
      return Promise.all(
        mine.map(async (row) => {
          const key = `${row.id}|${from.toISOString()}|${to.toISOString()}`;
          const kept = held.get(key);
          let events = kept && kept.until > now ? kept.events : undefined;
          if (!events) {
            try {
              source ??= await sourceFor(deps, account);
              if (!source) return [];
              events = (await source.events(row.remoteId!, from, to)).slice(0, MAX_RANGE_EVENTS);
            } catch (error) {
              deps.log.warn('Calendar: a mail calendar’s events could not be read', {
                calendarId: row.id,
                error: error instanceof Error ? error.message : String(error),
              });
              return [];
            }
            hold(key, now + EVENTS_FOR_MS, events);
          }
          return events.map((event): CalendarEvent => ({
            id: `mail:${row.id}:${event.id}`,
            calendarId: row.id,
            // As long as one's own may be: a server's are its own.
            title: event.title.slice(0, MAX_EVENT_TITLE),
            location: event.location.slice(0, MAX_EVENT_LOCATION),
            notes: event.notes.slice(0, MAX_EVENT_NOTES),
            allDay: event.allDay,
            start: event.start,
            end: event.end,
            canEdit: false,
            createdBy: null,
          }));
        }),
      );
    }),
  );
  return lists.flat(2);
}
