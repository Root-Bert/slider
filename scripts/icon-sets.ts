// Builds the symbol sets Slider brings along (Bibliothek → Symbole, „Symbol einfügen“ in the
// editor) into apps/web/src/features/icons/sets/*.json – run again to update them:
//
//   bun scripts/icon-sets.ts
//
// The packages are fetched with `npm pack` into a temporary folder and read as data: none of
// their code runs (@carbon/pictograms would report to IBM on install). Each set is kept as
// `[name, label, keywords, body]` rows – `body` the SVG's inside, numbers to two places – plus
// its view box, name and licence (all of them free to use without credit).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PACKAGES = {
  phosphor: '@iconify-json/ph@1.2.2',
  phosphorTags: '@phosphor-icons/core@2.1.1',
  carbon: '@carbon/pictograms@12.88.0',
};
const OUT = path.join(import.meta.dirname, '../apps/web/src/features/icons/sets');

type Row = [name: string, label: string, keywords: string, body: string];
interface IconSet {
  id: string;
  name: string;
  /** „Icons“ (lines, small) or „Piktogramme“ (pictures that explain, larger). */
  kind: 'icons' | 'pictograms';
  license: string;
  url: string;
  viewBox: string;
  icons: Row[];
}

const work = mkdtempSync(path.join(tmpdir(), 'slider-icon-sets-'));
/** The package unpacked into its own folder; returns that folder's `package/`. */
function unpack(spec: string): string {
  const dir = mkdtempSync(path.join(work, 'pkg-'));
  const file = execFileSync('npm', ['pack', spec, '--silent', '--pack-destination', dir], {
    encoding: 'utf8',
  }).trim();
  execFileSync('tar', ['xzf', path.join(dir, file), '-C', dir]);
  return path.join(dir, 'package');
}

/** Whitespace, comments and long fractions out; anything that could run or load refused. */
function compact(body: string): string {
  const out = body
    .replace(/<\?xml[^>]*>|<!--[\s\S]*?-->|<title>[\s\S]*?<\/title>/g, '')
    // A number right after another („-1.5399.001“: the second point starts it) keeps a space
    // before it once rounded – „0“ there would run into the one before („-1.540“).
    .replace(/-?\d*\.\d{3,}/g, (n, at: number, all: string) => {
      const rounded = String(Number(Number(n).toFixed(2)));
      return /[\d.]/.test(all[at - 1] ?? '') && !rounded.startsWith('-') ? ` ${rounded}` : rounded;
    })
    .replace(/\s+/g, ' ')
    .replace(/> </g, '><')
    .trim();
  if (/<script|<style|<image|<foreignObject|\son\w+=|href=/i.test(out)) {
    throw new Error(`unsafe SVG: ${out.slice(0, 80)}`);
  }
  return out;
}

const words = (name: string) => name.replace(/-+/g, ' ').trim();
const label = (name: string) => {
  const text = words(name);
  return text.charAt(0).toUpperCase() + text.slice(1);
};

try {
  // Phosphor: the regular weight only; its tags from the core package, read as text.
  const ph = JSON.parse(readFileSync(path.join(unpack(PACKAGES.phosphor), 'icons.json'), 'utf8'));
  const core = readFileSync(path.join(unpack(PACKAGES.phosphorTags), 'dist/index.mjs'), 'utf8');
  const tags = new Map<string, string>();
  for (const entry of core.split(/\{\s*name: "/).slice(1)) {
    const name = entry.slice(0, entry.indexOf('"'));
    const list = /tags: \[([^\]]*)\]/.exec(entry)?.[1] ?? '';
    const quoted = [...list.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    tags.set(name, quoted.filter((tag) => !tag.includes('*')).join(' '));
  }
  const phosphor: IconSet = {
    id: 'phosphor',
    name: 'Phosphor',
    kind: 'icons',
    license: 'MIT',
    url: 'https://phosphoricons.com',
    viewBox: `0 0 ${ph.width} ${ph.height}`,
    icons: Object.entries(ph.icons as Record<string, { body: string }>)
      .filter(([name]) => !/-(?:bold|fill|thin|light|duotone)$/.test(name))
      .map(([name, icon]): Row => [
        name,
        label(name),
        `${words(name)} ${tags.get(name) ?? ''}`.trim(),
        compact(icon.body),
      ]),
  };

  // IBM Carbon's pictograms: their friendly names and aliases, the SVG files' insides.
  const carbonDir = unpack(PACKAGES.carbon);
  const meta = JSON.parse(readFileSync(path.join(carbonDir, 'metadata.json'), 'utf8')) as {
    icons: { name: string; friendlyName?: string; aliases?: string[] }[];
  };
  const byFile = new Map(meta.icons.map((icon) => [icon.name, icon]));
  const carbon: IconSet = {
    id: 'carbon-pictograms',
    name: 'IBM Carbon Piktogramme',
    kind: 'pictograms',
    license: 'Apache-2.0',
    url: 'https://carbondesignsystem.com/elements/pictograms/library/',
    viewBox: '0 0 32 32',
    icons: readdirSync(path.join(carbonDir, 'svg'))
      .filter((file) => file.endsWith('.svg'))
      .toSorted()
      .map((file): Row => {
        const name = file.replace(/\.svg$/, '');
        const svg = readFileSync(path.join(carbonDir, 'svg', file), 'utf8');
        const inner = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(svg)?.[1] ?? '';
        const info = byFile.get(name);
        return [
          name,
          info?.friendlyName ?? label(name),
          [words(name), ...(info?.aliases ?? [])].join(' '),
          compact(inner),
        ];
      }),
  };

  for (const set of [phosphor, carbon]) {
    const file = path.join(OUT, `${set.id}.json`);
    writeFileSync(file, `${JSON.stringify(set)}\n`);
    console.info(
      `${set.id}: ${set.icons.length} icons, ${(readFileSync(file).length / 1e6).toFixed(1)} MB`,
    );
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
