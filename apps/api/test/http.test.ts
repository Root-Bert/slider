import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ApiError,
  badRequest,
  describeZodError,
  errorHandler,
  fileTooLarge,
  forbidden,
  notAPowerPoint,
  notFound,
  notFoundHandler,
} from '../src/http/errors';
import { parseRange } from '../src/http/range';
import { MAX_JSON_BODY_BYTES, readJson } from '../src/http/validate';
import type { Logger } from '../src/logger';

describe('parseRange edge cases', () => {
  it('ignores what is not a single byte range', () => {
    expect(parseRange('', 100)).toBeNull();
    expect(parseRange('bytes=-', 100)).toBeNull();
    expect(parseRange('items=0-5', 100)).toBeNull();
    expect(parseRange('bytes=a-b', 100)).toBeNull();
  });

  it('trims the header and serves a suffix longer than the file whole', () => {
    expect(parseRange('  bytes=0-0 ', 100)).toEqual({ start: 0, end: 0 });
    expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
  });

  it('cannot satisfy an empty suffix or anything of an empty file', () => {
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable');
    expect(parseRange('bytes=99-99', 100)).toEqual({ start: 99, end: 99 });
  });
});

/** A tiny app with the real error handler, recording what it logs. */
function appWithErrors() {
  const logged: unknown[][] = [];
  const log: Logger = {
    info() {},
    warn() {},
    error: (...args) => {
      logged.push(args);
    },
  };
  const app = new Hono().onError(errorHandler(log)).notFound(notFoundHandler);
  return { app, logged };
}

describe('readJson', () => {
  const schema = z.object({ name: z.string().min(1) });
  const app = () => {
    const { app: base } = appWithErrors();
    return base.post('/', async (c) => c.json(await readJson(c, schema)));
  };
  const post = (body: string) =>
    app().request('/', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });

  it('returns the parsed body', async () => {
    const res = await post('{"name":"Anna","extra":1}');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'Anna' });
  });

  it('turns malformed JSON into a 400 with a German message', async () => {
    const res = await post('{nope');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: 'bad_request', message: 'Der Request-Body ist kein gültiges JSON.' },
    });
  });

  it('turns schema violations into a 400 with a German message', async () => {
    const res = await post('{"name":""}');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error).toEqual({ code: 'bad_request', message: 'Bitte fülle das Feld aus.' });
  });

  it('describes the usual validation problems in German, never in zod English', () => {
    const schema = z.object({
      email: z.email().max(320),
      name: z.string().min(2).max(5),
      tags: z.array(z.string()).max(1),
      count: z.number(),
      box: z.number().refine((n) => n > 0, { message: 'Die Box braucht eine Größe.' }),
    });
    const message = (value: Record<string, unknown>) => {
      const result = schema.safeParse({
        email: 'a@firma.de',
        name: 'Anna',
        tags: [],
        count: 1,
        box: 1,
        ...value,
      });
      return result.success ? null : describeZodError(result.error);
    };
    // The client's simple check lets these through; zod does not.
    expect(message({ email: 'müller@firma.de' })).toBe(
      'Bitte gib eine gültige E-Mail-Adresse ein.',
    );
    expect(message({ email: 'a@b.c' })).toBe('Bitte gib eine gültige E-Mail-Adresse ein.');
    expect(message({ name: 'Annabell' })).toBe('Zu lang (höchstens 5 Zeichen).');
    expect(message({ name: 'A' })).toBe('Zu kurz (mindestens 2 Zeichen).');
    expect(message({ tags: ['a', 'b'] })).toBe('Zu viele Einträge (höchstens 1).');
    expect(message({ count: 'eins' })).toBe('Ungültige Eingabe (count).');
    expect(message({ box: -1 })).toBe('Die Box braucht eine Größe.');
  });

  it('refuses bodies over the cap with a 413, declared or streamed', async () => {
    const big = `{"name":"${'a'.repeat(MAX_JSON_BODY_BYTES)}"}`;
    const declared = await post(big);
    expect(declared.status).toBe(413);
    expect(await declared.json()).toEqual({
      error: { code: 'bad_request', message: 'Die Anfrage ist zu groß.' },
    });

    // No Content-Length (chunked): counted while reading, cut off at the cap.
    let sent = 0;
    const chunk = new TextEncoder().encode('a'.repeat(64 * 1024));
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        if (sent > 100 * MAX_JSON_BODY_BYTES) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const streamed = await app().request('/', {
      method: 'POST',
      body: endless,
      headers: { 'Content-Type': 'application/json' },
      duplex: 'half',
    } as RequestInit);
    expect(streamed.status).toBe(413);
    expect(sent).toBeLessThan(2 * MAX_JSON_BODY_BYTES);

    const fits = await post(`{"name":"${'a'.repeat(MAX_JSON_BODY_BYTES - 100)}"}`);
    expect(fits.status).toBe(200);
  });
});

