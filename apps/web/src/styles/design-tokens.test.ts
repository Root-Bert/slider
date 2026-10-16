import { describe, expect, it } from 'vitest';
import { LITERAL_EXCEPTIONS, PERMANENT, type RawValueException } from './raw-color-allowlist';
import { findRawColors, findRawLiterals, stripComments, type RawColor } from './raw-colors';
import { readIndexCss, themeTokens } from './theme-css';

const css = await readIndexCss();

/**
 * Every component and class-building source (tests and type declarations excluded), keyed by its
 * path below `src/`. `styles/` is left out: the scanner and the allowlist spell the patterns.
 */
const sources = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(['../**/*.tsx', '../**/*.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  )
    // Files next to this test come back as `./…`.
    .map(
      ([path, source]) =>
        [path.replace(/^\.\.\//, '').replace(/^\.\//, 'styles/'), source] as const,
    )
    .filter(([path]) => !/\.test\.tsx?$|\.d\.ts$/.test(path) && !path.startsWith('styles/')),
);

const covers = (entry: RawValueException, path: string) =>
  entry.path.endsWith('/') ? path.startsWith(entry.path) : path === entry.path;
const permitted = (entries: readonly RawValueException[], path: string, match: string) =>
  entries.some(
    (entry) =>
      covers(entry, path) &&
      (entry.allow === 'all' || entry.allow.some((pattern) => pattern.test(match))),
  );

/** `path:line match` for every hit no entry permits. */
function offenders(
  find: (source: string) => RawColor[],
  entries: readonly RawValueException[],
): string[] {
  const out: string[] = [];
  for (const [path, source] of Object.entries(sources)) {
    for (const { line, match } of find(source)) {
      if (!permitted(entries, path, match)) out.push(`${path}:${line} ${match}`);
    }
  }
  return out;
}

/** Entries (or single allowed patterns) that no longer match anything – remove them. */
function staleEntries(
  find: (source: string) => RawColor[],
  entries: readonly RawValueException[],
): string[] {
  const stale: string[] = [];
  for (const entry of entries) {
    const hits = Object.entries(sources)
      .filter(([path]) => covers(entry, path))
      .flatMap(([, source]) => find(source).map((hit) => hit.match));
    const patterns = entry.allow === 'all' ? [/./] : entry.allow;
    for (const pattern of patterns) {
      if (!hits.some((match) => pattern.test(match))) stale.push(`${entry.path} ${pattern}`);
    }
  }
  return stale;
}

describe('@theme', () => {
  // A misspelt namespace (`--colour-…`, `--font-size-…`) silently produces no utility, so the full
  // list of names is pinned here. Update the snapshot when a token is added on purpose.
  it('declares exactly these tokens', () => {
    expect([...themeTokens(css).keys()]).toMatchSnapshot();
  });

  it('only uses namespaces Tailwind turns into utilities', () => {
    const namespaces = new Set(
      [...themeTokens(css).keys()].map((name) => /^--([a-z]+)/.exec(name)![1]),
    );
    expect([...namespaces].sort()).toEqual(
      ['animate', 'color', 'ease', 'font', 'radius', 'shadow', 'text'].sort(),
    );
  });
});

describe('raw colours in components', () => {
  it('scans the component sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    // Real file contents, not empty modules: the brand marks are known to carry raw colours.
    expect(findRawColors(sources['ui/brand/GoogleMark.tsx'] ?? '').length).toBeGreaterThan(0);
    // Class-building .ts modules are scanned too.
    expect(sources['features/viewer/stage/lib/mark-chrome.ts']).toBeDefined();
  });

  it('are only where the allowlist says (styles/raw-color-allowlist.ts)', () => {
    // Use a token class or utility instead (docs/design-system.md §2–3).
    expect(offenders(findRawColors, PERMANENT)).toEqual([]);
  });

  it('allowlist entries are still needed', () => {
    expect(staleEntries(findRawColors, PERMANENT)).toEqual([]);
  });

  it('allowlist entries carry a reason', () => {
    for (const entry of PERMANENT) expect(entry.reason.length).toBeGreaterThan(10);
  });
});

describe('literal type sizes, radii, z-indices and easings in components', () => {
  it('are only where the allowlist says (LITERAL_EXCEPTIONS)', () => {
    // text-body/caption/tiny/micro, rounded-<token>, z-(--z-…), ease-<token> (§3, §5–7).
    expect(offenders(findRawLiterals, LITERAL_EXCEPTIONS)).toEqual([]);
  });

  it('allowlist entries are still needed and carry a reason', () => {
    expect(staleEntries(findRawLiterals, LITERAL_EXCEPTIONS)).toEqual([]);
    for (const entry of LITERAL_EXCEPTIONS) expect(entry.reason.length).toBeGreaterThan(10);
  });

  it('finds px type sizes, arbitrary radii, numeric z-indices and bezier curves', () => {
    const found = findRawLiterals(
      [
        `<p className="text-[13px] leading-[18px] rounded-[4px] rounded-tl-[0.25em]" />`,
        `<i className="z-10 hover:z-[60] -z-1 ease-[cubic-bezier(0.2,0.9,0.3,1)]" />`,
      ].join('\n'),
    ).map(({ line, match }) => `${line}:${match}`);
    expect(found.sort()).toEqual(
      [
        '1:text-[13px]',
        '1:rounded-[4px]',
        '1:rounded-tl-[0.25em]',
        '2:z-10',
        '2:z-[60]',
        '2:-z-1',
        '2:cubic-bezier(',
      ].sort(),
    );
  });

  it('ignores tokens and look-alikes', () => {
    const source = [
      `<p className="text-body text-caption rounded-thumb rounded-[inherit] z-(--z-raised) ease-settle" />`,
      `<i className="size-10 translate-z-0 text-[length:var(--x)] blur-xs" />`,
      '// z-10 and cubic-bezier(0,0,1,1) in a comment',
    ].join('\n');
    expect(findRawLiterals(source)).toEqual([]);
  });
});

describe('raw colour scanner', () => {
  it('finds class, literal and arbitrary-value colours', () => {
    const found = findRawColors(
      [
        `<div className="bg-white/10 hover:bg-black/[0.6] text-white" />`,
        `<i className="bg-[#141414] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.35)]" />`,
        `const a = '#fff'; const b = "rgba(0, 0, 0, 0.5)"; const c = { fill: 'black' };`,
      ].join('\n'),
    ).map(({ line, match }) => `${line}:${match}`);
    expect(found.sort()).toEqual(
      [
        '1:white/10',
        '1:black/[0.6]',
        '1:text-white',
        '2:[#141414]',
        '2:#141414',
        '2:rgb(',
        '3:#fff',
        '3:rgba(',
        "3:'black'",
      ].sort(),
    );
  });

  it('ignores comments, tokens and look-alikes', () => {
    const source = [
      '// bg-white/10 in a line comment',
      '/* rgb(0 0 0) and #141414 in a block comment */',
      '<div>{/* text-white in a JSX comment */}</div>',
      `<a href="https://example.com/#abc" className="bg-hover text-fg-muted ring-hairline" />`,
      `const url = \`https://x.test/\${id}\`; // trailing #fff comment`,
      `<p className="text-on-primary bg-canvas whitespace-nowrap">Bitte #12 prüfen</p>`,
    ].join('\n');
    expect(findRawColors(source)).toEqual([]);
  });

  it('keeps line numbers across stripped comments', () => {
    const source = '/* a\n b */\n<i className="bg-white/5" />';
    expect(stripComments(source).split('\n')).toHaveLength(3);
    expect(findRawColors(source)).toEqual([{ line: 3, match: 'white/5' }]);
  });
});
