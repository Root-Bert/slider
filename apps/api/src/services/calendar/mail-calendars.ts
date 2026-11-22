import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import {
  MAX_EVENT_LOCATION,
  MAX_EVENT_NOTES,
  MAX_EVENT_TITLE,
  type CalendarConnection,
  type CalendarEvent,
} from '@slider/shared';
import {
  calendars,
  mailAccounts,
  type CalendarRow,
  type MailAccountRow,
  type MailCalendarRights,
} from '../../db/schema';
import type { AppDeps } from '../../deps';
import { ApiError, forbidden, notFound } from '../../http/errors';
import { calendarAccessToken, calendarGrant } from '../../mail/oauth';
import { senderLive } from '../sender';
import {
  caldavSource,
  CONFLICT,
  googleSource,
  microsoftSource,
  type CalendarSource,
  type CalendarWriter,
  type RemoteCalendar,
  type RemoteEvent,
  type RemoteEventChange,
  type RemoteEventFields,
  type RemoteRights,
} from './remote';

/*
 * A person's mail accounts' calendars beside Slider's own (`services/calendars.ts`) – and those of
 * an account connected for its calendars alone (`mail_accounts.calendar_only`); an account whose
 * calendars were removed (`with_calendars` off) is never read. Their list is
 * kept as calendars of kind `mail` (name and address sealed), compared with the provider's now and
 * then; their events are never stored – asked for when a range is looked at and held here in
 * memory a few minutes. Events and calendars are written back only when their person makes,
 * changes or deletes one in Slider (`services/calendars.ts` checks it is theirs); a write lets go
 * of what was held for that calendar, so the next look reads it anew.
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

/** Lets go of a calendar's held events: written to, it is read anew. */
function forgetHeld(calendarId: string) {
  for (const [key, kept] of held) {
    if (!key.startsWith(`${calendarId}|`)) continue;
    heldEvents -= kept.events.length;
    held.delete(key);
  }
}

/** An event as held for a range of that calendar (what its person saw), if still held. */
function heldEvent(deps: AppDeps, calendarId: string, eventId: string) {
  const now = deps.clock.now().getTime();
  for (const [key, kept] of held) {
    if (!key.startsWith(`${calendarId}|`) || kept.until <= now) continue;
    const found = kept.events.find((event) => event.id === eventId);
    if (found) return found;
  }
  return undefined;
}

