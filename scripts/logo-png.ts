/**
 * Renders every SVG in brand/logo/'s layout folders (scripts/logo-files.py writes them) to a PNG
 * next to it, with a transparent background: wide layouts 4000 px wide, the mark and the stacked
 * logo 2048 px wide. Run from the repository root:
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
  const width = /^(mark|stacked)\//.test(file) ? 2048 : 4000;
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
await browser.close();
