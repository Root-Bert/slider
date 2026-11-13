import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

/* The desktop's JSON files in `<dataDir>` (BER-201): file links, sync links, the session. */

/** The file's value; `null` when it is not there or not readable. */
export function readJsonFile<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Written atomically (a temporary file renamed over it), readable by this account only. */
export function writeJsonFile(file: string, value: unknown): void {
  writeFileSync(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}
