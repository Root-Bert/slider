import { ApiError } from '../../http/errors';
import {
  dnsLookup,
  fetchHop,
  readBodyCapped,
  redirectTarget,
  type FetchLike,
  type LookupAll,
} from '../../sources/safe-fetch';
import {
  changedIcsEvent,
  icsEventsOf,
  icsSingleEvent,
  newIcsEvent,
  parseIcsEvents,
  type IcsFields,
} from './ical';

/*
 * The calendars of a person's mail account, beside Slider's own: CalDAV for accounts signed in
 * with a password, the providers' APIs for those signed in through Google or Microsoft. Read, and
 * written only when the person (or an agent asked by them) makes, changes or deletes an event or a
 * calendar in Slider. No DB, no routes: the caller keeps what it needs.
 */

/** What the person may do with a calendar at its provider (their role there, its kind). */
export interface RemoteRights {
  /** Events may be made, changed and deleted. */
  events: boolean;
  /** It may be renamed and coloured. */
  rename: boolean;
  /** `delete`: deleted at the provider; `remove`: only taken off one's list there (someone
   *  else's, subscribed); `null`: neither (the main calendar). */
  drop: 'delete' | 'remove' | null;
}

export interface RemoteCalendar {
  remoteId: string;
  name: string;
  color: string | null;
  /** Absent: not told – everything may be tried, the provider answers. */
  rights?: RemoteRights;
}

export interface RemoteEvent {
  /** Stable per occurrence: uid, plus the occurrence's start for recurring ones. */
  id: string;
  calendarRemoteId: string;
  title: string;
  location: string;
  notes: string;
  allDay: boolean;
  /** allDay: 'YYYY-MM-DD' (end exclusive, like iCal DTEND); else an ISO instant in UTC ('...Z'). */
  start: string;
  end: string;
  /** The version read: a write sent with it is refused once the event changed elsewhere. */
  etag?: string;
}

/** An event's fields as written; days `YYYY-MM-DD` (end exclusive), times ISO instants. */
export type RemoteEventFields = IcsFields;
/** A change: any field; timing (`allDay`, `start`, `end`) whole or not at all. */
export type RemoteEventChange = Partial<RemoteEventFields>;

export interface CalendarSource {
  list(): Promise<RemoteCalendar[]>;
  /** Occurrences overlapping [from, to), recurring ones expanded. */
  events(remoteId: string, from: Date, to: Date): Promise<RemoteEvent[]>;
}

/**
 * Writing: events by the ids `events` gave (an occurrence of a series alone, where the provider
 * lets it), calendars by their remote ids. `etag`: the version the person saw – changed since,
 * the write is refused ({@link CONFLICT}). Errors carry German words for the person.
 */
export interface CalendarWriter {
  get(remoteId: string, eventId: string): Promise<RemoteEvent | null>;
  create(remoteId: string, fields: RemoteEventFields): Promise<RemoteEvent>;
  update(
    remoteId: string,
    eventId: string,
    change: RemoteEventChange,
    etag?: string,
  ): Promise<RemoteEvent>;
  remove(remoteId: string, eventId: string, etag?: string): Promise<void>;
  createCalendar(name: string, color: string | null): Promise<RemoteCalendar>;
  updateCalendar(remoteId: string, change: { name?: string; color?: string }): Promise<void>;
  deleteCalendar(remoteId: string, how: 'delete' | 'remove'): Promise<void>;
}

const TIMEOUT_MS = 15_000;
/** A calendar's events for a few months stay far below; a server sending more is cut off. */
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 3;
/** Pages of an API's answer at most – thousands of events, a loop that never ends does. */
const MAX_PAGES = 20;

const REJECTED = 'Der Kalender-Server hat die Anmeldung abgelehnt.';
const UNREACHABLE = 'Der Kalender-Server antwortet nicht.';
const NOT_FOUND = 'Zu dieser Adresse wurde kein Kalender-Server gefunden.';
const FAILED = 'Der Kalender-Server hat einen Fehler gemeldet.';
const GONE = 'Diesen Kalender gibt es auf dem Server nicht mehr.';
export const CONFLICT = 'Der Termin wurde inzwischen woanders geändert.';
const EVENT_GONE = 'Diesen Termin gibt es nicht (mehr).';
const READ_ONLY = 'In diesem Kalender darfst du nur ansehen, nichts ändern.';
const SERIES = 'Termine einer Serie lassen sich in diesem Kalender nur beim Anbieter ändern.';
const WRITE_REFUSED = 'Der Kalender-Server hat die Änderung abgelehnt.';
/** Times Slider writes without a zone of their own (whole days at Microsoft). */
const ZONE = 'Europe/Berlin';

// ---------------------------------------------------------------------------------------------
// XML, without a library: CalDAV answers are small and their shape is fixed

const OPEN_TAG = /<(?:[\w.-]+:)?([\w-]+)(?![\w-])[^<>]*?(\/?)>/g;
const CLOSE_TAG = /<\/(?:[\w.-]+:)?([\w-]+)\s*>/g;

/**
 * The elements in `xml` (only those named `only`; any namespace prefix) with their content up to
 * the first closing tag of that name – in linear time, as the server is whoever the address
 * names (same reasoning as `sources/nextcloud.ts`).
 */
function elements(xml: string, only?: string): { name: string; body: string }[] {
  const closes = new Map<string, number[]>();
  for (const match of xml.matchAll(CLOSE_TAG)) {
    const list = closes.get(match[1] ?? '') ?? [];
    list.push(match.index);
    closes.set(match[1] ?? '', list);
  }
  const next = new Map<string, number>();
  const found: { name: string; body: string }[] = [];
  const open = new RegExp(OPEN_TAG.source, 'g');
  for (let match = open.exec(xml); match; match = open.exec(xml)) {
    const name = match[1] ?? '';
    if (only !== undefined && name !== only) continue;
    if (match[2] === '/') {
      found.push({ name, body: '' });
      continue;
    }
    const list = closes.get(name) ?? [];
    let index = next.get(name) ?? 0;
    while (index < list.length && list[index]! < open.lastIndex) index++;
    next.set(name, index);
    const close = list[index];
    if (close === undefined) continue;
    found.push({ name, body: xml.slice(open.lastIndex, close) });
    const end = xml.indexOf('>', close);
    open.lastIndex = end === -1 ? xml.length : end + 1;
  }
  return found;
}