/** How an account's calendars are read: tests hand in their own (`deps.mailCalendars`). */
async function sourceFor(
  deps: AppDeps,
  account: MailAccountRow,
): Promise<(CalendarSource & Partial<CalendarWriter>) | null> {
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

/**
 * What a calendar lets in Slider: its provider's word (none: everything may be tried), less what
 * the account's sign-in keeps back – Google renames and deletes with its calendars' scope, takes a
 * subscribed one off the list with its list's; Microsoft writes with `Calendars.ReadWrite`.
 */
function rightsOf(account: MailAccountRow, provider: RemoteRights | undefined): MailCalendarRights {
  const told = provider ?? { events: true, rename: true, drop: 'delete' };
  const grant = (account.auth !== 'password' && calendarGrant(account)) || {
    events: true,
    calendars: true,
    list: true,
  };
  const drop =
    told.drop === 'delete' && grant.calendars
      ? 'delete'
      : told.drop === 'remove' && grant.list
        ? 'remove'
        : null;
  return {
    events: told.events && grant.events,
    rename: told.rename && grant.calendars,
    drop,
    create: grant.calendars,
    regrant: !grant.events || !grant.calendars || (told.drop !== null && drop === null),
  };
}

const sameRights = (a: MailCalendarRights | null, b: MailCalendarRights) =>
  JSON.stringify(a) === JSON.stringify(b);

/** A refusal that will not pass by itself: no server found, no consent, the sign-in refused. */
const isRefusal = (error: unknown) =>
  error instanceof Error &&
  (/kein Kalender-Server|abgelehnt|consent|scope|insufficient|forbidden|Anmeldung/i.test(
    error.message,
  ) ||
    error.name === 'MailSignInNeeded' ||
    error.name === 'MailOAuthError');

function keepCalendar(
  deps: AppDeps,
  account: MailAccountRow,
  one: RemoteCalendar,
  rights: MailCalendarRights,
) {
  return deps.db
    .insert(calendars)
    .values({
      id: crypto.randomUUID(),
      workspaceId: account.workspaceId,
      ownerId: account.userId,
      mailAccountId: account.id,
      remoteId: one.remoteId,
      name: one.name.slice(0, 200),
      color: one.color?.toLowerCase() ?? null,
      remoteRights: rights,
    })
    .returning();
}

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
      const rights = rightsOf(account, one.rights);
      const row = byRemote.get(one.remoteId);
      byRemote.delete(one.remoteId);
      if (!row) {
        await keepCalendar(deps, account, one, rights);
        changed = true;
      } else if (
        row.name !== one.name.slice(0, 200) ||
        row.color !== color ||
        !sameRights(row.remoteRights, rights)
      ) {
        await deps.db
          .update(calendars)
          .set({ name: one.name.slice(0, 200), color, remoteRights: rights, updatedAt: new Date() })
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

/** An account's calendars removed (or the account): compared afresh once they come back. */
export function dropAccountCalendars(accountId: string) {
  nextSync.delete(accountId);
}

/** The caller's accounts in this workspace whose calendars are on. */
const withCalendars = (deps: AppDeps, workspaceId: string, userId: string) =>
  deps.db
    .select()
    .from(mailAccounts)
    .where(
      and(
        eq(mailAccounts.workspaceId, workspaceId),
        eq(mailAccounts.userId, userId),
        eq(mailAccounts.withCalendars, true),
      ),
    );

/**
 * Compares the caller's mail accounts' calendars in this workspace with their providers' where it
 * is time; resolves once that is done (the caller need not wait – a change comes live).
 */
export async function syncMailCalendars(deps: AppDeps, workspaceId: string, userId: string) {
  const accounts = await withCalendars(deps, workspaceId, userId);
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
  const accounts = await withCalendars(deps, workspaceId, userId);
  return accounts
    .filter((account) => {
      const next = nextSync.get(account.id);
      return next?.consent && next.stamp === stampOf(account);
    })
    .map((account) => ({ accountId: account.id, signIn: account.auth as 'google' | 'microsoft' }));
}

/**
 * The caller's calendars without a mailbox („Google/Microsoft Kalender verbinden“, or a mailbox
 * removed while its calendars stayed).
 */
export async function calendarConnections(
  deps: AppDeps,
  workspaceId: string,
  userId: string,
): Promise<CalendarConnection[]> {
  const rows = await deps.db
    .select()
    .from(mailAccounts)
    .where(
      and(
        eq(mailAccounts.workspaceId, workspaceId),
        eq(mailAccounts.userId, userId),
        eq(mailAccounts.calendarOnly, true),
      ),
    )
    .orderBy(mailAccounts.createdAt);
  return rows.map((row) => ({
    accountId: row.id,
    address: row.address,
    label: row.label || null,
    signIn: row.auth,
    signedOut: row.state === 'signin',
  }));
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
      if (!account?.withCalendars) return [];
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
          return events.map((event) => fromRemote(row, event));
        }),
      );
    }),
  );
  return lists.flat(2);
}

/** A mail calendar's event as the page shows it; its id names the calendar and the provider's. */
function fromRemote(row: CalendarRow, event: RemoteEvent): CalendarEvent {
  return {
    id: `mail:${row.id}:${event.id}`,
    calendarId: row.id,
    // As long as one's own may be: a server's are its own.
    title: event.title.slice(0, MAX_EVENT_TITLE),
    location: event.location.slice(0, MAX_EVENT_LOCATION),
    notes: event.notes.slice(0, MAX_EVENT_NOTES),
    allDay: event.allDay,
    start: event.start,
    end: event.end,
    canEdit: row.remoteRights?.events ?? true,
    createdBy: null,
  };
}

/** `mail:<calendar>:<provider's id>` – what `fromRemote` made; `null` for one's own events. */
export function mailEventId(id: string): { calendarId: string; remoteId: string } | null {
  if (!id.startsWith('mail:')) return null;
  const rest = id.slice(5);
  const colon = rest.indexOf(':');
  if (colon <= 0 || colon === rest.length - 1) return null;
  return { calendarId: rest.slice(0, colon), remoteId: rest.slice(colon + 1) };
}

const READ_ONLY = 'In diesem Kalender darfst du nur ansehen, nichts ändern.';

/** What a provider's refusal tells the person (its words are German already). */
function refusal(error: unknown): Error {
  if (error instanceof ApiError || !(error instanceof Error)) return error as Error;
  if (error.message === CONFLICT) return new ApiError(409, 'edit_conflict', CONFLICT);
  return new ApiError(400, 'bad_request', error.message);
}

/**
 * The account behind a mail calendar (already the caller's: `services/calendars.ts` checked the
 * calendar is theirs) and how to write to it; tells its person's views once written.
 */
