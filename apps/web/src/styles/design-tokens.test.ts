import { describe, expect, it } from 'vitest';
import { ALLOW_PENDING_MIGRATION, PERMANENT } from './raw-color-allowlist';
import { findRawColors, stripComments } from './raw-colors';
import { readIndexCss, themeTokens } from './theme-css';

const css = await readIndexCss();

/** Every component source (tests excluded), keyed by its path below `src/`. */
const sources = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ).map(([path, source]) => [path.replace(/^\.\.\//, ''), source]),
);

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
  const pending = new Set<string>(ALLOW_PENDING_MIGRATION);
  const permits = (path: string, match: string) =>
    PERMANENT.some(
      (entry) =>
        (entry.path.endsWith('/') ? path.startsWith(entry.path) : path === entry.path) &&
        (entry.allow === 'all' || entry.allow.some((pattern) => pattern.test(match))),
    );

  it('scans the component sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    // Real file contents, not empty modules: the brand marks are known to carry raw colours.
    expect(findRawColors(sources['ui/brand/GoogleMark.tsx'] ?? '').length).toBeGreaterThan(0);
  });

  it('are only where the allowlist says (styles/raw-color-allowlist.ts)', () => {
    const offending: string[] = [];
    for (const [path, source] of Object.entries(sources)) {
      if (pending.has(path)) continue;
      for (const { line, match } of findRawColors(source)) {
        if (!permits(path, match)) offending.push(`${path}:${line} ${match}`);
      }
    }
    // Use a token class or utility instead (docs/design-system.md §2–3).
    expect(offending).toEqual([]);
  });

  it('allowlist entries carry a reason', () => {
    for (const entry of PERMANENT) expect(entry.reason.length).toBeGreaterThan(10);
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
