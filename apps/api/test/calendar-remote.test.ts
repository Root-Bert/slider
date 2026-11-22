import { describe, expect, it } from 'vitest';
import { parseIcsEvents } from '../src/services/calendar/ical';
import {
  caldavSource,
  CONFLICT,
  googleSource,
  microsoftSource,
} from '../src/services/calendar/remote';
import type { LookupAll } from '../src/sources/safe-fetch';

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:weekly-1',
  'SUMMARY:Jour fixe\\, Team',
  'DESCRIPTION:Erste Zeile\\nZweite \\; Zeile mit einem sehr langen Text\\, der',
  '  umgebrochen wird',
  'LOCATION:Raum 1',
  'DTSTART;TZID=Europe/Berlin:20261012T090000',
  'DTEND;TZID=Europe/Berlin:20261012T100000',
  'RRULE:FREQ=WEEKLY;COUNT=6',
  'EXDATE;TZID=Europe/Berlin:20261102T090000',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:Erinnerung',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:weekly-1',
  'RECURRENCE-ID;TZID=Europe/Berlin:20261109T090000',
  'SUMMARY:Verschoben',
  'DTSTART;TZID="W. Europe Standard Time":20261110T140000',
  'DURATION:PT90M',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:weekly-1',
  'RECURRENCE-ID:20261116T080000Z',
  'STATUS:CANCELLED',
  'DTSTART;TZID=Europe/Berlin:20261116T090000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:allday-1',
  'SUMMARY:Messe',
  'DTSTART;VALUE=DATE:20261103',
  'DTEND;VALUE=DATE:20261105',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:monthly-1',
  'SUMMARY:Monatsabschluss',
  'DTSTART:20261030T100000Z',
  'DTEND:20261030T110000Z',
  'RRULE:FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20261231T235959Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:floating-1',
  'SUMMARY:Ohne Zone',
  'DTSTART:20261020T100000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:birthday-1',
  'SUMMARY:Geburtstag',
  'DTSTART;VALUE=DATE:20151105',
  'RRULE:FREQ=YEARLY',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:gone-1',
  'SUMMARY:Abgesagt',
  'STATUS:CANCELLED',
  'DTSTART:20261021T100000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const lookup: LookupAll = async () => [{ address: '203.0.113.10' }];

const xml = (body: string, status = 207) =>
  new Response(`<?xml version="1.0"?>${body}`, {
    status,
    headers: { 'Content-Type': 'application/xml' },
  });

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

