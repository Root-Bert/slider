import { ApiError } from '../../http/errors';
import {
  dnsLookup,
  fetchHop,
  readBodyCapped,
  redirectTarget,
  type FetchLike,
  type LookupAll,
} from '../../sources/safe-fetch';
import { parseIcsEvents } from './ical';

/*
 * The calendars of a person's mail account, read beside Slider's own: CalDAV for accounts signed
 * in with a password, the providers' APIs for those signed in through Google or Microsoft. Only
 * reads – Slider never writes an event back. No DB, no routes: the caller keeps what it needs.
 */

export interface RemoteCalendar {
  remoteId: string;
  name: string;
  color: string | null;
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
}

export interface CalendarSource {
  list(): Promise<RemoteCalendar[]>;
  /** Occurrences overlapping [from, to), recurring ones expanded. */
  events(remoteId: string, from: Date, to: Date): Promise<RemoteEvent[]>;
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
  <d:prop><d:resourcetype/><d:displayname/><a:calendar-color/><c:supported-calendar-component-set/></d:prop>
</d:propfind>`;

const queryBody = (from: Date, to: Date) => `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
    <c:time-range start="${xmlDate(from)}" end="${xmlDate(to)}"/>
  </c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`;

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
}): CalendarSource {
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

  async function dav(method: string, url: URL, depth: '0' | '1', body: string) {
    let current = url;
    for (let hop = 0; ; hop++) {
      if (!trusted(current)) throw new Error(GONE);
      let response: Response;
      try {
        response = await fetchHop(current, http, {
          method,
          headers: {
            ...(asking.has(current.host) && { Authorization: authorization }),
            Depth: depth,
            'Content-Type': 'application/xml; charset=utf-8',
          },
          body,
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
      return { status: response.status, text, url: current } satisfies DavAnswer;
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
        const first = await dav('PROPFIND', candidate, '0', PRINCIPAL_BODY);
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
        const second = await dav('PROPFIND', principal, '0', PRINCIPAL_BODY);
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
    const answer = await dav('PROPFIND', await homeOnce(), '1', CALENDARS_BODY);
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
      });
    }
    return calendars;
  }

  async function events(remoteId: string, from: Date, to: Date): Promise<RemoteEvent[]> {
    let url: URL;
    try {
      url = new URL(remoteId);
    } catch {
      throw new Error(GONE);
    }
    // Sites learnt on the way (a redirect) are known only after a discovery.
    if (!trusted(url)) await list();
    const answer = await dav('REPORT', url, '1', queryBody(from, to));
    if (answer.status === 404 || answer.status === 410) throw new Error(GONE);
    if (answer.status !== 207) throw new Error(FAILED);
    const found = new Map<string, RemoteEvent>();
    for (const { props } of parseMultistatus(answer.text)) {
      const data = props.get('calendar-data');
      if (!data) continue;
      for (const event of parseIcsEvents(decodeXml(data), remoteId, from, to)) {
        found.set(event.id, event);
      }
    }
    return [...found.values()].sort((a, b) => a.start.localeCompare(b.start));
  }

  return { list, events };
}

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

const GOOGLE_MESSAGES: VendorMessages = {
  expired: 'Die Anmeldung bei Google ist abgelaufen. Bitte melde das Postfach neu an.',
  forbidden: 'Slider darf den Google-Kalender nicht lesen. Bitte melde das Postfach neu an.',
  failed: 'Der Google-Kalender konnte gerade nicht geladen werden.',
};

interface GoogleCalendarList {
  items?: {
    id: string;
    summary?: string;
    summaryOverride?: string;
    backgroundColor?: string;
    deleted?: boolean;
  }[];
  nextPageToken?: string;
}

interface GoogleTime {
  date?: string;
  dateTime?: string;
}

interface GoogleEvents {
  items?: {
    id: string;
    status?: string;
    summary?: string;
    location?: string;
    description?: string;
    start?: GoogleTime;
    end?: GoogleTime;
  }[];
  nextPageToken?: string;
}

const GOOGLE_API = 'https://www.googleapis.com/calendar/v3';

/** Google Calendar API v3; recurring events come expanded (`singleEvents`). */
export function googleSource(accessToken: string, fetchImpl?: typeof fetch): CalendarSource {
  const http = fetchImpl ?? globalThis.fetch;
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
        const url = new URL(`${GOOGLE_API}/calendars/${encodeURIComponent(remoteId)}/events`);
        url.searchParams.set('timeMin', from.toISOString());
        url.searchParams.set('timeMax', to.toISOString());
        url.searchParams.set('singleEvents', 'true');
        url.searchParams.set('orderBy', 'startTime');
        url.searchParams.set('maxResults', '2500');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const answer = await getJson<GoogleEvents>(http, url.href, accessToken, GOOGLE_MESSAGES);
        for (const item of answer.items ?? []) {
          if (item.status === 'cancelled') continue;
          const allDay = Boolean(item.start?.date);
          const start = allDay ? item.start?.date : isoInstant(item.start?.dateTime);
          const end = allDay ? (item.end?.date ?? start) : isoInstant(item.end?.dateTime);
          if (!start || !end) continue;
          events.push({
            id: item.id,
            calendarRemoteId: remoteId,
            title: item.summary ?? '',
            location: item.location ?? '',
            notes: htmlToText(item.description ?? ''),
            allDay,
            start,
            end,
          });
        }
        pageToken = answer.nextPageToken;
        if (!pageToken) break;
      }
      return events;
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
};

interface GraphCalendars {
  value?: { id: string; name?: string; hexColor?: string }[];
  '@odata.nextLink'?: string;
}

interface GraphTime {
  dateTime?: string;
}

interface GraphEvents {
  value?: {
    id: string;
    subject?: string;
    location?: { displayName?: string };
    body?: { content?: string };
    isAllDay?: boolean;
    isCancelled?: boolean;
    start?: GraphTime;
    end?: GraphTime;
  }[];
  '@odata.nextLink'?: string;
}

const GRAPH_API = 'https://graph.microsoft.com/v1.0';

/** The token goes nowhere else: a next page outside Graph ends the list. */
const graphPage = (link: string | undefined) =>
  link?.startsWith(`${GRAPH_API}/`) ? link : undefined;

/** Microsoft Graph v1.0; `calendarView` expands recurring events itself. */
export function microsoftSource(accessToken: string, fetchImpl?: typeof fetch): CalendarSource {
  const http = fetchImpl ?? globalThis.fetch;
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
          });
        }
        next = graphPage(answer['@odata.nextLink']);
      }
      return calendars;
    },

    async events(remoteId, from, to) {
      const url = new URL(`${GRAPH_API}/me/calendars/${encodeURIComponent(remoteId)}/calendarView`);
      url.searchParams.set('startDateTime', from.toISOString());
      url.searchParams.set('endDateTime', to.toISOString());
      url.searchParams.set('$top', '250');
      url.searchParams.set('$select', 'id,subject,location,body,isAllDay,isCancelled,start,end');
      const events: RemoteEvent[] = [];
      let next: string | undefined = url.href;
      for (let page = 0; next && page < MAX_PAGES; page++) {
        const answer: GraphEvents = await getJson<GraphEvents>(
          http,
          next,
          accessToken,
          MICROSOFT_MESSAGES,
          // Times in UTC, notes as text instead of Outlook's HTML.
          { Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"' },
        );
        for (const item of answer.value ?? []) {
          if (item.isCancelled) continue;
          const allDay = item.isAllDay === true;
          const start = allDay
            ? item.start?.dateTime?.slice(0, 10)
            : isoInstant(item.start?.dateTime?.slice(0, 23));
          const end = allDay
            ? item.end?.dateTime?.slice(0, 10)
            : isoInstant(item.end?.dateTime?.slice(0, 23));
          if (!start || !end) continue;
          events.push({
            id: item.id,
            calendarRemoteId: remoteId,
            title: item.subject ?? '',
            location: item.location?.displayName ?? '',
            notes: (item.body?.content ?? '').trim(),
            allDay,
            start,
            end,
          });
        }
        next = graphPage(answer['@odata.nextLink']);
      }
      return events;
    },
  };
}