async function writing<T>(
  deps: AppDeps,
  accountId: string,
  ownerId: string,
  work: (source: CalendarSource & CalendarWriter, account: MailAccountRow) => Promise<T>,
  calendarId?: string,
): Promise<T> {
  const [account] = await deps.db
    .select()
    .from(mailAccounts)
    .where(and(eq(mailAccounts.id, accountId), eq(mailAccounts.userId, ownerId)));
  if (!account?.withCalendars) throw notFound('Diesen Kalender gibt es nicht (mehr).');
  try {
    const source = await sourceFor(deps, account);
    if (!source?.create) throw forbidden(READ_ONLY);
    return await work(source as CalendarSource & CalendarWriter, account);
  } catch (error) {
    // Refused as changed elsewhere: what was held is stale – the next look reads it anew.
    if (calendarId && error instanceof Error && error.message === CONFLICT) {
      forgetHeld(calendarId);
      tellOwner(account);
    }
    throw refusal(error);
  }
}

function tellOwner(account: Pick<MailAccountRow, 'workspaceId' | 'userId'>) {
  if (senderLive.open(account.workspaceId)) {
    senderLive.publish(account.workspaceId, new Set([account.userId]), { type: 'calendar' });
  }
}

/** One event of a mail calendar: as its person saw it (held), else asked of the provider. */
export async function mailEventOf(
  deps: AppDeps,
  row: CalendarRow,
  remoteId: string,
): Promise<CalendarEvent | null> {
  const kept = heldEvent(deps, row.id, remoteId);
  if (kept) return fromRemote(row, kept);
  const found = await writing(deps, row.mailAccountId!, row.ownerId!, (source) =>
    source.get(row.remoteId!, remoteId),
  );
  return found && fromRemote(row, found);
}

export async function createMailEvent(
  deps: AppDeps,
  row: CalendarRow,
  fields: RemoteEventFields,
): Promise<CalendarEvent> {
  const made = await writing(
    deps,
    row.mailAccountId!,
    row.ownerId!,
    (source) => source.create(row.remoteId!, fields),
    row.id,
  );
  forgetHeld(row.id);
  return fromRemote(row, made);
}

/** Changes it at the provider; `etag` sent is the version its person saw where that is held. */
export async function updateMailEvent(
  deps: AppDeps,
  row: CalendarRow,
  remoteId: string,
  change: RemoteEventChange,
): Promise<CalendarEvent> {
  const etag = heldEvent(deps, row.id, remoteId)?.etag;
  const changed = await writing(
    deps,
    row.mailAccountId!,
    row.ownerId!,
    (source) => source.update(row.remoteId!, remoteId, change, etag),
    row.id,
  );
  forgetHeld(row.id);
  return fromRemote(row, changed);
}

export async function deleteMailEvent(deps: AppDeps, row: CalendarRow, remoteId: string) {
  const etag = heldEvent(deps, row.id, remoteId)?.etag;
  await writing(
    deps,
    row.mailAccountId!,
    row.ownerId!,
    (source) => source.remove(row.remoteId!, remoteId, etag),
    row.id,
  );
  forgetHeld(row.id);
}

/** A new calendar in one's mail account: made at the provider, kept as the sync would. */
export async function createMailCalendar(
  deps: AppDeps,
  accountId: string,
  userId: string,
  input: { name: string; color: string | null },
): Promise<CalendarRow> {
  return writing(deps, accountId, userId, async (source, account) => {
    const made = await source.createCalendar(input.name, input.color);
    const [row] = await keepCalendar(deps, account, made, rightsOf(account, made.rights));
    return row!;
  });
}

/** Renames or colours it at the provider, then here. */
export async function updateMailCalendar(
  deps: AppDeps,
  row: CalendarRow,
  change: { name?: string; color?: string },
): Promise<CalendarRow> {
  await writing(deps, row.mailAccountId!, row.ownerId!, (source) =>
    source.updateCalendar(row.remoteId!, change),
  );
  const [after] = await deps.db
    .update(calendars)
    .set({
      ...(change.name !== undefined && { name: change.name.slice(0, 200) }),
      ...(change.color !== undefined && { color: change.color.toLowerCase() }),
      updatedAt: new Date(),
    })
    .where(eq(calendars.id, row.id))
    .returning();
  return after!;
}

/** Deletes it at the provider – or, someone else's, takes it off one's list there – then here. */
export async function dropMailCalendar(deps: AppDeps, row: CalendarRow) {
  const how = row.remoteRights?.drop ?? 'delete';
  await writing(deps, row.mailAccountId!, row.ownerId!, (source) =>
    source.deleteCalendar(row.remoteId!, how),
  );
  forgetHeld(row.id);
  await deps.db.delete(calendars).where(eq(calendars.id, row.id));
}
