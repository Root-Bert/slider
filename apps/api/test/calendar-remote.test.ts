import { describe, expect, it } from 'vitest';
import { parseIcsEvents } from '../src/services/calendar/ical';
import { caldavSource, googleSource, microsoftSource } from '../src/services/calendar/remote';
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
            '/dav/calendars/anna/tasks/',
            `<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
            <d:displayname>Aufgaben</d:displayname>
            <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>`,
          )}
          </d:multistatus>`);
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
    const seen: { url: string; headers: Headers }[] = [];
    const api = (pages: Record<string, unknown>) =>
      (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        seen.push({ url, headers: new Headers(init?.headers) });
        const key = Object.keys(pages).find((k) => url.includes(k));
        return key ? Response.json(pages[key]) : new Response(null, { status: 401 });
      }) as typeof fetch;

    const google = googleSource(
      'g-token',
      api({
        'pageToken=p2': { items: [{ id: 'b@group', summary: 'Feiertage' }] },
        calendarList: {
          items: [
            { id: 'anna@gmail.com', summary: 'Anna', backgroundColor: '#9fe1e7' },
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
    expect(await google.list()).toEqual([
      { remoteId: 'anna@gmail.com', name: 'Anna', color: '#9FE1E7' },
      { remoteId: 'b@group', name: 'Feiertage', color: null },
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

    seen.length = 0;
    const microsoft = microsoftSource(
      'm-token',
      api({
        skiptoken: { value: [{ id: 'AAM=', name: 'Geburtstage', hexColor: '' }] },
        '/me/calendars?': {
          value: [{ id: 'AAK=', name: 'Kalender', hexColor: '#00ff00' }],
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
            { id: 'occ-3', subject: 'Weg', isCancelled: true },
          ],
          '@odata.nextLink': 'https://evil.example.com/steal',
        },
      }),
    );
    expect(await microsoft.list()).toEqual([
      { remoteId: 'AAK=', name: 'Kalender', color: '#00FF00' },
      { remoteId: 'AAM=', name: 'Geburtstage', color: null },
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
    ]);
    expect(seen.at(-1)!.headers.get('prefer')).toContain('outlook.timezone="UTC"');
    expect(seen.at(-1)!.url).toContain('/me/calendars/AAK%3D/calendarView?startDateTime=');
    // The token never follows a next page off Graph.
    expect(seen.some((s) => s.url.includes('evil'))).toBe(false);
  });
});