describe('remote calendars', () => {
  it('expands iCal events: DST, EXDATE, overrides, whole days, monthly ordinals', () => {
    const events = parseIcsEvents(
      ICS,
      'cal',
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-12-01T00:00:00Z'),
    );
    const weekly = events.filter((e) => e.id.startsWith('weekly-1/'));
    // 9:00 Berlin stays 9:00 across the switch on 25 Oct; 2 Nov excluded, 9 Nov moved, 16 Nov off.
    expect(weekly.map((e) => [e.id, e.start, e.end, e.title])).toEqual([
      [
        'weekly-1/20261012T070000Z',
        '2026-10-12T07:00:00.000Z',
        '2026-10-12T08:00:00.000Z',
        'Jour fixe, Team',
      ],
      [
        'weekly-1/20261019T070000Z',
        '2026-10-19T07:00:00.000Z',
        '2026-10-19T08:00:00.000Z',
        'Jour fixe, Team',
      ],
      [
        'weekly-1/20261026T080000Z',
        '2026-10-26T08:00:00.000Z',
        '2026-10-26T09:00:00.000Z',
        'Jour fixe, Team',
      ],
      [
        'weekly-1/20261109T080000Z',
        '2026-11-10T13:00:00.000Z',
        '2026-11-10T14:30:00.000Z',
        'Verschoben',
      ],
    ]);
    expect(weekly[0]).toMatchObject({
      calendarRemoteId: 'cal',
      allDay: false,
      location: 'Raum 1',
      notes: 'Erste Zeile\nZweite ; Zeile mit einem sehr langen Text, der umgebrochen wird',
    });

    const byUid = (uid: string) => events.filter((e) => e.id.split('/')[0] === uid);
    expect(byUid('allday-1')).toEqual([
      {
        id: 'allday-1',
        calendarRemoteId: 'cal',
        title: 'Messe',
        location: '',
        notes: '',
        allDay: true,
        start: '2026-11-03',
        end: '2026-11-05',
      },
    ]);
    expect(byUid('monthly-1').map((e) => e.start)).toEqual([
      '2026-10-30T10:00:00.000Z',
      '2026-11-27T10:00:00.000Z',
    ]);
    // Floating times are Berlin's; a zero-length event is kept.
    expect(byUid('floating-1').map((e) => [e.start, e.end])).toEqual([
      ['2026-10-20T08:00:00.000Z', '2026-10-20T08:00:00.000Z'],
    ]);
    expect(byUid('birthday-1').map((e) => [e.id, e.start, e.end])).toEqual([
      ['birthday-1/20261105', '2026-11-05', '2026-11-06'],
    ]);
    expect(byUid('gone-1')).toEqual([]);
    // Sorted by start.
    expect(events.map((e) => e.id)[0]).toBe('weekly-1/20261012T070000Z');

    // A daily rule since 2015 without an end reaches a window years later, and only it.
    const daily = parseIcsEvents(
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:d',
        'DTSTART;TZID=Europe/Berlin:20150101T070000',
        'DTEND;TZID=Europe/Berlin:20150101T073000',
        'RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\n'),
      'cal',
      new Date('2026-11-01T00:00:00Z'),
      new Date('2026-11-05T00:00:00Z'),
    );
    expect(daily.map((e) => e.start)).toEqual([
      '2026-11-02T06:00:00.000Z',
      '2026-11-03T06:00:00.000Z',
      '2026-11-04T06:00:00.000Z',
    ]);
  });

  it('finds a CalDAV account from its address, lists its calendars and reads events', async () => {
    const calls: { method: string; url: string; auth: string | null; depth: string | null }[] = [];
    const ics = escapeXml(ICS);
    const WORK = 'https://dav.example.net/dav/calendars/anna/work/';
    /** A single event with an alarm, its version changing with every write. */
    let single = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:single-1',
      'DTSTAMP:20261001T000000Z',
      'SEQUENCE:2',
      'SUMMARY:Einzeln',
      'DTSTART:20261020T080000Z',
      'DTEND:20261020T090000Z',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    let singleTag = '"7"';
    /** Changed by someone else between Slider's look and its write. */
    let race: string | undefined;
    const writes: { method: string; url: string; headers: Headers; body: string }[] = [];
    const server = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      calls.push({
        method,
        url,
        auth: headers.get('authorization'),
        depth: headers.get('depth'),
      });
      const body = typeof init?.body === 'string' ? init.body : '';
      if (!['PROPFIND', 'REPORT'].includes(method)) writes.push({ method, url, headers, body });
      // The domain's web host sends on, unasked; the server asks for the password.
      if (url === 'https://example.org/.well-known/caldav') {
        return new Response(null, {
          status: 301,
          headers: { Location: 'https://dav.example.net/dav/' },
        });
      }
      if (headers.get('authorization') !== `Basic ${btoa('anna:geheim')}`) {
        return new Response(null, {
          status: 401,
          headers: { 'WWW-Authenticate': 'Basic realm="dav"' },
        });
      }
      if (url === 'https://dav.example.net/dav/') {
        return xml(`<D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/</D:href>
          <D:propstat><D:prop><D:current-user-principal><D:href>/dav/principals/anna/</D:href>
          </D:current-user-principal></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
          <D:propstat><D:prop><cal:calendar-home-set xmlns:cal="urn:ietf:params:xml:ns:caldav"/>
          </D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat></D:response></D:multistatus>`);
      }
      if (url === 'https://dav.example.net/dav/principals/anna/') {
        return xml(`<multistatus xmlns="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav"><response>
          <href>/dav/principals/anna/</href><propstat><prop><cal:calendar-home-set>
          <href>https://dav.example.net/dav/calendars/anna/</href></cal:calendar-home-set></prop>
          <status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`);
      }
      if (url === 'https://dav.example.net/dav/calendars/anna/' && method === 'PROPFIND') {
        const entry = (href: string, props: string) =>
          `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop>
          <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
        return xml(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"
          xmlns:x1="http://apple.com/ns/ical/">
          ${entry('/dav/calendars/anna/', '<d:resourcetype><d:collection/></d:resourcetype>')}
          ${entry(
            '/dav/calendars/anna/work/',
            `<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
            <d:displayname>Arbeit &amp; Team</d:displayname>
            <x1:calendar-color>#FF8800FF</x1:calendar-color>
            <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>`,
          )}
          ${entry(
            '/dav/calendars/anna/shared/',
            `<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
            <d:displayname>Geteilt</d:displayname>
            <d:current-user-privilege-set><d:privilege><d:read/></d:privilege>
            <d:privilege><d:read-current-user-privilege-set/></d:privilege></d:current-user-privilege-set>`,
          )}
          ${entry(
            '/dav/calendars/anna/tasks/',
            `<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
            <d:displayname>Aufgaben</d:displayname>
            <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>`,
          )}
          </d:multistatus>`);
      }
      if (url === WORK && method === 'REPORT' && body.includes('name="UID"')) {
        const uid = /<c:text-match[^>]*>([^<]*)</.exec(body)?.[1] ?? '';
        const resource = (href: string, tag: string, data: string) =>
          `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:getetag>${tag}</d:getetag>
          <c:calendar-data>${escapeXml(data)}</c:calendar-data></d:prop>
          <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
        return xml(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          ${'weekly-1'.includes(uid) ? resource('/dav/calendars/anna/work/a.ics', '"1"', ICS) : ''}
          ${'single-1'.includes(uid) && single ? resource('/dav/calendars/anna/work/b.ics', singleTag, single) : ''}
          </d:multistatus>`);
      }
      if (url === `${WORK}b.ics` && method === 'PUT') {
        if (headers.get('if-match') !== (race ?? singleTag)) {
          return new Response(null, { status: 412 });
        }
        single = body;
        singleTag = '"8"';
        return new Response(null, { status: 204, headers: { ETag: singleTag } });
      }
      if (url === `${WORK}b.ics` && method === 'DELETE') {
        single = '';
        return new Response(null, { status: 204 });
      }
      if (url.startsWith(WORK) && method === 'PUT') {
        return new Response(null, { status: 201, headers: { ETag: '"n1"' } });
      }
      if (method === 'MKCALENDAR') return new Response(null, { status: 201 });
      if (url === WORK && method === 'PROPPATCH') {
        const named = body.includes('Verboten') ? 'HTTP/1.1 403 Forbidden' : 'HTTP/1.1 200 OK';
        return xml(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/calendars/anna/work/</d:href>
          <d:propstat><d:prop><d:displayname/></d:prop><d:status>${named}</d:status></d:propstat>
          </d:response></d:multistatus>`);
      }
      if (url.endsWith('/anna/shared/') && method === 'DELETE') {
        return new Response(null, { status: 403 });
      }
      if (url === 'https://dav.example.net/dav/calendars/anna/work/' && method === 'REPORT') {
        return xml(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:response><d:href>/dav/calendars/anna/work/a.ics</d:href><d:propstat><d:prop>
          <d:getetag>"1"</d:getetag><c:calendar-data>${ics}</c:calendar-data></d:prop>
          <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`);
      }
      return new Response(null, { status: 404 });
    };
    const options = {
      address: 'anna@example.org',
      username: 'anna',
      password: 'geheim',
      fetch: server as typeof fetch,
      lookup,
    };

    const source = caldavSource(options);
    expect(await source.list()).toEqual([
      {
        remoteId: 'https://dav.example.net/dav/calendars/anna/work/',
        name: 'Arbeit & Team',
        color: '#FF8800',
        rights: { events: true, rename: true, drop: 'delete' },
      },
      // Its privileges say read: shown, nothing written.
      {
        remoteId: 'https://dav.example.net/dav/calendars/anna/shared/',
        name: 'Geteilt',
        color: null,
        rights: { events: false, rename: false, drop: null },
      },
    ]);
    expect(calls.map((c) => [c.method, c.url, c.depth, c.auth !== null])).toEqual([
      ['PROPFIND', 'https://example.org/.well-known/caldav', '0', false],
      ['PROPFIND', 'https://dav.example.net/dav/', '0', false],
      ['PROPFIND', 'https://dav.example.net/dav/', '0', true],
      ['PROPFIND', 'https://dav.example.net/dav/principals/anna/', '0', true],
      ['PROPFIND', 'https://dav.example.net/dav/calendars/anna/', '1', true],
    ]);
    expect(calls.every((c) => c.url.startsWith('https://'))).toBe(true);

    // A fresh source (the caller keeps only the id) learns the redirected site again first.
    calls.length = 0;
    const events = await caldavSource(options).events(
      'https://dav.example.net/dav/calendars/anna/work/',
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-12-01T00:00:00Z'),
    );
    expect(calls.at(-1)).toMatchObject({ method: 'REPORT', depth: '1' });
    expect(events.find((e) => e.id === 'weekly-1/20261109T080000Z')).toMatchObject({
      calendarRemoteId: 'https://dav.example.net/dav/calendars/anna/work/',
      title: 'Verschoben',
      start: '2026-11-10T13:00:00.000Z',
    });
    expect(events.filter((e) => e.id.startsWith('weekly-1/'))).toHaveLength(4);
    expect(events[0]?.etag).toBe('"1"');

    // Writes: found by UID, changed with the version seen (If-Match), its alarm kept; a series'
    // occurrence is refused – Slider has no series to change it as.
    calls.length = 0;
    const writer = caldavSource(options);
    expect(await writer.get(WORK, 'single-1')).toMatchObject({
      id: 'single-1',
      title: 'Einzeln',
      start: '2026-10-20T08:00:00.000Z',
      etag: '"7"',
    });
    await expect(writer.update(WORK, 'weekly-1/20261012T070000Z', { title: 'X' })).rejects.toThrow(
      'Termine einer Serie lassen sich in diesem Kalender nur beim Anbieter ändern.',
    );
    await expect(writer.update(WORK, 'single-1', { title: 'X' }, '"6"')).rejects.toThrow(CONFLICT);
    expect(writes).toEqual([]);
    const changed = await writer.update(
      WORK,
      'single-1',
      { title: 'Neu, gleich; bald', allDay: true, start: '2026-10-21', end: '2026-10-22' },
      '"7"',
    );
    expect(changed).toMatchObject({
      id: 'single-1',
      title: 'Neu, gleich; bald',
      allDay: true,
      start: '2026-10-21',
      end: '2026-10-22',
      etag: '"8"',
    });
    expect(writes[0]).toMatchObject({ method: 'PUT', url: `${WORK}b.ics` });
    expect(writes[0]!.headers.get('if-match')).toBe('"7"');
    expect(writes[0]!.headers.get('content-type')).toContain('text/calendar');
    expect(single).toContain('SUMMARY:Neu\\, gleich\\; bald\r\n');
    expect(single).toContain('DTSTART;VALUE=DATE:20261021\r\n');
    expect(single).toContain('SEQUENCE:3\r\n');
    expect(single).toContain('BEGIN:VALARM');
    expect(single).not.toContain('20261020T080000Z');
    // Changed elsewhere between: the server's 412 says so too.
    race = '"10"';
    await expect(writer.update(WORK, 'single-1', { notes: 'x' })).rejects.toThrow(CONFLICT);
    race = undefined;
    await writer.remove(WORK, 'single-1', '"8"');
    expect(writes.at(-1)).toMatchObject({ method: 'DELETE', url: `${WORK}b.ics` });
    expect(writes.at(-1)!.headers.get('if-match')).toBe('"8"');
    // Gone already: nothing to delete.
    writes.length = 0;
    await writer.remove(WORK, 'single-1');
    expect(writes).toEqual([]);
    const made = await writer.create(WORK, {
      title: 'Anruf',
      location: '',
      notes: '',
      allDay: false,
      start: '2026-10-22T08:00:00.000Z',
      end: '2026-10-22T08:30:00.000Z',
    });
    expect(made).toMatchObject({ title: 'Anruf', start: '2026-10-22T08:00:00.000Z', etag: '"n1"' });
    expect(writes[0]!.url).toBe(`${WORK}${made.id}.ics`);
    expect(writes[0]!.headers.get('if-none-match')).toBe('*');
    expect(writes[0]!.body).toContain(`UID:${made.id}\r\n`);
    expect(writes[0]!.body).toContain('DTSTART:20261022T080000Z\r\n');

    // Calendars: made under the home, renamed, a refusal said in German.
    writes.length = 0;
    const project = await writer.createCalendar('Projekt <A>', '#112233');
    expect(project).toMatchObject({ name: 'Projekt <A>', rights: { drop: 'delete' } });
    expect(project.remoteId).toMatch(
      /^https:\/\/dav\.example\.net\/dav\/calendars\/anna\/[\w-]+\/$/,
    );
    expect(writes[0]).toMatchObject({ method: 'MKCALENDAR', url: project.remoteId });
    expect(writes[0]!.body).toContain('<d:displayname>Projekt &lt;A&gt;</d:displayname>');
    expect(writes[0]!.body).toContain('#112233');
    await writer.updateCalendar(WORK, { name: 'Büro' });
    await expect(writer.updateCalendar(WORK, { name: 'Verboten' })).rejects.toThrow(
      'Der Kalender-Server lässt diesen Kalender nicht umbenennen.',
    );
    await expect(
      writer.deleteCalendar('https://dav.example.net/dav/calendars/anna/shared/', 'delete'),
    ).rejects.toThrow('Der Kalender-Server lässt diesen Kalender nicht löschen.');

    // The password goes to no other site, nor in the clear; refusals say so without it.
    calls.length = 0;
    await expect(
      source.events('https://evil.example.com/cal/', new Date(), new Date()),
    ).rejects.toThrow('Diesen Kalender gibt es auf dem Server nicht mehr.');
    expect(calls.some((c) => c.url.includes('evil'))).toBe(false);
    expect(() => caldavSource({ ...options, url: 'http://dav.example.net/' })).toThrow(/https/);
    const wrong = caldavSource({ ...options, password: 'falsch' });
    const refused = await wrong.list().catch((error: Error) => error.message);
    expect(refused).toBe('Der Kalender-Server hat die Anmeldung abgelehnt.');
    expect(refused).not.toContain('falsch');
    const internal = caldavSource({
      ...options,
      url: 'https://dav.intern.example/',
      lookup: async () => [{ address: '10.0.0.5' }],
    });
    await expect(internal.list()).rejects.toThrow('internen Adresse');
  });

  it('maps Google Calendar and Microsoft Graph answers', async () => {
    const seen: { url: string; method: string; headers: Headers; body: unknown }[] = [];
    const api = (pages: Record<string, unknown>) =>
      (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        seen.push({
          url,
          method: init?.method ?? 'GET',
          headers: new Headers(init?.headers),
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        });
        const key = Object.keys(pages).find((k) => url.includes(k));
        return key ? Response.json(pages[key]) : new Response(null, { status: 401 });
      }) as typeof fetch;
    /** A provider answering writes in turn. */
    const answers: Response[] = [];
    const writes = () =>
      (async (input: string | URL | Request, init?: RequestInit) => {
        await api({})(input, init);
        return answers.shift() ?? new Response(null, { status: 500 });
      }) as typeof fetch;
    const lastWrite = () => seen.at(-1)!;

    const google = googleSource(
      'g-token',
      api({
        'pageToken=p2': { items: [{ id: 'b@group', summary: 'Feiertage', accessRole: 'reader' }] },
        calendarList: {
          items: [
            {
              id: 'anna@gmail.com',
              summary: 'Anna',
              backgroundColor: '#9fe1e7',
              accessRole: 'owner',
              primary: true,
            },
            { id: 'old', summary: 'Alt', deleted: true },
          ],
          nextPageToken: 'p2',
        },
        '/events': {
          items: [
            {
              id: 'abc_20261012T070000Z',
              summary: 'Planung',
              location: 'Büro',
              description: 'Agenda:<br>Punkt &amp; Punkt',
              start: { dateTime: '2026-10-12T09:00:00+02:00' },
              end: { dateTime: '2026-10-12T10:00:00+02:00' },
            },
            { id: 'x', status: 'cancelled', start: { date: '2026-10-13' } },
            {
              id: 'day',
              summary: 'Urlaub',
              start: { date: '2026-10-14' },
              end: { date: '2026-10-16' },
            },
          ],
        },
      }),
    );
    // One's own primary one: filled and renamed, never deleted; a subscribed one only read and
    // taken off the list.
    expect(await google.list()).toEqual([
      {
        remoteId: 'anna@gmail.com',
        name: 'Anna',
        color: '#9FE1E7',
        rights: { events: true, rename: true, drop: null },
      },
      {
        remoteId: 'b@group',
        name: 'Feiertage',
        color: null,
        rights: { events: false, rename: false, drop: 'remove' },
      },
    ]);
    expect(
      await google.events('anna@gmail.com', new Date('2026-10-01'), new Date('2026-11-01')),
    ).toEqual([
      {
        id: 'abc_20261012T070000Z',
        calendarRemoteId: 'anna@gmail.com',
        title: 'Planung',
        location: 'Büro',
        notes: 'Agenda:\nPunkt & Punkt',
        allDay: false,
        start: '2026-10-12T07:00:00.000Z',
        end: '2026-10-12T08:00:00.000Z',
      },
      {
        id: 'day',
        calendarRemoteId: 'anna@gmail.com',
        title: 'Urlaub',
        location: '',
        notes: '',
        allDay: true,
        start: '2026-10-14',
        end: '2026-10-16',
      },
    ]);
    const eventsCall = new URL(seen.at(-1)!.url);
    expect(eventsCall.pathname).toBe('/calendar/v3/calendars/anna%40gmail.com/events');
    expect(eventsCall.searchParams.get('singleEvents')).toBe('true');
    expect(eventsCall.searchParams.get('timeMin')).toBe('2026-10-01T00:00:00.000Z');
    expect(seen.at(-1)!.headers.get('authorization')).toBe('Bearer g-token');
    await expect(googleSource('expired', api({})).list()).rejects.toThrow(
      'Die Anmeldung bei Google ist abgelaufen',
    );

    // Google writes: an occurrence by its instance id, with the version seen; a patch to a whole
    // day clears the time; refusals told apart – changed elsewhere, consent missing, read only.
    const gw = googleSource('g-token', writes());
    const G = 'https://www.googleapis.com/calendar/v3';
    answers.push(
      Response.json({
        id: 'new1',
        etag: '"e1"',
        summary: 'Anruf',
        start: { dateTime: '2026-10-22T10:00:00+02:00' },
        end: { dateTime: '2026-10-22T10:30:00+02:00' },
      }),
    );
    const call = {
      title: 'Anruf',
      location: '',
      notes: '',
      allDay: false,
      start: '2026-10-22T08:00:00.000Z',
      end: '2026-10-22T08:30:00.000Z',
    };
    expect(await gw.create('anna@gmail.com', call)).toMatchObject({
      id: 'new1',
      etag: '"e1"',
      start: '2026-10-22T08:00:00.000Z',
    });
    expect(lastWrite()).toMatchObject({
      method: 'POST',
      url: `${G}/calendars/anna%40gmail.com/events`,
      body: {
        summary: 'Anruf',
        location: '',
        description: '',
        start: { dateTime: call.start },
        end: { dateTime: call.end },
      },
    });
    answers.push(
      Response.json({
        id: 'abc_20261012T070000Z',
        etag: '"e2"',
        summary: 'Planung',
        start: { date: '2026-10-12' },
        end: { date: '2026-10-13' },
      }),
    );
    expect(
      await gw.update(
        'anna@gmail.com',
        'abc_20261012T070000Z',
        { allDay: true, start: '2026-10-12', end: '2026-10-13' },
        '"e1"',
      ),
    ).toMatchObject({ allDay: true, start: '2026-10-12', etag: '"e2"' });
    expect(lastWrite()).toMatchObject({
      method: 'PATCH',
      url: `${G}/calendars/anna%40gmail.com/events/abc_20261012T070000Z`,
      body: {
        start: { date: '2026-10-12', dateTime: null, timeZone: null },
        end: { date: '2026-10-13', dateTime: null, timeZone: null },
      },
    });
    expect(lastWrite().headers.get('if-match')).toBe('"e1"');
    answers.push(
      new Response(null, { status: 412 }),
      Response.json(
        { error: { code: 403, message: 'Request had insufficient authentication scopes.' } },
        { status: 403 },
      ),
      Response.json({ error: { code: 403, message: 'Forbidden' } }, { status: 403 }),
    );
    await expect(gw.update('anna@gmail.com', 'new1', { title: 'X' }, '"e0"')).rejects.toThrow(
      'Der Termin wurde inzwischen woanders geändert.',
    );
    await expect(gw.update('anna@gmail.com', 'new1', { title: 'X' })).rejects.toThrow(
      'Office darf diesen Google-Kalender noch nicht ändern. Melde das Konto dafür in der Kalenderliste oder unter Postfächer mit „Neu anmelden“ neu an.',
    );
    await expect(gw.update('b@group', 'new1', { title: 'X' })).rejects.toThrow(
      'In diesem Kalender darfst du nur ansehen, nichts ändern.',
    );
    // Deleted with the version seen; gone already is fine.
    answers.push(new Response(null, { status: 404 }));
    await gw.remove('anna@gmail.com', 'new1', '"e1"');
    expect(lastWrite()).toMatchObject({
      method: 'DELETE',
      url: `${G}/calendars/anna%40gmail.com/events/new1`,
    });
    // Calendars: made in Berlin's zone, coloured on one's list; deleted, or taken off the list.
    answers.push(Response.json({ id: 'p@group', summary: 'Projekt' }), Response.json({}));
    expect(await gw.createCalendar('Projekt', '#112233')).toEqual({
      remoteId: 'p@group',
      name: 'Projekt',
      color: '#112233',
      rights: { events: true, rename: true, drop: 'delete' },
    });
    expect(seen.slice(-2).map((s) => [s.method, s.url, s.body])).toEqual([
      ['POST', `${G}/calendars`, { summary: 'Projekt', timeZone: 'Europe/Berlin' }],
      [
        'PATCH',
        `${G}/users/me/calendarList/p%40group?colorRgbFormat=true`,
        { backgroundColor: '#112233', foregroundColor: '#ffffff' },
      ],
    ]);
    answers.push(Response.json({}), new Response(null, { status: 204 }));
    await gw.updateCalendar('p@group', { name: 'Projekt Nord' });
    expect(lastWrite()).toMatchObject({
      method: 'PATCH',
      url: `${G}/calendars/p%40group`,
      body: { summary: 'Projekt Nord' },
    });
    await gw.deleteCalendar('b@group', 'remove');
    answers.push(new Response(null, { status: 204 }));
    await gw.deleteCalendar('p@group', 'delete');
    expect(seen.slice(-2).map((s) => [s.method, s.url])).toEqual([
      ['DELETE', `${G}/users/me/calendarList/b%40group`],
      ['DELETE', `${G}/calendars/p%40group`],
    ]);

    seen.length = 0;
    const microsoft = microsoftSource(
      'm-token',
      api({
        skiptoken: {
          value: [
            { id: 'AAM=', name: 'Geburtstage', hexColor: '', canEdit: false, canShare: false },
          ],
        },
        '/me/calendars?': {
          value: [
            {
              id: 'AAK=',
              name: 'Kalender',
              hexColor: '#00ff00',
              canEdit: true,
              canShare: true,
              isDefaultCalendar: true,
            },
          ],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendars?$skiptoken=2',
        },
        calendarView: {
          value: [
            {
              id: 'occ-1',
              subject: 'Review',
              location: { displayName: 'Teams' },
              body: { content: 'Bitte vorbereiten\r\n' },
              isAllDay: false,
              start: { dateTime: '2026-10-26T08:00:00.0000000', timeZone: 'UTC' },
              end: { dateTime: '2026-10-26T09:30:00.0000000', timeZone: 'UTC' },
            },
            {
              id: 'occ-2',
              subject: 'Feiertag',
              isAllDay: true,
              start: { dateTime: '2026-10-03T00:00:00.0000000', timeZone: 'UTC' },
              end: { dateTime: '2026-10-04T00:00:00.0000000', timeZone: 'UTC' },
            },
            // A whole day made in Berlin: Graph says it in UTC, the evening before.
            {
              id: 'occ-4',
              '@odata.etag': 'W/"m1"',
              subject: 'Urlaub',
              isAllDay: true,
              start: { dateTime: '2026-10-19T22:00:00.0000000', timeZone: 'UTC' },
              end: { dateTime: '2026-10-21T22:00:00.0000000', timeZone: 'UTC' },
            },
            { id: 'occ-3', subject: 'Weg', isCancelled: true },
          ],
          '@odata.nextLink': 'https://evil.example.com/steal',
        },
      }),
    );
    // The default one stays; one shared with the person is only read and taken off the list.
    expect(await microsoft.list()).toEqual([
      {
        remoteId: 'AAK=',
        name: 'Kalender',
        color: '#00FF00',
        rights: { events: true, rename: true, drop: null },
      },
      {
        remoteId: 'AAM=',
        name: 'Geburtstage',
        color: null,
        rights: { events: false, rename: false, drop: 'remove' },
      },
    ]);
    expect(
      await microsoft.events('AAK=', new Date('2026-10-01'), new Date('2026-11-01')),
    ).toMatchObject([
      {
        id: 'occ-1',
        title: 'Review',
        location: 'Teams',
        notes: 'Bitte vorbereiten',
        allDay: false,
        start: '2026-10-26T08:00:00.000Z',
        end: '2026-10-26T09:30:00.000Z',
      },
      { id: 'occ-2', allDay: true, start: '2026-10-03', end: '2026-10-04' },
      { id: 'occ-4', allDay: true, start: '2026-10-20', end: '2026-10-22', etag: 'W/"m1"' },
    ]);
    expect(seen.at(-1)!.headers.get('prefer')).toContain('outlook.timezone="UTC"');
    expect(seen.at(-1)!.url).toContain('/me/calendars/AAK%3D/calendarView?startDateTime=');
    // The token never follows a next page off Graph.
    expect(seen.some((s) => s.url.includes('evil'))).toBe(false);

    // Graph writes: a whole day at midnight in Berlin, times in UTC; the version seen sent along.
    const mw = microsoftSource('m-token', writes());
    const M = 'https://graph.microsoft.com/v1.0/me/calendars/AAK%3D';
    answers.push(
      Response.json({
        id: 'ev-1',
        '@odata.etag': 'W/"m2"',
        subject: 'Messe',
        isAllDay: true,
        start: { dateTime: '2026-11-02T23:00:00.0000000' },
        end: { dateTime: '2026-11-04T23:00:00.0000000' },
      }),
    );
    expect(
      await mw.create('AAK=', {
        title: 'Messe',
        location: 'Halle 3',
        notes: '',
        allDay: true,
        start: '2026-11-03',
        end: '2026-11-05',
      }),
    ).toMatchObject({ id: 'ev-1', start: '2026-11-03', end: '2026-11-05', etag: 'W/"m2"' });
    expect(lastWrite()).toMatchObject({
      method: 'POST',
      url: `${M}/events`,
      body: {
        subject: 'Messe',
        location: { displayName: 'Halle 3' },
        isAllDay: true,
        start: { dateTime: '2026-11-03T00:00:00', timeZone: 'Europe/Berlin' },
        end: { dateTime: '2026-11-05T00:00:00', timeZone: 'Europe/Berlin' },
      },
    });
    expect(lastWrite().headers.get('prefer')).toContain('outlook.timezone="UTC"');
    answers.push(
      Response.json({
        id: 'occ-1',
        subject: 'Review',
        start: { dateTime: '2026-10-26T09:00:00.0000000' },
        end: { dateTime: '2026-10-26T10:00:00.0000000' },
      }),
    );
    await mw.update(
      'AAK=',
      'occ-1',
      { allDay: false, start: '2026-10-26T09:00:00.000Z', end: '2026-10-26T10:00:00.000Z' },
      'W/"m0"',
    );
    expect(lastWrite()).toMatchObject({
      method: 'PATCH',
      url: `${M}/events/occ-1`,
      body: {
        isAllDay: false,
        start: { dateTime: '2026-10-26T09:00:00', timeZone: 'UTC' },
        end: { dateTime: '2026-10-26T10:00:00', timeZone: 'UTC' },
      },
    });
    expect(lastWrite().headers.get('if-match')).toBe('W/"m0"');
    answers.push(
      Response.json(
        { error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } },
        {
          status: 403,
        },
      ),
      new Response(null, { status: 204 }),
      Response.json({ id: 'AAN=', name: 'Projekt', canEdit: true, canShare: true }),
      new Response(null, { status: 204 }),
    );
    await expect(mw.remove('AAM=', 'b-1')).rejects.toThrow(
      'In diesem Kalender darfst du nur ansehen, nichts ändern.',
    );
    await mw.remove('AAK=', 'occ-1', 'W/"m3"');
    expect(lastWrite()).toMatchObject({ method: 'DELETE', url: `${M}/events/occ-1` });
    expect(await mw.createCalendar('Projekt', '#112233')).toEqual({
      remoteId: 'AAN=',
      name: 'Projekt',
      color: null,
      rights: { events: true, rename: true, drop: 'delete' },
    });
    expect(lastWrite()).toMatchObject({
      method: 'POST',
      url: 'https://graph.microsoft.com/v1.0/me/calendars',
      body: { name: 'Projekt' },
    });
    await expect(mw.updateCalendar('AAN=', { color: '#112233' })).rejects.toThrow('nur in Outlook');
    await mw.deleteCalendar('AAN=', 'delete');
    expect(lastWrite()).toMatchObject({
      method: 'DELETE',
      url: 'https://graph.microsoft.com/v1.0/me/calendars/AAN%3D',
    });
  });
});
