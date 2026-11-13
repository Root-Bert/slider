/**
 * Renders every SVG in brand/logo/'s layout folders (scripts/logo-files.py writes them) to a PNG
 * next to it, with a transparent background: wide layouts 4000 px wide, the mark and the stacked
 * logo 2048 px wide. The web app's icons come from the original 1024 px Icon Composer export
 * at `brand/logo/icon/slider-app-icon.png`: manifest `any` (192, 512), Apple touch (180) and the
 * desktop app's icon (`desktop/icon.png`, 1024). This export already has rounded corners; it must
 * not be declared `maskable`. It fills its whole square, so the icons a Mac shows as they are
 * (the installed web app's, the desktop app's) get the margin of Apple's icon grid – the shape
 * 824 of 1024 px, centred – or they sit larger than every other icon in the Dock. The Apple touch
 * icon stays edge to edge: iOS draws its own shape around it.
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
/** Apple's macOS icon grid: the shape is 824 of the 1024 px canvas. */
const MAC_SHAPE = 824 / 1024;
const icons: [path: string, size: number, shape: number][] = [
  [`${PUBLIC}/icon-192.png`, 192, MAC_SHAPE],
  [`${PUBLIC}/icon-512.png`, 512, MAC_SHAPE],
  [`${PUBLIC}/apple-touch-icon.png`, 180, 1],
  ['desktop/icon.png', 1024, MAC_SHAPE],
];
for (const [path, size, shape] of icons) {
  const drawn = Math.round(size * shape);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;background:transparent;display:grid;place-items:center;height:${size}px"><img src="${src}" width="${drawn}" height="${drawn}" style="display:block"></body>`,
  );
  await page.locator('img').evaluate((img: HTMLImageElement) => img.decode());
  await writeFile(path, await page.screenshot({ type: 'png', omitBackground: true }));
  console.info(`wrote ${path} (${size} × ${size}, shape ${drawn} px)`);
}
await browser.close();