function decodeXml(text: string): string {
  let out = '';
  let from = 0;
  for (;;) {
    const start = text.indexOf('<![CDATA[', from);
    const end = start === -1 ? -1 : text.indexOf(']]>', start + 9);
    if (end === -1) {
      out += decodeEntities(text.slice(from));
      return out;
    }
    out += decodeEntities(text.slice(from, start)) + text.slice(start + 9, end);
    from = end + 3;
  }
}

const decodeEntities = (text: string) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

interface DavResponse {
  href: string;
  /** The raw content of each prop a `200` propstat holds, by local name. */
  props: Map<string, string>;
}

function parseMultistatus(xml: string): DavResponse[] {
  return elements(xml, 'response').flatMap(({ body }) => {
    const href = elements(body, 'href')[0]?.body;
    if (!href) return [];
    const props = new Map<string, string>();
    for (const { body: propstat } of elements(body, 'propstat')) {
      const status = elements(propstat, 'status')[0]?.body ?? '';
      if (!/\s2\d\d\s/.test(` ${status} `)) continue;
      for (const { name, body: value } of elements(elements(propstat, 'prop')[0]?.body ?? '')) {
        props.set(name, value);
      }
    }
    return [{ href: decodeXml(href.trim()), props }];
  });
}

/** The `href` inside a prop (`current-user-principal`, `calendar-home-set`). */
const hrefIn = (prop: string | undefined) => {
  const href = prop ? elements(prop, 'href')[0]?.body : undefined;
  return href ? decodeXml(href.trim()) : null;
};

const hasElement = (xml: string | undefined, name: string) =>
  xml !== undefined && elements(xml, name).length > 0;

const xmlDate = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, '');

const PRINCIPAL_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:current-user-principal/><c:calendar-home-set/><d:resourcetype/></d:prop>
</d:propfind>`;

const CALENDARS_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
  <d:prop><d:resourcetype/><d:displayname/><a:calendar-color/><c:supported-calendar-component-set/><d:current-user-privilege-set/></d:prop>
</d:propfind>`;

const queryBody = (from: Date, to: Date) => `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
    <c:time-range start="${xmlDate(from)}" end="${xmlDate(to)}"/>
  </c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`;

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The resource holding the event with this UID (a substring match: the caller compares). */
const uidQuery = (uid: string) => `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
    <c:prop-filter name="UID"><c:text-match collation="i;octet">${escapeXml(uid)}</c:text-match></c:prop-filter>
  </c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`;

const calendarProps = (change: { name?: string; color?: string | null }) =>
  [
    change.name !== undefined ? `<d:displayname>${escapeXml(change.name)}</d:displayname>` : '',
    change.color ? `<a:calendar-color>${escapeXml(change.color)}</a:calendar-color>` : '',
  ].join('');

const mkcalendarBody = (
  name: string,
  color: string | null,
) => `<?xml version="1.0" encoding="utf-8"?>
<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
  <d:set><d:prop>${calendarProps({ name, color })}<c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:set>
</c:mkcalendar>`;

const proppatchBody = (change: {
  name?: string;
  color?: string;
}) => `<?xml version="1.0" encoding="utf-8"?>
<d:propertyupdate xmlns:d="DAV:" xmlns:a="http://apple.com/ns/ical/">
  <d:set><d:prop>${calendarProps(change)}</d:prop></d:set>
</d:propertyupdate>`;

/** What `current-user-privilege-set` lets: absent, everything may be tried. */
function davRights(privileges: string | undefined): RemoteRights {
  if (privileges === undefined) return { events: true, rename: true, drop: 'delete' };
  const names = new Set(
    elements(privileges, 'privilege').flatMap(({ body }) => elements(body).map((one) => one.name)),
  );
  const write = names.has('all') || names.has('write');
  const events = write || names.has('write-content');
  return {
    events,
    rename: write || names.has('write-properties'),
    drop: write ? 'delete' : null,
  };
}

// ---------------------------------------------------------------------------------------------
// CalDAV

/** Providers whose CalDAV server is not found from the mail domain's `.well-known` alone. */
const KNOWN_SERVERS: [RegExp, string][] = [
  [/^(icloud|me|mac)\.com$/, 'https://caldav.icloud.com/'],
  [/^gmx\.(de|net|at|ch)$/, 'https://caldav.gmx.net/'],
  [/^web\.de$/, 'https://caldav.web.de/'],
  [/^mailbox\.org$/, 'https://dav.mailbox.org/'],
  [/^posteo\.(de|net)$/, 'https://posteo.de:8443/'],
  [/^(fastmail\.(com|fm)|messagingengine\.com)$/, 'https://caldav.fastmail.com/'],
  [/^(yahoo\.(com|de)|ymail\.com)$/, 'https://caldav.calendar.yahoo.com/'],
];

/** The servers to ask, in order: the given one, else the provider's, then the domain's own. */
function caldavCandidates(address: string, url?: string): URL[] {
  const domain = address.split('@').pop()?.trim().toLowerCase() ?? '';
  const bases: string[] = [];
  if (url) bases.push(url.trim());
  else {
    const known = KNOWN_SERVERS.find(([pattern]) => pattern.test(domain))?.[1];
    if (known) bases.push(known);
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      bases.push(`https://${domain}/.well-known/caldav`, `https://caldav.${domain}/`);
    }
  }
  const urls: URL[] = [];
  for (const base of bases) {
    let parsed: URL;
    try {
      parsed = new URL(base);
    } catch {
      throw new Error('Die Adresse des Kalender-Servers ist ungültig.');
    }
    // A server's root that names no principal often still answers at its `.well-known`.
    const wellKnown = new URL('/.well-known/caldav', parsed);
    for (const one of [parsed, wellKnown]) {
      if (!urls.some((u) => u.href === one.href)) urls.push(one);
    }
  }
  return urls;
}

