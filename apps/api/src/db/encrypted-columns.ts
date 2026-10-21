import { customType } from 'drizzle-orm/pg-core';
import { isEncrypted, openText, sealText } from '../crypto/content-crypto';

/**
 * Columns whose content is encrypted at rest (BER-149). The SQL types stay `text` and `jsonb`, so
 * the schema and its migrations are unchanged; values are sealed on the way in and opened on the
 * way out. SQL can no longer compare, search or sort by their content – only test for blank text
 * and empty lists.
 *
 * Each column seals with `table.column` as additional data, so a value copied into another
 * column does not open. The row is not bound in – `toDriver` never sees it – so swapping values
 * between rows of the same column still goes unnoticed.
 */
export const encryptedText = (table: string, column: string) =>
  customType<{ data: string; driverData: string }>({
    dataType: () => 'text',
    toDriver: (value) => sealText(value, `${table}.${column}`),
    fromDriver: (value) => openText(value, `${table}.${column}`),
  })(column);

/**
 * JSON stored as one sealed JSON string. Rows from before encryption still hold the plain JSON
 * and are read as they are.
 */
export const encryptedJson = <T>(table: string, column: string) =>
  customType<{ data: T; driverData: unknown }>({
    dataType: () => 'jsonb',
    toDriver: (value) => JSON.stringify(sealText(JSON.stringify(value), `${table}.${column}`)),
    fromDriver: (raw) => openJson<T>(raw, `${table}.${column}`),
  })(column);

/**
 * A JSON list sealed like `encryptedJson`, except that an empty list stays a plain `[]` – like
 * blank text, it carries nothing, and SQL keeps telling empty lists apart (`open-comments`).
 */
export const encryptedJsonList = <T>(table: string, column: string) =>
  customType<{ data: T[]; driverData: unknown }>({
    dataType: () => 'jsonb',
    toDriver: (value) =>
      value.length === 0
        ? '[]'
        : JSON.stringify(sealText(JSON.stringify(value), `${table}.${column}`)),
    fromDriver: (raw) => openJson<T[]>(raw, `${table}.${column}`),
  })(column);

function openJson<T>(raw: unknown, context: string): T {
  // postgres-js hands jsonb over as text, PGlite already parsed.
  const value: unknown = typeof raw === 'string' && !isEncrypted(raw) ? JSON.parse(raw) : raw;
  return (
    typeof value === 'string' && isEncrypted(value) ? JSON.parse(openText(value, context)) : value
  ) as T;
}
