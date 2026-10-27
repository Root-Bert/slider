import type { Context } from 'hono';
import type { z } from 'zod';
import { ApiError, badRequest } from './errors';

/**
 * Cap for JSON bodies. Every request body is buffered before it is parsed, and several JSON
 * routes need no session (presence, passkey login, setup), so without a cap anyone could make
 * the server buffer hundreds of MB. Uploads are multipart and have their own `bodyLimit`.
 */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;
/** Comments carry drawings: up to 50 strokes of 2000 points each. */
export const MAX_COMMENT_BODY_BYTES = 8 * 1024 * 1024;

const bodyTooLarge = () => new ApiError(413, 'bad_request', 'Die Anfrage ist zu groß.');

/** The body as text, read no further than `maxBytes` (also without or with a false Content-Length). */
async function readText(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw bodyTooLarge();
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw bodyTooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Parses the JSON body against `schema`; malformed JSON and schema violations become 400s, bodies
 * over `maxBytes` a 413.
 */
export async function readJson<S extends z.ZodType>(
  c: Context,
  schema: S,
  maxBytes = MAX_JSON_BODY_BYTES,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): Promise<z.output<S>> {
  const text = await readText(c.req.raw, maxBytes);
  // Some POST actions have optional options and historically accept an absent body.
  if (allowEmpty && !text.trim()) return schema.parse({});
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw badRequest('Der Request-Body ist kein gültiges JSON.');
  }
  return schema.parse(body);
}