/** The registrable part of a host, roughly: `p42-caldav.icloud.com` → `icloud.com`. */
function siteOf(host: string): string {
  const labels = host.toLowerCase().split('.');
  const shortSecond = /^(co|com|org|net|ac|gov|or|ne)$/.test(labels.at(-2) ?? '');
  return labels.slice(shortSecond && (labels.at(-1)?.length ?? 0) === 2 ? -3 : -2).join('.');
}

interface DavAnswer {
  status: number;
  text: string;
  url: URL;
  etag: string | null;
}

interface DavRequest {
  depth?: '0' | '1';
  body?: string;
  /** Default: XML. */
  type?: string;
  headers?: Record<string, string>;
  /** A write: a refusal (403) is the answer, not a wrong password. */
  write?: boolean;
}

/**
 * A mail account's calendars over CalDAV, signed in with its password (Basic auth). Every request
 * goes through `fetchHop` (`sources/safe-fetch.ts`): https only – so the password never travels
 * in the clear – public addresses only, pinned to the address checked. Asked only on the sites
 * this account's server stands on: the configured or guessed server's, and those it sends Slider
 * on to (a redirect, an href like iCloud's `p42-caldav.icloud.com`); a calendar id elsewhere is
 * refused. And the password only to a host that asks for it (401 with a Basic challenge): the
 * address's domain is guessed, its web host must not get it unasked.
 */
