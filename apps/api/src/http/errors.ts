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
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message } };
  }
}

export const badRequest = (message: string) => new ApiError(400, 'bad_request', message);
export const notFound = (message = 'Nicht gefunden.') => new ApiError(404, 'not_found', message);
export const forbidden = (message = 'Dafür fehlt dir die Berechtigung.') =>
  new ApiError(403, 'forbidden', message);

function describeZodError(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Ungültige Anfrage.';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
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
    log.error(`Unhandled error on ${c.req.method} ${c.req.path}`, err);
    const internal = new ApiError(
      500,
      'internal',
      'Da ist etwas schiefgelaufen. Bitte erneut versuchen.',
    );
    return c.json(internal.toBody(), 500);
  };
}

export const notFoundHandler: NotFoundHandler = (c) => c.json(notFound().toBody(), 404);
