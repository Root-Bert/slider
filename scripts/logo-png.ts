/**
 * Renders every SVG in brand/logo/'s layout folders (scripts/logo-files.py writes them) to a PNG
 * next to it, with a transparent background: wide layouts 4000 px wide, the mark and the stacked
 * logo 2048 px wide, the app icon 1024 – and the web app's icons from `apps/web/public/app-icon*.svg`:
 * the rounded one for the manifest's `any` (192, 512); the full-bleed one (the brand guide's
 * "Dock-Export", content 1.08× the app icon's) for `maskable` (192, 512 – Chrome on macOS masks it
 * to the Dock's shape, Android to its own) and for iOS (180, which rounds the corners itself).
 * Run from the repository root:
 *
 *   bun scripts/logo-png.ts
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const DIR = 'brand/logo';
const browser = await chromium.launch();
const page = await browser.newPage();
const files = (await readdir(DIR, { recursive: true })).filter((f) => f.endsWith('.svg')).sort();
for (const file of files) {
  const svg = await readFile(`${DIR}/${file}`, 'utf8');
  const [, w = '0', h = '0'] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg) ?? [];
  const width = file.startsWith('icon/') ? 1024 : /^(mark|stacked)\//.test(file) ? 2048 : 4000;
  const height = Math.round((width * Number(h)) / Number(w));
  await page.setViewportSize({ width, height });
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  await page.setContent(
    `<body style="margin:0;background:transparent"><img src="${src}" width="${width}" height="${height}" style="display:block"></body>`,
  );
  const png = file.replace(/\.svg$/, '.png');
  await writeFile(`${DIR}/${png}`, await page.screenshot({ type: 'png', omitBackground: true }));
  console.info(`wrote ${png} (${width} × ${height})`);
}

const PUBLIC = 'apps/web/public';
const rounded = await readFile(`${PUBLIC}/app-icon.svg`, 'utf8');
const fullBleed = await readFile(`${PUBLIC}/app-icon-maskable.svg`, 'utf8');
const icons: [string, string, number][] = [
  ['icon-192.png', rounded, 192],
  ['icon-512.png', rounded, 512],
  ['icon-maskable-192.png', fullBleed, 192],
  ['icon-maskable-512.png', fullBleed, 512],
  ['apple-touch-icon.png', fullBleed, 180],
];
for (const [name, svg, size] of icons) {
  await page.setViewportSize({ width: size, height: size });
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  await page.setContent(
    `<body style="margin:0;background:transparent"><img src="${src}" width="${size}" height="${size}" style="display:block"></body>`,
  );
  await writeFile(`${PUBLIC}/${name}`, await page.screenshot({ type: 'png', omitBackground: true }));
  console.info(`wrote ${PUBLIC}/${name} (${size} × ${size})`);
}
await browser.close();
