/**
 * Renders every SVG in brand/logo/'s layout folders (scripts/logo-files.py writes them) to a PNG
 * next to it, with a transparent background: wide layouts 4000 px wide, the mark and the stacked
 * logo 2048 px wide. The web app's icons come from the original 1024 px Icon Composer export
 * at `brand/logo/icon/slider-app-icon.png`: manifest `any` (192, 512) and Apple touch (180).
 * This export already has rounded corners; it must not be declared `maskable`.
 * Run from the repository root:
 *
 *   bun scripts/logo-png.ts
 *   bun scripts/logo-png.ts --app-only
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const DIR = 'brand/logo';
const browser = await chromium.launch();
const page = await browser.newPage();
const files = process.argv.includes('--app-only')
  ? []
  : (await readdir(DIR, { recursive: true })).filter((f) => f.endsWith('.svg')).sort();
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
const original = await readFile(`${DIR}/icon/slider-app-icon.png`);
const src = `data:image/png;base64,${original.toString('base64')}`;
const icons: [string, number][] = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
];
for (const [name, size] of icons) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;background:transparent"><img src="${src}" width="${size}" height="${size}" style="display:block"></body>`,
  );
  await page.locator('img').evaluate((img: HTMLImageElement) => img.decode());
  await writeFile(
    `${PUBLIC}/${name}`,
    await page.screenshot({ type: 'png', omitBackground: true }),
  );
  console.info(`wrote ${PUBLIC}/${name} (${size} × ${size})`);
}
await browser.close();
