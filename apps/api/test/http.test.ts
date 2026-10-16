import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ApiError,
  badRequest,
  errorHandler,
  fileTooLarge,
  forbidden,
  notAPowerPoint,
  notFound,
  notFoundHandler,
} from '../src/http/errors';
import { parseRange } from '../src/http/range';
import { readJson } from '../src/http/validate';
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

  it('turns schema violations into a 400 naming the field', async () => {
    const res = await post('{"name":""}');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('bad_request');
    expect(body.error.message).toMatch(/^name: /);
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