export function caldavSource(opts: {
  address: string;
  username: string;
  password: string;
  url?: string;
  fetch?: typeof fetch;
  /** DNS for the address check; tests hand in a fixed one. */
  lookup?: LookupAll;
}): CalendarSource & CalendarWriter {
  if (opts.url && !/^https:\/\//i.test(opts.url.trim())) {
    throw new Error('Der Kalender-Server muss über https erreichbar sein.');
  }
  const http = {
    fetch: (opts.fetch ?? globalThis.fetch) as FetchLike,
    lookup: opts.lookup ?? dnsLookup,
    maxBytes: MAX_BODY_BYTES,
  };
  const authorization = `Basic ${Buffer.from(`${opts.username}:${opts.password}`).toString('base64')}`;
  const candidates = () => caldavCandidates(opts.address, opts.url);
  const sites = new Set(candidates().map((url) => siteOf(url.hostname)));
  const trust = (url: URL) => sites.add(siteOf(url.hostname));
  const trusted = (url: URL) => url.protocol === 'https:' && sites.has(siteOf(url.hostname));
  /** The hosts that asked for the password (Basic), told it from then on. */
  const asking = new Set<string>();

  async function dav(method: string, url: URL, request: DavRequest) {
    let current = url;
    for (let hop = 0; ; hop++) {
      if (!trusted(current)) throw new Error(GONE);
      let response: Response;
      try {
        response = await fetchHop(current, http, {
          method,
          headers: {
            ...(asking.has(current.host) && { Authorization: authorization }),
            ...(request.depth && { Depth: request.depth }),
            ...(request.body !== undefined && {
              'Content-Type': request.type ?? 'application/xml; charset=utf-8',
            }),
            ...request.headers,
          },
          body: request.body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        throw reachError(error);
      }
      const next = redirectTarget(response, current);
      if (next) {
        await response.body?.cancel();
        if (hop >= MAX_REDIRECTS || next.protocol !== 'https:') throw new Error(UNREACHABLE);
        trust(next);
        current = next;
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        const challenge = response.headers.get('www-authenticate') ?? '';
        if (response.status === 401 && !asking.has(current.host) && /\bbasic\b/i.test(challenge)) {
          // Asked for it: the same request again, now signed in (not a hop).
          asking.add(current.host);
          hop--;
          continue;
        }
        if (response.status === 403 && request.write) {
          return { status: 403, text: '', url: current, etag: null } satisfies DavAnswer;
        }
        throw new Error(REJECTED);
      }
      let text = '';
      if (response.ok) {
        try {
          text = new TextDecoder().decode(await readBodyCapped(response, MAX_BODY_BYTES));
        } catch {
          throw new Error(UNREACHABLE);
        }
      } else await response.body?.cancel();
      return {
        status: response.status,
        text,
        url: current,
        etag: response.headers.get('etag'),
      } satisfies DavAnswer;
    }
  }

  /** An href of an answer, as a URL; the server named it, so its site may have the password. */
  const resolve = (href: string, answer: DavAnswer) => {
    const url = new URL(href, answer.url);
    trust(url);
    return url;
  };

  /** The calendar home: principal first, then its `calendar-home-set`. */
  async function findHome(): Promise<URL> {
    let lastError: Error | null = null;
    for (const candidate of candidates()) {
      try {
        const first = await dav('PROPFIND', candidate, { depth: '0', body: PRINCIPAL_BODY });
        if (first.status !== 207) continue;
        const own = parseMultistatus(first.text)[0];
        const home = hrefIn(own?.props.get('calendar-home-set'));
        if (home) return resolve(home, first);
        const principalHref = hrefIn(own?.props.get('current-user-principal'));
        if (!principalHref) {
          // A URL given by hand may name the home or a calendar itself.
          if (opts.url && own) return first.url;
          continue;
        }
        const principal = resolve(principalHref, first);
        const second = await dav('PROPFIND', principal, { depth: '0', body: PRINCIPAL_BODY });
        const found = hrefIn(parseMultistatus(second.text)[0]?.props.get('calendar-home-set'));
        if (second.status === 207 && found) return resolve(found, second);
      } catch (error) {
        // Wrong password is the answer, wherever it came from; a host that is not there is not.
        if (error instanceof Error && error.message === REJECTED) throw error;
        lastError = error instanceof Error ? error : null;
      }
    }
    throw lastError && lastError.message !== UNREACHABLE ? lastError : new Error(NOT_FOUND);
  }

  let home: Promise<URL> | null = null;
  const homeOnce = () => {
    home ??= findHome().catch((error: unknown) => {
      home = null;
      throw error;
    });
    return home;
  };

  async function list(): Promise<RemoteCalendar[]> {
    const answer = await dav('PROPFIND', await homeOnce(), { depth: '1', body: CALENDARS_BODY });
    if (answer.status !== 207) throw new Error(FAILED);
    const calendars: RemoteCalendar[] = [];
    for (const { href, props } of parseMultistatus(answer.text)) {
      if (!hasElement(props.get('resourcetype'), 'calendar')) continue;
      // Task lists and journals come as calendars too; only those with events count.
      const components = props.get('supported-calendar-component-set');
      if (components !== undefined && !/name\s*=\s*["']VEVENT["']/i.test(components)) continue;
      const url = resolve(href, answer);
      const segment = decodeURIComponent(url.pathname.replace(/\/$/, '').split('/').pop() ?? '');
      calendars.push({
        remoteId: url.href,
        name: decodeXml(props.get('displayname') ?? '').trim() || segment || 'Kalender',
        color: cssColor(decodeXml(props.get('calendar-color') ?? '')),
        rights: davRights(props.get('current-user-privilege-set')),
      });
    }
    return calendars;
  }

  /** A calendar's URL, its site trusted (learnt on the way – a redirect – only by a discovery). */
  async function calendarUrl(remoteId: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(remoteId);
    } catch {
      throw new Error(GONE);
    }
    if (!trusted(url)) await list();
    return url;
  }

  async function events(remoteId: string, from: Date, to: Date): Promise<RemoteEvent[]> {
    const url = await calendarUrl(remoteId);
    const answer = await dav('REPORT', url, { depth: '1', body: queryBody(from, to) });
    if (answer.status === 404 || answer.status === 410) throw new Error(GONE);
    if (answer.status !== 207) throw new Error(FAILED);
    const found = new Map<string, RemoteEvent>();
    for (const { props } of parseMultistatus(answer.text)) {
      const data = props.get('calendar-data');
      if (!data) continue;
      const etag = etagOf(props.get('getetag'));
      for (const event of parseIcsEvents(decodeXml(data), remoteId, from, to)) {
        found.set(event.id, etag ? { ...event, etag } : event);
      }
    }
    return [...found.values()].sort((a, b) => a.start.localeCompare(b.start));
  }

  /**
   * The resource holding an event, by the id `events` gave: its UID, or for an occurrence of a
   * series its UID and start (`uid/20261109T080000Z`) – then `occurrence`.
   */
  async function find(remoteId: string, eventId: string) {
    const url = await calendarUrl(remoteId);
    const slash = eventId.lastIndexOf('/');
    const uids = slash > 0 ? [eventId, eventId.slice(0, slash)] : [eventId];
    for (const uid of uids) {
      const answer = await dav('REPORT', url, { depth: '1', body: uidQuery(uid) });
      if (answer.status === 404 || answer.status === 410) throw new Error(GONE);
      if (answer.status !== 207) throw new Error(FAILED);
      for (const { href, props } of parseMultistatus(answer.text)) {
        const ics = decodeXml(props.get('calendar-data') ?? '');
        const held = icsEventsOf(ics);
        if (!held.uids.includes(uid)) continue;
        return {
          url: resolve(href, answer),
          etag: etagOf(props.get('getetag')),
          ics,
          series: held.series || uid !== eventId,
        };
      }
    }
    return null;
  }

  /** The resource to change: there, a single event, still the version the person saw. */
  async function toWrite(remoteId: string, eventId: string, etag: string | undefined) {
    const found = await find(remoteId, eventId);
    if (!found) throw new Error(EVENT_GONE);
    if (found.series) throw new Error(SERIES);
    if (etag && found.etag && etag !== found.etag) throw new Error(CONFLICT);
    return found;
  }

  /** What a write's answer means: done, or why not. */
  function written(status: number) {
    if (status >= 200 && status < 300) return;
    if (status === 412) throw new Error(CONFLICT);
    if (status === 403) throw new Error(READ_ONLY);
    if (status === 404 || status === 410) throw new Error(EVENT_GONE);
    throw new Error(WRITE_REFUSED);
  }

  const now = () => new Date();

  const writer: CalendarWriter = {
    async get(remoteId, eventId) {
      const found = await find(remoteId, eventId);
      if (!found) return null;
      if (found.series) throw new Error(SERIES);
      const event = icsSingleEvent(found.ics, remoteId);
      return event && { ...event, id: eventId, ...(found.etag && { etag: found.etag }) };
    },

    async create(remoteId, fields) {
      const base = await calendarUrl(remoteId);
      const folder = base.href.endsWith('/') ? base : new URL(`${base.href}/`);
      const uid = crypto.randomUUID();
      const ics = newIcsEvent(uid, fields, now());
      const answer = await dav('PUT', new URL(`${uid}.ics`, folder), {
        body: ics,
        type: 'text/calendar; charset=utf-8',
        headers: { 'If-None-Match': '*' },
        write: true,
      });
      written(answer.status);
      const event = icsSingleEvent(ics, remoteId)!;
      return { ...event, ...(answer.etag && { etag: answer.etag }) };
    },

    async update(remoteId, eventId, change, etag) {
      const found = await toWrite(remoteId, eventId, etag);
      const ics = changedIcsEvent(found.ics, change, now());
      const answer = await dav('PUT', found.url, {
        body: ics,
        type: 'text/calendar; charset=utf-8',
        headers: found.etag ? { 'If-Match': found.etag } : {},
        write: true,
      });
      written(answer.status);
      const event = icsSingleEvent(ics, remoteId);
      if (!event) throw new Error(WRITE_REFUSED);
      return { ...event, id: eventId, ...(answer.etag && { etag: answer.etag }) };
    },

    async remove(remoteId, eventId, etag) {
      const found = await find(remoteId, eventId);
      if (!found) return;
      if (found.series) throw new Error(SERIES);
      if (etag && found.etag && etag !== found.etag) throw new Error(CONFLICT);
      const answer = await dav('DELETE', found.url, {
        headers: found.etag ? { 'If-Match': found.etag } : {},
        write: true,
      });
      if (answer.status === 404 || answer.status === 410) return;
      written(answer.status);
    },

    async createCalendar(name, color) {
      const home = await homeOnce();
      const folder = home.href.endsWith('/') ? home : new URL(`${home.href}/`);
      const url = new URL(`${crypto.randomUUID()}/`, folder);
      const answer = await dav('MKCALENDAR', url, {
        body: mkcalendarBody(name, color),
        write: true,
      });
      if (answer.status !== 201 && answer.status !== 200) {
        throw new Error('Der Kalender-Server lässt hier keinen neuen Kalender anlegen.');
      }
      return {
        remoteId: url.href,
        name,
        color,
        rights: { events: true, rename: true, drop: 'delete' },
      };
    },

    async updateCalendar(remoteId, change) {
      const answer = await dav('PROPPATCH', await calendarUrl(remoteId), {
        body: proppatchBody(change),
        write: true,
      });
      if (answer.status === 404 || answer.status === 410) throw new Error(GONE);
      const set = parseMultistatus(answer.text)[0]?.props;
      const done =
        answer.status === 207
          ? (change.name === undefined || set?.has('displayname')) &&
            (change.color === undefined || set?.has('calendar-color'))
          : answer.status >= 200 && answer.status < 300;
      if (!done) throw new Error('Der Kalender-Server lässt diesen Kalender nicht umbenennen.');
    },

    async deleteCalendar(remoteId) {
      const answer = await dav('DELETE', await calendarUrl(remoteId), { write: true });
      if (answer.status === 404 || answer.status === 410) return;
      if (answer.status < 200 || answer.status >= 300) {
        throw new Error('Der Kalender-Server lässt diesen Kalender nicht löschen.');
      }
    },
  };

  return { list, events, ...writer };
}

/** A `getetag` prop as sent (quotes kept: it goes back in `If-Match` as it came). */
const etagOf = (prop: string | undefined) => (prop ? decodeXml(prop).trim() || null : null);

/** What a failed request tells the person – never the request itself, it carries the login. */
function reachError(error: unknown): Error {
  if (error instanceof ApiError && error.code === 'unsupported_link') {
    return new Error('Der Kalender-Server liegt an einer internen Adresse.');
  }
  if (error instanceof ApiError && error.code === 'source_not_found') return new Error(NOT_FOUND);
  return new Error(UNREACHABLE);
}

/** `#RRGGBB` from Apple's `#RRGGBBAA` (or a short `#RGB`); anything else none. */
function cssColor(value: string): string | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(value.trim())?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return `#${full.toUpperCase()}`;
}

// ---------------------------------------------------------------------------------------------
// Google and Microsoft: an access token from the mail account's sign-in

interface VendorMessages {
  expired: string;
  forbidden: string;
  failed: string;
  /** Writing: the sign-in has no consent to change – signed in before Slider asked for it. */
  regrant: string;
  /** Writing: the provider refused what was sent. */
  rejected: string;
}

async function getJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  accessToken: string,
  messages: VendorMessages,
  headers: Record<string, string> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error(messages.failed);
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401) throw new Error(messages.expired);
    if (response.status === 403) throw new Error(messages.forbidden);
    if (response.status === 404 || response.status === 410) throw new Error(GONE);
    throw new Error(messages.failed);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(messages.failed);
  }
}

