/**
 * How close the live editor draws a deck to LibreOffice: every visible slide once as LibreOffice
 * draws it, once as the editor shows it while typing – LibreOffice's picture of the slide with
 * its texts left out (`blankText`), the texts drawn on top by the browser – and the share of
 * pixels that differ. Writes both pictures and a diff per slide. Needs LibreOffice and Playwright's Chromium:
 *
 *   bun apps/web/scripts/live-parity.ts packages/odp/test/fixtures/demo.odp [out-dir]
 *
 * `--sample` instead of a deck draws a deck written with the editor's own operations (mixed
 * runs, alignments, wrapping, boxes with fill and border) on the slides of `demo.odp`.
 *
 * Exits non-zero when a slide differs by more than `LIVE_PARITY_MAX` (default 0.015 = 1.5 %).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from '@playwright/test';
import type { LiveTextStyle, SlideOperation } from '@slider/shared';
import { OdpDocument } from '../../../packages/odp/src/index';
import { officeFontFaces } from '../src/features/viewer/editing/live/fonts';
import { liveLayerStyle } from '../src/features/viewer/editing/live/css';
import { LiveElementView } from '../src/features/viewer/editing/live/render';
import { createLibreOfficePdf, findSoffice } from '../../api/src/import/libreoffice';
import { rasterizePdf } from '../../api/src/import/pdf-pages';
import { silentLogger } from '../../api/src/logger';

const deckFile = process.argv[2];
if (!deckFile) throw new Error('usage: bun live-parity.ts <deck.odp> [out-dir]');
const out = path.resolve(process.argv[3] ?? 'live-parity');
const maxDiff = Number(process.env.LIVE_PARITY_MAX ?? 0.015);
const root = path.resolve(import.meta.dir, '../../..');

const binary = await findSoffice({ configured: process.env.LIBREOFFICE_PATH || null });
if (!binary) throw new Error('soffice not found');
const toPdf = createLibreOfficePdf({ binary, log: silentLogger });

const source =
  deckFile === '--sample'
    ? await sampleDeck()
    : await OdpDocument.open(new Uint8Array(await readFile(deckFile)));
source.ensureIds();
const full = await source.toBytes();
const deck = await OdpDocument.open(full);
const slides = deck.slides();
const size = deck.pageSize();
// Every text the editor can draw left out (each is drawn over such a picture while typed in).
const background = await OdpDocument.open(full);
for (const slide of slides) {
  for (const element of slide.elements) if (element.live) background.blankText(element.id);
}

/** WebP pictures of the visible slides, in order. */
async function draw(bytes: Uint8Array): Promise<Uint8Array[]> {
  const pages: Uint8Array[] = [];
  await rasterizePdf(await toPdf(bytes), async (images) => {
    pages.push(images.image);
  });
  return pages;
}

const [pictures, backgrounds] = await Promise.all([draw(full), draw(await background.toBytes())]);
const visible = slides.filter((slide) => !slide.hidden);
await mkdir(out, { recursive: true });

