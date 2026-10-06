import type { Context } from 'hono';
import type { z } from 'zod';
import { badRequest } from './errors';

/** Parses the JSON body against `schema`; malformed JSON and schema violations become 400s. */
export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest('Der Request-Body ist kein gültiges JSON.');
  }
  return schema.parse(body);
}