/** A provider's answer to a write that went wrong, as the person reads it. */
async function writeError(response: Response, messages: VendorMessages, gone: string) {
  const status = response.status;
  // The reason, read only to tell a missing consent from a calendar one may only read.
  const reason = status === 403 ? await response.text().catch(() => '') : '';
  if (status !== 403) await response.body?.cancel();
  if (status === 401) return new Error(messages.expired);
  if (status === 403) {
    return new Error(/insufficient|scope/i.test(reason) ? messages.regrant : READ_ONLY);
  }
  if (status === 404 || status === 410) return new Error(gone);
  if (status === 412) return new Error(CONFLICT);
  if (status >= 500) return new Error(messages.failed);
  return new Error(messages.rejected);
}

/**
 * A write to a provider's API: the answer's JSON (`null` without one). `gone`: what a 404 means;
 * `quietGone`: a 404 is fine (deleting what is gone already).
 */
async function sendJson<T>(
  fetchImpl: typeof fetch,
  method: string,
  url: string,
  accessToken: string,
  messages: VendorMessages,
  opts: {
    body?: unknown;
    headers?: Record<string, string>;
    gone?: string;
    quietGone?: boolean;
  } = {},
): Promise<T | null> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(opts.body !== undefined && { 'Content-Type': 'application/json' }),
        ...opts.headers,
      },
      ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error(messages.failed);
  }
  if (!response.ok) {
    if (opts.quietGone && (response.status === 404 || response.status === 410)) {
      await response.body?.cancel();
      return null;
    }
    throw await writeError(response, messages, opts.gone ?? EVENT_GONE);
  }
  if (response.status === 204) return null;
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(messages.failed);
  }
}

