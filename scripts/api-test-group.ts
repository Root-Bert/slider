// Prints the API test files of one CI group, so the API suite splits into groups of about equal
// length (.github/workflows/ci.yml):
//
//   bunx vitest run --project api $(bun scripts/api-test-group.ts 2 3)
//
// Vitest's own `--shard` splits by file, not by time, and once put most of the slow files into
// one shard. A test's cost is mostly its own in-memory database, so the files are weighed by
// their number of tests and handed out largest first, each to the lightest group so far.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const [group, groups] = process.argv.slice(2).map(Number);
if (!Number.isInteger(group) || !Number.isInteger(groups) || group < 1 || group > groups!) {
  console.error('usage: bun scripts/api-test-group.ts <group> <groups>');
  process.exit(1);
}

const dir = path.join(import.meta.dirname, '../apps/api/test');
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => {
    const source = readFileSync(path.join(dir, name), 'utf8');
    // Each file also pays once for its imports and first set-up: count it as a few tests.
    return { name, weight: (source.match(/^\s*it(\.each\(.*\))?\(/gm)?.length ?? 0) + 3 };
  })
  .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));

const buckets = Array.from({ length: groups! }, () => ({ weight: 0, files: [] as string[] }));
for (const file of files) {
  const lightest = buckets.reduce((min, bucket) => (bucket.weight < min.weight ? bucket : min));
  lightest.weight += file.weight;
  lightest.files.push(`apps/api/test/${file.name}`);
}
process.stdout.write(`${buckets[group! - 1]!.files.join(' ')}\n`);