// Served from a made-up origin: a page set from a string may not load `file:` fonts.
const ORIGIN = 'http://live-parity.local';
const fonts = officeFontFaces(`${ORIGIN}/fonts/office`);
const width = 2400;
const height = Math.round((width * size.height) / size.width);
const pageWidthPt = (size.width * 72) / 2.54;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
let html = '';
await page.route(`${ORIGIN}/**`, async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === '/')
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
  const file = path.join(root, 'apps/web/public', decodeURIComponent(url.pathname));
  return route.fulfill({ contentType: 'font/woff2', body: await readFile(file) });
});
let worst = 0;
const rows: string[] = [];
for (const [i, slide] of visible.entries()) {
  const live = slide.elements.filter((element) => element.live);
  const layer = renderToStaticMarkup(
    createElement(
      'div',
      { style: { position: 'absolute', inset: 0, ...liveLayerStyle(pageWidthPt) } },
      ...live.map((element) =>
        createElement(LiveElementView, {
          key: element.id,
          element,
          live: element.live!,
          textOnly: true,
        }),
      ),
    ),
  );
  const bg = Buffer.from(backgrounds[i]!).toString('base64');
  html = `<!doctype html><html><head><style>${fonts}
    html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;-webkit-font-smoothing:antialiased}
    #slide{position:relative;width:${width}px;height:${height}px}
    #slide>img{position:absolute;inset:0;width:100%;height:100%}</style></head>
    <body><div id="slide"><img src="data:image/webp;base64,${bg}">${layer}</div></body></html>`;
  await page.goto(`${ORIGIN}/`, { waitUntil: 'load' });
  if (process.env.LIVE_PARITY_DEBUG) {
    console.info(
      JSON.stringify(
        await page.evaluate(() =>
          [...document.querySelectorAll('[data-live-paragraph]')].slice(0, 3).map((p) => {
            const s = getComputedStyle(p);
            const r = p.getBoundingClientRect();
            return {
              top: r.top,
              h: r.height,
              lh: s.lineHeight,
              fs: s.fontSize,
              pt: s.paddingTop,
              ff: s.fontFamily,
              shift: s.top,
            };
          }),
        ),
      ),
    );
  }
  await page.evaluate(() => document.fonts.ready);
  const shot = await page.screenshot({ type: 'png' });
  const reference = Buffer.from(pictures[i]!).toString('base64');
  const result = await page.evaluate(
    async ({ shot, reference, width, height }) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });
      const pixels = async (src: string) => {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(await load(src), 0, 0, width, height);
        return ctx.getImageData(0, 0, width, height);
      };
      const a = await pixels(`data:image/png;base64,${shot}`);
      const b = await pixels(`data:image/webp;base64,${reference}`);
      const diff = new OffscreenCanvas(width, height);
      const ctx = diff.getContext('2d')!;
      const image = ctx.createImageData(width, height);
      let differing = 0;
      for (let p = 0; p < a.data.length; p += 4) {
        const delta = Math.max(
          Math.abs(a.data[p]! - b.data[p]!),
          Math.abs(a.data[p + 1]! - b.data[p + 1]!),
          Math.abs(a.data[p + 2]! - b.data[p + 2]!),
        );
        // Anti-aliasing differs a little everywhere; a pixel counts when it is clearly off.
        const off = delta > 64;
        if (off) differing += 1;
        image.data[p] = off ? 255 : b.data[p]! / 4 + 190;
        image.data[p + 1] = off ? 0 : b.data[p + 1]! / 4 + 190;
        image.data[p + 2] = off ? 0 : b.data[p + 2]! / 4 + 190;
        image.data[p + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      const blob = await diff.convertToBlob({ type: 'image/png' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return { share: differing / (width * height), diff: btoa(binary) };
    },
    { shot: shot.toString('base64'), reference, width, height },
  );
  const n = String(slide.index + 1).padStart(2, '0');
  await writeFile(path.join(out, `${n}-libreoffice.webp`), pictures[i]!);
  await writeFile(path.join(out, `${n}-live.png`), shot);
  await writeFile(path.join(out, `${n}-diff.png`), Buffer.from(result.diff, 'base64'));
  worst = Math.max(worst, result.share);
  rows.push(`${n} ${(result.share * 100).toFixed(3)} %  ${live.length} live  ${slide.title}`);
}
await browser.close();
console.info(rows.join('\n'));
console.info(`worst ${(worst * 100).toFixed(3)} % (max ${(maxDiff * 100).toFixed(1)} %) → ${out}`);
if (worst > maxDiff) process.exit(1);

/** A deck written with the live editor's operations, on an empty copy of a demo slide. */
async function sampleDeck(): Promise<OdpDocument> {
  const document = await OdpDocument.open(
    new Uint8Array(await readFile(path.join(root, 'packages/odp/test/fixtures/demo.odp'))),
  );
  document.ensureIds();
  // Slide 4 without its elements, three times.
  const empty = document.slides()[3]!;
  document.apply(
    empty.elements.map((element) => ({ type: 'deleteElement', elementId: element.id })),
  );
  const style = (over: Partial<LiveTextStyle> = {}): LiveTextStyle => ({
    font: 'Calibri',
    size: 20,
    color: '#1f2937',
    bold: false,
    italic: false,
    underline: false,
    ...over,
  });
  const run = (text: string, over: Partial<LiveTextStyle> = {}) => ({ ...style(over), text });
  const operations: SlideOperation[] = [
    {
      type: 'addElement',
      slideIndex: 3,
      elementId: 'slsample-mixed',
      kind: 'text',
      box: { x: 0.05, y: 0.06, w: 0.42, h: 0.1 },
      fill: null,
      stroke: null,
      paragraphs: [
        {
          align: 'left',
          runs: [
            run('Gemischte '),
            run('fette', { bold: true }),
            run(' und '),
            run('kursive', { italic: true, color: '#b91c1c' }),
            run(' Wörter, '),
            run('unterstrichen', { underline: true }),
            run(' und '),
            run('groß', { size: 32, color: '#1d4ed8' }),
            run(' in einem Absatz, der lang genug ist, um umzubrechen.'),
          ],
        },
        { align: 'center', runs: [run('Zentriert in Cambria', { font: 'Cambria' })] },
        { align: 'right', runs: [run('Rechtsbündig in Arial', { font: 'Arial' })] },
        {
          align: 'justify',
          runs: [
            run(
              'Blocksatz verteilt die Wörter über die ganze Breite der Zeile, nur die letzte Zeile bleibt links.',
              { font: 'Times New Roman' },
            ),
          ],
        },
      ],
    },
    {
      type: 'addElement',
      slideIndex: 3,
      elementId: 'slsample-box',
      kind: 'rect',
      box: { x: 0.55, y: 0.08, w: 0.38, h: 0.3 },
      fill: '#fde68a',
      stroke: { color: '#92400e', width: 3 },
      paragraphs: [
        { align: 'center', runs: [run('Box mit Füllung', { bold: true, size: 28 })] },
        { align: 'center', runs: [run('und Rahmen, mittig', { size: 18 })] },
      ],
    },
    {
      type: 'addElement',
      slideIndex: 3,
      elementId: 'slsample-thin',
      kind: 'rect',
      box: { x: 0.55, y: 0.5, w: 0.18, h: 0.2 },
      fill: '#dbeafe',
      stroke: { color: '#1e3a8a', width: 0.75 },
      paragraphs: [{ align: 'left', runs: [run('Klein', { size: 14, font: 'DejaVu Sans' })] }],
    },
    {
      type: 'addElement',
      slideIndex: 3,
      elementId: 'slsample-grow',
      kind: 'text',
      box: { x: 0.05, y: 0.7, w: 0.3, h: 0.05 },
      fill: '#e5e7eb',
      stroke: null,
      paragraphs: [
        { align: 'left', runs: [run('Diese Box wächst mit ihrem Text,', { size: 16 })] },
        {
          align: 'left',
          runs: [run('Zeile für Zeile.\nMit Umbruch.', { size: 16, font: 'Courier New' })],
        },
        { align: 'left', runs: [run('', { size: 16 })] },
        { align: 'left', runs: [run('Nach einer leeren Zeile.', { size: 16 })] },
      ],
    },
    {
      type: 'addElement',
      slideIndex: 3,
      elementId: 'slsample-ruled',
      kind: 'rect',
      box: { x: 0.77, y: 0.5, w: 0.16, h: 0.35 },
      fill: null,
      stroke: { color: '#059669', width: 6 },
      paragraphs: [{ align: 'left', runs: [run('Nur Rahmen, Text unten?', { size: 16 })] }],
    },
  ];
  document.apply(operations);
  document.apply([{ type: 'setShapeStyle', elementId: 'slsample-ruled', verticalAlign: 'bottom' }]);
  // The demo's own title, reformatted.
  const title = document.slides()[1]!.elements.find((element) => element.role === 'title')!;
  document.apply([
    {
      type: 'setRichText',
      elementId: title.id,
      paragraphs: [
        {
          align: 'center',
          runs: [
            run('Agenda ', { size: 44 }),
            run('neu', { size: 44, bold: true, color: '#c2410c' }),
          ],
        },
      ],
    },
  ]);
  return OdpDocument.open(await document.toBytes());
}