describe('errorHandler', () => {
  const failingWith = (error: unknown) => {
    const { app, logged } = appWithErrors();
    app.get('/', () => {
      throw error;
    });
    return { request: () => app.request('/'), logged };
  };

  it('answers ApiErrors with their status, code, message and extras', async () => {
    const error = new ApiError(401, 'microsoft_login_required', 'Bitte anmelden.', {
      loginUrl: '/login',
    });
    const { request, logged } = failingWith(error);
    const res = await request();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: 'microsoft_login_required', message: 'Bitte anmelden.', loginUrl: '/login' },
    });
    expect(logged).toEqual([]);
  });

  it('answers a ZodError without a path with its plain message', async () => {
    const result = z.string().safeParse(1);
    const { request } = failingWith(result.error);
    const res = await request();
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).not.toMatch(/^: /);
  });

  it('passes client HTTPExceptions through as bad_request', async () => {
    const { request } = failingWith(new HTTPException(413, { message: 'Zu groß' }));
    const res = await request();
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: { code: 'bad_request', message: 'Zu groß' } });
    const empty = await failingWith(new HTTPException(400)).request();
    expect(await empty.json()).toEqual({
      error: { code: 'bad_request', message: 'Ungültige Anfrage.' },
    });
  });

  it('logs anything else and answers a generic 500', async () => {
    const boom = new Error('boom');
    const { request, logged } = failingWith(boom);
    const res = await request();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: 'internal', message: 'Da ist etwas schiefgelaufen. Bitte erneut versuchen.' },
    });
    expect(logged).toEqual([['Unhandled error on GET /', boom]]);
    // A server-side HTTPException is not passed through either.
    expect((await failingWith(new HTTPException(503)).request()).status).toBe(500);
  });

  it('answers a unique violation (a race for the same row) with a 409, wrapped or not', async () => {
    const unique = Object.assign(new Error('duplicate key value'), { code: '23505' });
    for (const error of [unique, new Error('Failed query', { cause: unique })]) {
      const res = await failingWith(error).request();
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad_request');
    }
    const other = Object.assign(new Error('fk'), { code: '23503' });
    expect((await failingWith(other).request()).status).toBe(500);
  });

  it('answers unknown routes with a JSON 404', async () => {
    const res = await appWithErrors().app.request('/nowhere');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Nicht gefunden.' } });
  });
});

describe('error helpers', () => {
  it('carry status, code and their German default texts', () => {
    expect(badRequest('x')).toMatchObject({ status: 400, code: 'bad_request', message: 'x' });
    expect(notFound()).toMatchObject({ status: 404, code: 'not_found' });
    expect(forbidden().message).toBe('Dafür fehlt dir die Berechtigung.');
    expect(notAPowerPoint()).toMatchObject({ status: 400, code: 'not_a_powerpoint' });
    expect(fileTooLarge(50 * 1024 * 1024 + 10)).toMatchObject({
      status: 413,
      code: 'file_too_large',
      message: 'Die Datei ist zu groß (maximal 50 MB).',
    });
    expect(new ApiError(400, 'bad_request', 'x').name).toBe('ApiError');
  });
});
