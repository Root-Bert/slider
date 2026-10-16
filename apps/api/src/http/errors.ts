import type { ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import type { ApiError as ApiErrorBody, ErrorCode } from '@slider/shared';
import type { Logger } from '../logger';

/** An expected failure that maps 1:1 to the `{ error: { code, message } }` response. */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    /** Extra fields for the client, e.g. `loginUrl` with `microsoft_login_required`. */
    readonly extra: Pick<ApiErrorBody['error'], 'loginUrl'> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export const badRequest = (message: string) => new ApiError(400, 'bad_request', message);
export const notFound = (message = 'Nicht gefunden.') => new ApiError(404, 'not_found', message);
export const forbidden = (message = 'Dafür fehlt dir die Berechtigung.') =>
  new ApiError(403, 'forbidden', message);
export const notAPowerPoint = (message = 'Die Datei ist keine PowerPoint (.pptx).') =>
  new ApiError(400, 'not_a_powerpoint', message);
export const fileTooLarge = (maxBytes: number) =>
  new ApiError(
    413,
    'file_too_large',
    `Die Datei ist zu groß (maximal ${Math.floor(maxBytes / 1024 / 1024)} MB).`,
  );

/**
 * The first validation problem in German, for the toast: zod's own messages are English and
 * name the field by its JSON path. The path only shows where no German text says what is wrong.
 */
export function describeZodError(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Ungültige Anfrage.';
  const field = issue.path.join('.');
  const generic = field ? `Ungültige Eingabe (${field}).` : 'Ungültige Anfrage.';
  switch (issue.code) {
    // Our own refinements speak German already.
    case 'custom':
      return issue.message || generic;
    case 'invalid_format':
      if (issue.format === 'email') return 'Bitte gib eine gültige E-Mail-Adresse ein.';
      if (issue.format === 'url') return 'Bitte gib eine gültige Adresse (URL) ein.';
      return generic;
    case 'too_big': {
      const max = Number(issue.maximum);
      if (issue.origin === 'string') return `Zu lang (höchstens ${max} Zeichen).`;
      if (issue.origin === 'array' || issue.origin === 'set') {
        return `Zu viele Einträge (höchstens ${max}).`;
      }
      return generic;
    }
    case 'too_small': {
      const min = Number(issue.minimum);
      if (issue.origin === 'string') {
        return min <= 1 ? 'Bitte fülle das Feld aus.' : `Zu kurz (mindestens ${min} Zeichen).`;
      }
      if (issue.origin === 'array' || issue.origin === 'set') {
        return `Zu wenige Einträge (mindestens ${min}).`;
      }
      return generic;
    }
    default:
      return generic;
  }
}

export function errorHandler(log: Logger): ErrorHandler {
  return (err, c) => {
    if (err instanceof ApiError) return c.json(err.toBody(), err.status);
    if (err instanceof ZodError) return c.json(badRequest(describeZodError(err)).toBody(), 400);
    if (err instanceof HTTPException && err.status < 500) {
      return c.json(
        new ApiError(err.status, 'bad_request', err.message || 'Ungültige Anfrage.').toBody(),
        err.status,
      );
    }
    if (isUniqueViolation(err)) {
      // Two requests raced for the same row (e.g. the same name at once): nothing was written.
      log.warn(`Unique violation on ${c.req.method} ${c.req.path}`, err);
      return c.json(
        new ApiError(
          409,
          'bad_request',
          'Das hat sich mit einer anderen Änderung überschnitten. Bitte lade neu und versuche es noch einmal.',
        ).toBody(),
        409,
      );
    }
    log.error(`Unhandled error on ${c.req.method} ${c.req.path}`, err);
    const internal = new ApiError(
      500,
      'internal',
      'Da ist etwas schiefgelaufen. Bitte erneut versuchen.',
    );
    return c.json(internal.toBody(), 500);
  };
}

/** Postgres `unique_violation` (23505) – from postgres-js or PGlite, wrapped by Drizzle or not. */
export function isUniqueViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 3; depth++) {
    if (typeof current !== 'object') return false;
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export const notFoundHandler: NotFoundHandler = (c) => c.json(notFound().toBody(), 404);
