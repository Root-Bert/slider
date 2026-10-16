/**
 * Writes the BER-106 test corpus: `test/corpus/decks/<id>/v1.pptx`, `v2.pptx`, `expected.json`
 * for every case in `test/corpus/cases.ts`. Folders of cases that no longer exist are removed.
 *
 *   bun run corpus
 *
 * Review the `expected.json` diff before committing: it is today's matching behaviour.
 */
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CASES, CORPUS_DIR } from '../test/corpus/cases';
import { writeCase } from '../test/corpus/run-case';

const ids = new Set(CASES.map((c) => c.id));
for (const entry of await readdir(CORPUS_DIR, { withFileTypes: true }).catch(() => [])) {
  if (entry.isDirectory() && !ids.has(entry.name)) {
    await rm(join(CORPUS_DIR, entry.name), { recursive: true });
    console.info(`Removed ${entry.name}`);
  }
}
for (const c of CASES) {
  const expected = await writeCase(CORPUS_DIR, c);
  const counts = new Map<string, number>();
  for (const match of expected.matches)
    counts.set(match.status, (counts.get(match.status) ?? 0) + 1);
  console.info(`${c.id.padEnd(26)} ${[...counts].map(([k, v]) => `${v} ${k}`).join(', ')}`);
}
console.info(`Wrote ${CASES.length} cases to ${CORPUS_DIR}`);