/** Google's descriptions are HTML when written in its web calendar; notes are plain text. */
function htmlToText(html: string): string {
  if (!/<[a-z][^>]*>/i.test(html)) return html;
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A colour Slider sends a provider: only `#rrggbb` (an accent name is the theme's, not theirs). */
const hexColor = (color: string | null | undefined) =>
  color && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null;

const REGRANT_HINT =
  'Melde das Konto dafür in der Kalenderliste oder unter Postfächer mit „Neu anmelden“ neu an.';

const GOOGLE_MESSAGES: VendorMessages = {
  expired: 'Die Anmeldung bei Google ist abgelaufen. Bitte melde das Postfach neu an.',
  forbidden: 'Slider darf den Google-Kalender nicht lesen. Bitte melde das Postfach neu an.',
  failed: 'Der Google-Kalender konnte gerade nicht geladen werden.',
  regrant: `Slider darf diesen Google-Kalender noch nicht ändern. ${REGRANT_HINT}`,
  rejected: 'Google hat die Änderung nicht angenommen.',
};

interface GoogleCalendarList {
  items?: {
    id: string;
    summary?: string;
    summaryOverride?: string;
    backgroundColor?: string;
    deleted?: boolean;
    primary?: boolean;
    accessRole?: string;
  }[];
  nextPageToken?: string;
}

interface GoogleTime {
  date?: string;
  dateTime?: string;
}

interface GoogleEvent {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  start?: GoogleTime;
  end?: GoogleTime;
}

interface GoogleEvents {
  items?: GoogleEvent[];
  nextPageToken?: string;
}

const GOOGLE_API = 'https://www.googleapis.com/calendar/v3';

/** One's role in a Google calendar: owner and writer fill it, only its owner names or deletes it. */
function googleRights(role: string | undefined, primary: boolean): RemoteRights {
  const owner = role === 'owner';
  const events = owner || role === 'writer';
  return {
    events,
    rename: owner,
    drop: primary ? null : owner ? 'delete' : 'remove',
  };
}

function fromGoogle(item: GoogleEvent, remoteId: string): RemoteEvent | null {
  if (item.status === 'cancelled') return null;
  const allDay = Boolean(item.start?.date);
  const start = allDay ? item.start?.date : isoInstant(item.start?.dateTime);
  const end = allDay ? (item.end?.date ?? start) : isoInstant(item.end?.dateTime);
  if (!start || !end) return null;
  return {
    id: item.id,
    calendarRemoteId: remoteId,
    title: item.summary ?? '',
    location: item.location ?? '',
    notes: htmlToText(item.description ?? ''),
    allDay,
    start,
    end,
    ...(item.etag && { etag: item.etag }),
  };
}

/** A change as Google takes it; a patch clears the other kind of time with `null`. */
function toGoogle(change: RemoteEventChange, patch: boolean) {
  const body: Record<string, unknown> = {};
  if (change.title !== undefined) body['summary'] = change.title;
  if (change.location !== undefined) body['location'] = change.location;
  if (change.notes !== undefined) body['description'] = change.notes;
  if (change.allDay !== undefined && change.start && change.end) {
    const time = (value: string) =>
      change.allDay
        ? { date: value, ...(patch && { dateTime: null, timeZone: null }) }
        : { dateTime: value, ...(patch && { date: null }) };
    body['start'] = time(change.start);
    body['end'] = time(change.end);
  }
  return body;
}

/**
 * Google Calendar API v3; recurring events come expanded (`singleEvents`) – an occurrence's id
 * is its instance's, so a change or delete touches that occurrence alone.
 */
export function googleSource(
  accessToken: string,
  fetchImpl?: typeof fetch,
): CalendarSource & CalendarWriter {
  const http = fetchImpl ?? globalThis.fetch;
  const eventUrl = (remoteId: string, eventId?: string) =>
    `${GOOGLE_API}/calendars/${encodeURIComponent(remoteId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}`;
  const send = <T>(method: string, url: string, opts?: Parameters<typeof sendJson>[5]) =>
    sendJson<T>(http, method, url, accessToken, GOOGLE_MESSAGES, opts);
  const ifMatch = (etag?: string) => (etag ? { 'If-Match': etag } : undefined);
  const listEntry = (remoteId: string) =>
    `${GOOGLE_API}/users/me/calendarList/${encodeURIComponent(remoteId)}`;
  const recolor = (remoteId: string, color: string) =>
    send('PATCH', `${listEntry(remoteId)}?colorRgbFormat=true`, {
      body: { backgroundColor: color, foregroundColor: '#ffffff' },
      gone: GONE,
    });
  return {
    async list() {
      const calendars: RemoteCalendar[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = new URL(`${GOOGLE_API}/users/me/calendarList`);
        url.searchParams.set('maxResults', '250');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const answer = await getJson<GoogleCalendarList>(
          http,
          url.href,
          accessToken,
          GOOGLE_MESSAGES,
        );
        for (const item of answer.items ?? []) {
          if (item.deleted) continue;
          calendars.push({
            remoteId: item.id,
            name: item.summaryOverride || item.summary || 'Kalender',
            color: cssColor(item.backgroundColor ?? ''),
            rights: googleRights(item.accessRole, item.primary === true),
          });
        }
        pageToken = answer.nextPageToken;
        if (!pageToken) break;
      }
      return calendars;
    },

    async events(remoteId, from, to) {
      const events: RemoteEvent[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = new URL(eventUrl(remoteId));
        url.searchParams.set('timeMin', from.toISOString());
        url.searchParams.set('timeMax', to.toISOString());
        url.searchParams.set('singleEvents', 'true');
        url.searchParams.set('orderBy', 'startTime');
        url.searchParams.set('maxResults', '2500');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const answer = await getJson<GoogleEvents>(http, url.href, accessToken, GOOGLE_MESSAGES);
        for (const item of answer.items ?? []) {
          const event = fromGoogle(item, remoteId);
          if (event) events.push(event);
        }
        pageToken = answer.nextPageToken;
        if (!pageToken) break;
      }
      return events;
    },

    async get(remoteId, eventId) {
      const item = await send<GoogleEvent>('GET', eventUrl(remoteId, eventId), {
        quietGone: true,
      });
      return item && fromGoogle(item, remoteId);
    },

    async create(remoteId, fields) {
      const item = await send<GoogleEvent>('POST', eventUrl(remoteId), {
        body: toGoogle(fields, false),
        gone: GONE,
      });
      const event = item && fromGoogle(item, remoteId);
      if (!event) throw new Error(GOOGLE_MESSAGES.rejected);
      return event;
    },

    async update(remoteId, eventId, change, etag) {
      const item = await send<GoogleEvent>('PATCH', eventUrl(remoteId, eventId), {
        body: toGoogle(change, true),
        headers: ifMatch(etag),
      });
      const event = item && fromGoogle(item, remoteId);
      if (!event) throw new Error(EVENT_GONE);
      return event;
    },

    async remove(remoteId, eventId, etag) {
      await send('DELETE', eventUrl(remoteId, eventId), {
        headers: ifMatch(etag),
        quietGone: true,
      });
    },

    async createCalendar(name, color) {
      const made = await send<{ id: string; summary?: string }>('POST', `${GOOGLE_API}/calendars`, {
        body: { summary: name, timeZone: ZONE },
      });
      if (!made?.id) throw new Error(GOOGLE_MESSAGES.rejected);
      const hex = hexColor(color);
      // The colour is the list's; the calendar stands without it.
      if (hex) await recolor(made.id, hex).catch(() => undefined);
      return {
        remoteId: made.id,
        name: made.summary ?? name,
        color: hex ? hex.toUpperCase() : null,
        rights: googleRights('owner', false),
      };
    },

    async updateCalendar(remoteId, change) {
      if (change.name !== undefined) {
        await send('PATCH', `${GOOGLE_API}/calendars/${encodeURIComponent(remoteId)}`, {
          body: { summary: change.name },
          gone: GONE,
        });
      }
      const hex = hexColor(change.color);
      if (hex) await recolor(remoteId, hex);
    },

    async deleteCalendar(remoteId, how) {
      await send(
        'DELETE',
        how === 'delete'
          ? `${GOOGLE_API}/calendars/${encodeURIComponent(remoteId)}`
          : listEntry(remoteId),
        { quietGone: true },
      );
    },
  };
}

/** An ISO instant in UTC from any ISO date-time (an offset, or none meaning UTC). */
function isoInstant(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const ms = Date.parse(zoned);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

const MICROSOFT_MESSAGES: VendorMessages = {
  expired: 'Die Anmeldung bei Microsoft ist abgelaufen. Bitte melde das Postfach neu an.',
  forbidden: 'Slider darf den Outlook-Kalender nicht lesen. Bitte melde das Postfach neu an.',
  failed: 'Der Outlook-Kalender konnte gerade nicht geladen werden.',
  regrant: `Slider darf diesen Outlook-Kalender noch nicht ändern. ${REGRANT_HINT}`,
  rejected: 'Microsoft hat die Änderung nicht angenommen.',
};

interface GraphCalendar {
  id: string;
  name?: string;
  hexColor?: string;
  canEdit?: boolean;
  canShare?: boolean;
  isRemovable?: boolean;
  isDefaultCalendar?: boolean;
}

interface GraphCalendars {
  value?: GraphCalendar[];
  '@odata.nextLink'?: string;
}

interface GraphTime {
  dateTime?: string;
}

interface GraphEvent {
  id: string;
  '@odata.etag'?: string;
  subject?: string;
  location?: { displayName?: string };
  body?: { content?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  start?: GraphTime;
  end?: GraphTime;
}

interface GraphEvents {
  value?: GraphEvent[];
  '@odata.nextLink'?: string;
}

const GRAPH_API = 'https://graph.microsoft.com/v1.0';
const GRAPH_EVENT_FIELDS = 'id,subject,location,body,isAllDay,isCancelled,start,end';
/** Times in UTC, notes as text instead of Outlook's HTML – asked and answered alike. */
const GRAPH_PREFER = { Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"' };

/** The token goes nowhere else: a next page outside Graph ends the list. */
const graphPage = (link: string | undefined) =>
  link?.startsWith(`${GRAPH_API}/`) ? link : undefined;

/** Its rights: `canShare` only its owner has – they name and delete it; the default stays. */
const graphRights = (item: GraphCalendar): RemoteRights => ({
  events: item.canEdit !== false,
  rename: item.canShare !== false && item.canEdit !== false,
  drop:
    item.isDefaultCalendar || item.isRemovable === false
      ? null
      : item.canShare === false
        ? 'remove'
        : 'delete',
});

/**
 * A whole day's date from Graph's time in UTC: a day in Berlin starts at 22:00 or 23:00 UTC the
 * day before, so the nearest midnight counts (zones up to twelve hours either side).
 */
function graphDay(dateTime: string | undefined): string | undefined {
  const ms = dateTime ? Date.parse(`${dateTime.slice(0, 19)}Z`) : Number.NaN;
  return Number.isNaN(ms) ? undefined : new Date(ms + 12 * 3_600_000).toISOString().slice(0, 10);
}

function fromGraph(item: GraphEvent, remoteId: string): RemoteEvent | null {
  if (item.isCancelled) return null;
  const allDay = item.isAllDay === true;
  const start = allDay
    ? graphDay(item.start?.dateTime)
    : isoInstant(item.start?.dateTime?.slice(0, 23));
  const end = allDay ? graphDay(item.end?.dateTime) : isoInstant(item.end?.dateTime?.slice(0, 23));
  if (!start || !end) return null;
  return {
    id: item.id,
    calendarRemoteId: remoteId,
    title: item.subject ?? '',
    location: item.location?.displayName ?? '',
    notes: (item.body?.content ?? '').trim(),
    allDay,
    start,
    end,
    ...(item['@odata.etag'] && { etag: item['@odata.etag'] }),
  };
}

/** A change as Graph takes it: whole days at midnight in Slider's zone, times in UTC. */
function toGraph(change: RemoteEventChange) {
  const body: Record<string, unknown> = {};
  if (change.title !== undefined) body['subject'] = change.title;
  if (change.location !== undefined) body['location'] = { displayName: change.location };
  if (change.notes !== undefined) body['body'] = { contentType: 'text', content: change.notes };
  if (change.allDay !== undefined && change.start && change.end) {
    const time = (value: string) =>
      change.allDay
        ? { dateTime: `${value}T00:00:00`, timeZone: ZONE }
        : { dateTime: new Date(value).toISOString().slice(0, 19), timeZone: 'UTC' };
    body['isAllDay'] = change.allDay;
    body['start'] = time(change.start);
    body['end'] = time(change.end);
  }
  return body;
}

/**
 * Microsoft Graph v1.0; `calendarView` expands recurring events itself – an occurrence's id is
 * its own, so a change or delete touches that occurrence alone.
 */
export function microsoftSource(
  accessToken: string,
  fetchImpl?: typeof fetch,
): CalendarSource & CalendarWriter {
  const http = fetchImpl ?? globalThis.fetch;
  const calendarUrl = (remoteId: string) =>
    `${GRAPH_API}/me/calendars/${encodeURIComponent(remoteId)}`;
  const eventUrl = (remoteId: string, eventId?: string) =>
    `${calendarUrl(remoteId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}`;
  const send = <T>(method: string, url: string, opts?: Parameters<typeof sendJson>[5]) =>
    sendJson<T>(http, method, url, accessToken, MICROSOFT_MESSAGES, opts);
  return {
    async list() {
      const calendars: RemoteCalendar[] = [];
      let next: string | undefined = `${GRAPH_API}/me/calendars?$top=100`;
      for (let page = 0; next && page < MAX_PAGES; page++) {
        const answer: GraphCalendars = await getJson<GraphCalendars>(
          http,
          next,
          accessToken,
          MICROSOFT_MESSAGES,
        );
        for (const item of answer.value ?? []) {
          calendars.push({
            remoteId: item.id,
            name: item.name || 'Kalender',
            color: cssColor(item.hexColor ?? ''),
            rights: graphRights(item),
          });
        }
        next = graphPage(answer['@odata.nextLink']);
      }
      return calendars;
    },

    async events(remoteId, from, to) {
      const url = new URL(`${calendarUrl(remoteId)}/calendarView`);
      url.searchParams.set('startDateTime', from.toISOString());
      url.searchParams.set('endDateTime', to.toISOString());
      url.searchParams.set('$top', '250');
      url.searchParams.set('$select', GRAPH_EVENT_FIELDS);
      const events: RemoteEvent[] = [];
      let next: string | undefined = url.href;
      for (let page = 0; next && page < MAX_PAGES; page++) {
        const answer: GraphEvents = await getJson<GraphEvents>(
          http,
          next,
          accessToken,
          MICROSOFT_MESSAGES,
          GRAPH_PREFER,
        );
        for (const item of answer.value ?? []) {
          const event = fromGraph(item, remoteId);
          if (event) events.push(event);
        }
        next = graphPage(answer['@odata.nextLink']);
      }
      return events;
    },

    async get(remoteId, eventId) {
      const item = await send<GraphEvent>(
        'GET',
        `${eventUrl(remoteId, eventId)}?$select=${GRAPH_EVENT_FIELDS}`,
        { headers: GRAPH_PREFER, quietGone: true },
      );
      return item && fromGraph(item, remoteId);
    },

    async create(remoteId, fields) {
      const item = await send<GraphEvent>('POST', eventUrl(remoteId), {
        body: toGraph(fields),
        headers: GRAPH_PREFER,
        gone: GONE,
      });
      const event = item && fromGraph(item, remoteId);
      if (!event) throw new Error(MICROSOFT_MESSAGES.rejected);
      return event;
    },

    async update(remoteId, eventId, change, etag) {
      const item = await send<GraphEvent>('PATCH', eventUrl(remoteId, eventId), {
        body: toGraph(change),
        headers: { ...GRAPH_PREFER, ...(etag && { 'If-Match': etag }) },
      });
      const event = item && fromGraph(item, remoteId);
      if (!event) throw new Error(EVENT_GONE);
      return event;
    },

    async remove(remoteId, eventId, etag) {
      await send('DELETE', eventUrl(remoteId, eventId), {
        headers: etag ? { 'If-Match': etag } : undefined,
        quietGone: true,
      });
    },

    async createCalendar(name) {
      // Graph names colours (`lightBlue` …), it takes no `#rrggbb`: a new one gets Outlook's.
      const made = await send<GraphCalendar>('POST', `${GRAPH_API}/me/calendars`, {
        body: { name },
      });
      if (!made?.id) throw new Error(MICROSOFT_MESSAGES.rejected);
      return {
        remoteId: made.id,
        name: made.name || name,
        color: cssColor(made.hexColor ?? ''),
        rights: graphRights(made),
      };
    },

    async updateCalendar(remoteId, change) {
      // Its colour is one of Outlook's names – kept here, the next look would set it back.
      if (change.color !== undefined) {
        throw new Error('Die Farbe eines Outlook-Kalenders lässt sich nur in Outlook ändern.');
      }
      if (change.name === undefined) return;
      await send('PATCH', calendarUrl(remoteId), { body: { name: change.name }, gone: GONE });
    },

    async deleteCalendar(remoteId) {
      await send('DELETE', calendarUrl(remoteId), { quietGone: true });
    },
  };
}
