/**
 * How close the live editor draws a deck to LibreOffice: every visible slide once as LibreOffice
 * draws it, once as the editor shows it while typing – LibreOffice's picture of the slide with
 * its texts left out (`blankText`), the texts drawn on top by the browser – and the share of
 * pixels that differ. Writes both pictures and a diff per slide. Needs LibreOffice and Playwright's Chromium:
 *
 *   bun apps/web/scripts/live-parity.ts packages/odp/test/fixtures/demo.odp [out-dir]
 *
 * `--sample` instead of a deck draws a deck written with the editor's own operations (mixed
 * runs, alignments, wrapping, boxes with fill and border, see-through letters, a text's shadow)
 * on the slides of `demo.odp`.
 *
 * Exits non-zero when a slide differs by more than `LIVE_PARITY_MAX` (default 0.015 = 1.5 %).
 *
 * `--compose` also measures each element on its own (its box and a margin for its outline), by
 * kind – the guard of the per-element editor (docs/do-not-break.md): an element whose share of differing
 * pixels passes `LIVE_PARITY_ELEMENT_MAX` (default 0.02) fails the run (`gated`) – a browser-drawn
 * element, and any holding text (its lines sit where LibreOffice's do: `layoutSize`, `lineBox`,
 * `baselineShift` in `live/css.ts`). Listed apart and gated by their slide (`slide`): elements
 * LibreOffice draws without text, and turned text – LibreOffice's turned letters lie about a
 * pixel off their own baseline (the PDF's text origin is where the editor's is). Both worsts are
 * printed. For now the candidate is
 * what the editor draws today (the slide without its texts, the texts by the browser); the
 * browser-drawn elements plug in at `composedAs`.
 *
 *   bun apps/web/scripts/live-parity.ts --sample --compose [out-dir]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from '@playwright/test';
import { coverCrop, type LiveTextStyle, type NewShape, type SlideOperation } from '@slider/shared';
import { OdpDocument, placedBox, type OdpSlide } from '../../../packages/odp/src/index';
import { officeFontFaces } from '../src/features/viewer/editing/live/fonts';
import { liveLayerStyle } from '../src/features/viewer/editing/live/css';
import { LiveElementView } from '../src/features/viewer/editing/live/render';
import { ElementView } from '../src/features/viewer/editing/compose/ElementView';
import { SlideGround } from '../src/features/viewer/editing/compose/SlideGround';
import { FillOverlay } from '../src/features/viewer/editing/fills/FillOverlay';
import { drawsFillsAtOnce } from '../src/features/viewer/editing/picture-fit';
import { rememberPictureAspect } from '../src/features/viewer/editing/fills/picture-aspect';
import { holdsText } from '../src/features/viewer/editing/compose/text';
import { drawLayerPages } from '../../api/src/import/pdf-render';
import { createLibreOfficePdf, findSoffice } from '../../api/src/import/libreoffice';
import { rasterizePdf } from '../../api/src/import/pdf-pages';
import { silentLogger } from '../../api/src/logger';
// The API's canvas (Skia): the script runs beside it, not in the browser.
import { createCanvas, loadImage } from '../../api/node_modules/@napi-rs/canvas';

const args = process.argv.slice(2);
const compose = args.includes('--compose');
const [deckFile, outArg] = args.filter((arg) => arg !== '--compose');
if (!deckFile)
  throw new Error('usage: bun live-parity.ts <deck.odp>|--sample [--compose] [out-dir]');
const out = path.resolve(outArg ?? 'live-parity');
const maxDiff = Number(process.env.LIVE_PARITY_MAX ?? 0.015);
const maxElementDiff = Number(process.env.LIVE_PARITY_ELEMENT_MAX ?? 0.02);
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
/** The gated worst (browser-drawn, no text) and, apart, the worst of everything else measured. */
let worstElement = { share: 0, what: '' };
let worstUngated = { share: 0, what: '' };
const rows: string[] = [];
const elementRows: string[] = [];
for (const [i, slide] of visible.entries()) {
  const live = slide.elements.filter((element) => element.live);
  const layer = compose
    ? await composedSlide(slide)
    : renderToStaticMarkup(
        createElement(
          'div',
          {
            style: {
              position: 'absolute',
              inset: 0,
              ...liveLayerStyle(pageWidthPt, (size.height * 72) / 2.54),
            },
          },
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
  const bg = compose ? '' : Buffer.from(backgrounds[i]!).toString('base64');
  html = `<!doctype html><html><head><style>${fonts}
    html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;-webkit-font-smoothing:antialiased}
    #slide{position:relative;width:${width}px;height:${height}px}
    #slide>img{position:absolute;inset:0;width:100%;height:100%}</style></head>
    <body><div id="slide">${compose ? '' : `<img src="data:image/webp;base64,${bg}">`}${layer}</div></body></html>`;
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
  // Each element's box on the picture, a margin around it for its outline (`--compose`).
  const margin = Math.round(width * 0.006);
  const boxes = compose
    ? partsOf(slide.elements)
        .filter(measurable)
        .map((element) => ({
          x: Math.max(0, Math.floor(element.bbox.x * width) - margin),
          y: Math.max(0, Math.floor(element.bbox.y * height) - margin),
          right: Math.min(width, Math.ceil((element.bbox.x + element.bbox.w) * width) + margin),
          bottom: Math.min(height, Math.ceil((element.bbox.y + element.bbox.h) * height) + margin),
        }))
    : [];
  const result = await page.evaluate(
    async ({ shot, reference, width, height, boxes }) => {
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
      const off = new Uint8Array(width * height);
      for (let p = 0; p < a.data.length; p += 4) {
        const delta = Math.max(
          Math.abs(a.data[p]! - b.data[p]!),
          Math.abs(a.data[p + 1]! - b.data[p + 1]!),
          Math.abs(a.data[p + 2]! - b.data[p + 2]!),
        );
        // Anti-aliasing differs a little everywhere; a pixel counts when it is clearly off.
        const wrong = delta > 64;
        if (wrong) {
          differing += 1;
          off[p / 4] = 1;
        }
        image.data[p] = wrong ? 255 : b.data[p]! / 4 + 190;
        image.data[p + 1] = wrong ? 0 : b.data[p + 1]! / 4 + 190;
        image.data[p + 2] = wrong ? 0 : b.data[p + 2]! / 4 + 190;
        image.data[p + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      const blob = await diff.convertToBlob({ type: 'image/png' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const shares = boxes.map((box) => {
        let count = 0;
        for (let y = box.y; y < box.bottom; y++) {
          for (let x = box.x; x < box.right; x++) count += off[y * width + x]!;
        }
        const area = (box.right - box.x) * (box.bottom - box.y);
        return area > 0 ? count / area : 0;
      });
      return { share: differing / (width * height), diff: btoa(binary), shares };
    },
    { shot: shot.toString('base64'), reference, width, height, boxes },
  );
  const n = String(slide.index + 1).padStart(2, '0');
  await writeFile(path.join(out, `${n}-libreoffice.webp`), pictures[i]!);
  await writeFile(path.join(out, `${n}-live.png`), shot);
  await writeFile(path.join(out, `${n}-diff.png`), Buffer.from(result.diff, 'base64'));
  worst = Math.max(worst, result.share);
  rows.push(`${n} ${(result.share * 100).toFixed(3)} %  ${live.length} live  ${slide.title}`);
  if (compose) {
    const measured = partsOf(slide.elements).filter(measurable);
    for (const [j, element] of measured.entries()) {
      const share = result.shares[j] ?? 0;
      // Gated: what the browser draws whole, and every upright text (drawn by the browser over
      // LibreOffice's picture of the rest). Turned text is measured per slide only (see above).
      const text = Boolean(element.live && holdsText(element.live));
      const gated = text ? !element.rotation : composedAs(element) === 'browser';
      const what = `${element.name} (${n}, ${composedAs(element)}${text ? ', text' : ''})`;
      if (gated && share > worstElement.share) worstElement = { share, what };
      if (!gated && share > worstUngated.share) worstUngated = { share, what };
      elementRows.push(
        `${n} ${(share * 100).toFixed(3).padStart(7)} %  ${(gated ? 'gated' : 'slide').padEnd(6)} ${composedAs(element).padEnd(10)} ${kindOf(element).padEnd(28)} ${element.name}`,
      );
    }
  }
}
await browser.close();
console.info(rows.join('\n'));
console.info(`worst ${(worst * 100).toFixed(3)} % (max ${(maxDiff * 100).toFixed(1)} %) → ${out}`);
if (compose) {
  console.info(
    `\nper element (gated: browser-drawn or upright text, max ${(maxElementDiff * 100).toFixed(1)} % | slide: LibreOffice's without text or turned text, gated by its slide; drawn by: libreoffice | text | browser):\n${elementRows.join('\n')}`,
  );
  console.info(
    `worst gated element ${(worstElement.share * 100).toFixed(3)} % (max ${(maxElementDiff * 100).toFixed(1)} %) ${worstElement.what}`,
  );
  console.info(
    `worst other element ${(worstUngated.share * 100).toFixed(3)} % (not gated per element: its slide's ${(maxDiff * 100).toFixed(1)} % is) ${worstUngated.what}`,
  );
}
if (worst > maxDiff || (compose && worstElement.share > maxElementDiff)) process.exit(1);

/** Whether an element is measured on its own: one with a box – a line's may be flat one way. */
function measurable(element: OdpSlide['elements'][number]): boolean {
  const { w, h } = element.bbox;
  return element.kind === 'line' ? w > 0 || h > 0 : w > 0 && h > 0;
}

/** A slide's elements as the composed editor draws them: a group by its parts (`SlideCompositor`). */
function partsOf(elements: OdpSlide['elements']): OdpSlide['elements'] {
  return elements.flatMap((element) => (element.children ? partsOf(element.children) : [element]));
}

/**
 * Who draws an element in the composed editor: `browser` whole (`paint`), `text` its text over
 * LibreOffice's picture of the rest, else `libreoffice`.
 */
function composedAs(element: OdpSlide['elements'][number]): 'browser' | 'text' | 'libreoffice' {
  if (!compose) return element.live ? 'text' : 'libreoffice';
  return element.paint ? 'browser' : element.live ? 'text' : 'libreoffice';
}

/**
 * A slide as the per-element editor shows it (`SlideCompositor`): LibreOffice's slide without
 * its elements, then each element bottom first – drawn by the browser (`ElementView`) or as
 * LibreOffice's picture of it alone (`toLayerBytes` composed) with its live text over it.
 */
async function composedSlide(slide: OdpSlide): Promise<string> {
  const document = await OdpDocument.open(full);
  const drawing = await document.toLayerBytes(slide.index, () => null, { compose: true });
  // The master's background alone (the page after the slide's) drawn on its own, as the server
  // does: the slide's page, the master's shapes and the elements in one go.
  const [slidePage = 1, groundPage, ...rest] = drawing.pages;
  const main = drawing.masterGround === null ? drawing.pages : [slidePage, ...rest];
  const pdf = await toPdf.pages!(drawing.bytes, main, { prepared: true });
  const drawn = await drawLayerPages(pdf, true, width);
  const groundDrawn =
    drawing.masterGround === null || groundPage === undefined
      ? null
      : await drawLayerPages(
          await toPdf.pages!(drawing.bytes, [groundPage], { prepared: true }),
          true,
          width,
        );
  const css = (box: { x: number; y: number; w: number; h: number }) =>
    `position:absolute;left:${box.x * 100}%;top:${box.y * 100}%;width:${box.w * 100}%;height:${box.h * 100}%`;
  const combined = Buffer.from(drawn.background!).toString('base64');
  // Its own background drawn by the browser (`SlideGround`) – else the master's as LibreOffice
  // drew it alone –, the master's shapes over it as LibreOffice drew them alone (the first layer).
  const master = drawing.masterShapes === null ? null : drawn.layers[0];
  const own = slide.ownBackground ? slide.backgroundFills : [];
  const ownGround = own.some((layer) => layer.visible);
  // Its pictures as data addresses, their proportions known (read in the browser from them).
  const groundPictures = new Map<string, string>();
  for (const layer of own) {
    if (layer.type !== 'image' || groundPictures.has(layer.src)) continue;
    const bytes = await deck.picture(layer.src);
    if (!bytes) continue;
    const url = `data:${/\.png$/i.test(layer.src) ? 'image/png' : 'image/jpeg'};base64,${Buffer.from(bytes).toString('base64')}`;
    const image = await loadImage(Buffer.from(bytes));
    rememberPictureAspect(url, image.width / Math.max(1, image.height));
    groundPictures.set(layer.src, url);
  }
  const masterGround = !ownGround ? groundDrawn?.background : null;
  const drawsGround = !!drawing.masterShapes && (ownGround || !!masterGround);
  const ground = drawsGround
    ? (masterGround
        ? `<img style="position:absolute;inset:0;width:100%;height:100%" src="data:image/jpeg;base64,${Buffer.from(masterGround).toString('base64')}">`
        : withCanvas(() =>
            renderToStaticMarkup(
              createElement(SlideGround, {
                fills: own,
                aspect: size.width / size.height,
                pictureUrl: (src) => groundPictures.get(src) ?? '',
              }),
            ),
          )) +
      (master?.image && master.box
        ? `<img style="${css(master.box)}" src="data:image/png;base64,${Buffer.from(master.image).toString('base64')}">`
        : '')
    : `<img style="position:absolute;inset:0;width:100%;height:100%" src="data:image/jpeg;base64,${combined}">`;
  // The pictures the browser draws, as data addresses.
  const pictures = new Map<string, string>();
  for (const element of partsOf(slide.elements)) {
    const path = element.paint?.outline === 'picture' ? element.picture?.src : null;
    if (!path || pictures.has(path)) continue;
    // From the whole file: the drawing copy keeps only what LibreOffice draws.
    const bytes = await deck.picture(path);
    const type = /\.png$/i.test(path)
      ? 'image/png'
      : /\.webp$/i.test(path)
        ? 'image/webp'
        : /\.gif$/i.test(path)
          ? 'image/gif'
          : 'image/jpeg';
    if (bytes) pictures.set(path, `data:${type};base64,${Buffer.from(bytes).toString('base64')}`);
  }
  // The pictures of shapes' fills, as data addresses, their proportions known.
  const fillPictures = new Map<string, string>();
  for (const element of partsOf(slide.elements)) {
    for (const layer of element.look?.fills ?? []) {
      if (layer.type !== 'image' || fillPictures.has(layer.src)) continue;
      const bytes = await deck.picture(layer.src);
      if (!bytes) continue;
      const url = `data:${/\.png$/i.test(layer.src) ? 'image/png' : 'image/jpeg'};base64,${Buffer.from(bytes).toString('base64')}`;
      const image = await loadImage(Buffer.from(bytes));
      rememberPictureAspect(url, image.width / Math.max(1, image.height));
      fillPictures.set(layer.src, url);
    }
  }
  let next = drawing.masterShapes === null ? 0 : 1;
  const parts = partsOf(slide.elements).map((element, at) => {
    if (drawing.layers[at] === null && element.paint) {
      const src = element.picture?.src ? pictures.get(element.picture.src) : undefined;
      return withCanvas(() =>
        renderToStaticMarkup(
          createElement(ElementView, {
            element,
            live: element.live,
            paint: element.paint!,
            src,
            pageAspect: size.width / size.height,
            pageWidthPt,
          }),
        ),
      );
    }
    const picture = drawing.layers[at] === null ? null : drawn.layers[next++];
    const image =
      picture?.image && picture.box
        ? `<img style="${css(placedBox(picture.box, drawing.placements[at]!))}" src="data:image/png;base64,${Buffer.from(picture.image).toString('base64')}">`
        : '';
    // A picture fill as the browser draws it at once over LibreOffice's picture (`FillsDrawn`):
    // over it, it must change nothing.
    const fills = element.look?.fills ?? [];
    const aspect = (element.bbox.w * size.width) / Math.max(1e-6, element.bbox.h * size.height);
    const fresh =
      !element.look?.fillAspect || Math.abs(element.look.fillAspect / aspect - 1) < 0.01;
    const overlay =
      picture && fresh && drawsFillsAtOnce(fills)
        ? renderToStaticMarkup(
            createElement(FillOverlay, {
              element,
              fills,
              page: size,
              pictureUrl: (src) => fillPictures.get(src) ?? '',
            }),
          )
        : '';
    const text = element.live
      ? renderToStaticMarkup(
          createElement(LiveElementView, { element, live: element.live, textOnly: true }),
        )
      : '';
    return image + overlay + text;
  });
  return renderToStaticMarkup(
    createElement('div', {
      style: {
        position: 'absolute',
        inset: 0,
        ...liveLayerStyle(pageWidthPt, (size.height * 72) / 2.54),
      },
      dangerouslySetInnerHTML: {
        __html: `${ground}${parts.join('')}`,
      },
    }),
  );
}

/** An element's kind for the report: its type, outline and how it is filled and outlined. */
function kindOf(element: OdpSlide['elements'][number]): string {
  const look = element.look;
  const stroke = look?.stroke ? `${look.stroke.width}pt ${look.stroke.dash ?? 'solid'}` : 'no line';
  const fill = look?.fills?.[0]?.type ?? (look?.fill ? 'solid' : 'none');
  const turned = element.rotation ? ` ${Math.round(element.rotation)}°` : '';
  const flipped = element.flip?.x || element.flip?.y ? ' flipped' : '';
  return `${element.outline?.type ?? element.kind} ${fill}/${stroke}${turned}${flipped}`;
}

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
      pageId: empty.pageId!,
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
      pageId: empty.pageId!,
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
      pageId: empty.pageId!,
      elementId: 'slsample-thin',
      kind: 'rect',
      box: { x: 0.55, y: 0.5, w: 0.18, h: 0.2 },
      fill: '#dbeafe',
      stroke: { color: '#1e3a8a', width: 0.75 },
      paragraphs: [{ align: 'left', runs: [run('Klein', { size: 14, font: 'DejaVu Sans' })] }],
    },
    {
      type: 'addElement',
      pageId: empty.pageId!,
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
      pageId: empty.pageId!,
      elementId: 'slsample-ruled',
      kind: 'rect',
      box: { x: 0.77, y: 0.5, w: 0.16, h: 0.35 },
      fill: null,
      stroke: { color: '#059669', width: 6 },
      paragraphs: [{ align: 'left', runs: [run('Nur Rahmen, Text unten?', { size: 16 })] }],
    },
    {
      type: 'addElement',
      pageId: empty.pageId!,
      elementId: 'slsample-shadow',
      kind: 'text',
      box: { x: 0.05, y: 0.56, w: 0.45, h: 0.08 },
      fill: null,
      stroke: null,
      paragraphs: [
        {
          align: 'left',
          runs: [
            run('Schatten, ', { size: 28, bold: true, color: '#0d9488' }),
            run('halb durchsichtig', { size: 28, bold: true, color: '#0d9488', opacity: 0.4 }),
          ],
        },
      ],
    },
    {
      type: 'addElement',
      pageId: empty.pageId!,
      elementId: 'slsample-corner',
      kind: 'text',
      box: { x: 0.38, y: 0.68, w: 0.14, h: 0.26 },
      fill: null,
      stroke: null,
      paragraphs: [{ align: 'right', runs: [run('Unten rechts im Textfeld', { size: 16 })] }],
    },
  ];
  // A slide of drawn shapes: their text wraps in their text area (a hexagon's middle), not
  // their box – a word too long for it breaks as in LibreOffice.
  document.apply([
    {
      type: 'duplicateSlide',
      pageId: empty.pageId!,
      newPageId: 'slsample-shapes',
      after: empty.pageId!,
    },
  ]);
  const shapes: NewShape[] = [
    'hexagon',
    'ellipse',
    'diamond',
    'isosceles-triangle',
    'round-rectangle',
    'right-arrow',
    'star5',
  ];
  document.apply(
    shapes.map((shape, i) => ({
      type: 'addElement',
      pageId: 'slsample-shapes',
      elementId: `slsample-${shape}`,
      kind: 'rect',
      shape,
      box: { x: 0.04 + (i % 4) * 0.24, y: i < 4 ? 0.08 : 0.52, w: 0.2, h: 0.36 },
      fill: '#dbeafe',
      stroke: { color: '#1e3a8a', width: 1.5 },
      paragraphs: [
        { align: 'center', runs: [run('asdasdlalsdl', { size: 28 })] },
        { align: 'center', runs: [run('und ein Satz, der umbricht', { size: 16 })] },
      ],
    })),
  );
  document.apply([
    {
      type: 'setBox',
      elementId: 'slsample-right-arrow',
      box: { x: 0.28, y: 0.52, w: 0.2, h: 0.36 },
      flip: { x: true, y: false },
    },
  ]);
  // A matrix of drawn shapes without text (the per-element renderer's cases): every preset a new
  // box takes, in rows of lines (none, hairline, thick, dashed, dotted), some turned, mirrored and
  // rounded.
  document.apply([
    {
      type: 'duplicateSlide',
      pageId: empty.pageId!,
      newPageId: 'slsample-matrix',
      after: 'slsample-shapes',
    },
  ]);
  const presets: NewShape[] = [
    'rectangle',
    'ellipse',
    'isosceles-triangle',
    'diamond',
    'hexagon',
    'right-arrow',
    'star5',
  ];
  const lines = [
    null,
    { color: '#1e3a8a', width: 0.75 },
    { color: '#1e3a8a', width: 6 },
    { color: '#b91c1c', width: 3, dash: 'dash' as const },
    { color: '#047857', width: 3, dash: 'dot' as const },
  ];
  const matrix: SlideOperation[] = [];
  for (const [row, stroke] of lines.entries()) {
    for (const [column, shape] of presets.entries()) {
      matrix.push({
        type: 'addElement',
        pageId: 'slsample-matrix',
        elementId: `slmatrix-${row}-${column}`,
        kind: 'rect',
        shape,
        box: { x: 0.03 + column * 0.137, y: 0.04 + row * 0.19, w: 0.1, h: 0.14 },
        fill: row === 2 ? null : ['#dbeafe', '#fde68a', '#fecaca', '#bbf7d0', '#e9d5ff'][row]!,
        stroke,
        paragraphs: [],
      });
    }
  }
  document.apply(matrix);
  // `addElement` writes a line solid whatever its dash (as the editor's new boxes are): the dashed
  // and dotted rows get theirs as the panel sets it.
  document.apply(
    matrix.flatMap((operation) =>
      operation.type === 'addElement' && operation.stroke?.dash
        ? [
            {
              type: 'setShapeStyle' as const,
              elementId: operation.elementId,
              stroke: operation.stroke,
            },
          ]
        : [],
    ),
  );
  document.apply([
    // Turned, mirrored, rounded.
    {
      type: 'setBox',
      elementId: 'slmatrix-1-2',
      box: { x: 0.304, y: 0.23, w: 0.1, h: 0.14 },
      rotation: 30,
    },
    {
      type: 'setBox',
      elementId: 'slmatrix-3-5',
      box: { x: 0.715, y: 0.61, w: 0.1, h: 0.14 },
      flip: { x: true, y: false },
    },
    {
      type: 'setBox',
      elementId: 'slmatrix-4-2',
      box: { x: 0.304, y: 0.8, w: 0.1, h: 0.14 },
      flip: { x: false, y: true },
    },
    { type: 'setCornerRadius', elementId: 'slmatrix-1-0', radius: 8 },
    // A group: drawn from its parts (entered by a double click, each edited on its own).
    {
      type: 'groupElements',
      elementIds: ['slmatrix-0-3', 'slmatrix-0-4'],
      newElementId: 'slmatrix-group',
    },
    { type: 'setCornerRadius', elementId: 'slmatrix-2-0', radius: 999 },
    // See-through, turned with its text.
    {
      type: 'setShapeStyle',
      elementId: 'slmatrix-0-1',
      fills: [{ type: 'solid', color: '#2563eb', opacity: 0.45, visible: true }],
    },
    {
      type: 'addElement',
      pageId: 'slsample-matrix',
      elementId: 'slmatrix-turned-text',
      kind: 'rect',
      shape: 'rectangle',
      box: { x: 0.03, y: 0.81, w: 0.1, h: 0.12 },
      fill: '#fef3c7',
      stroke: { color: '#92400e', width: 1.5 },
      paragraphs: [{ align: 'center', runs: [run('Gedreht', { size: 12 })] }],
    },
    {
      type: 'setBox',
      elementId: 'slmatrix-turned-text',
      box: { x: 0.03, y: 0.81, w: 0.1, h: 0.12 },
      rotation: 15,
    },
  ]);
  // Pictures the browser draws (shown whole, stretched): a PNG and a JPEG, one turned and
  // mirrored – on a slide of their own.
  document.apply([
    {
      type: 'duplicateSlide',
      pageId: empty.pageId!,
      newPageId: 'slsample-pictures',
      after: 'slsample-matrix',
    },
  ]);
  const pictures = new Map(
    (['image/png', 'image/jpeg', 'image/jpeg'] as const).map((type, i) => [
      `slmatrix-picture-${i}`,
      testPicture(type),
    ]),
  );
  document.apply(
    [...pictures.keys()].map((imageId, i) => ({
      type: 'addImage' as const,
      pageId: 'slsample-pictures',
      elementId: imageId,
      box: { x: 0.05 + i * 0.32, y: 0.15, w: 0.26, h: 0.5 },
      imageId,
    })),
    pictures,
  );
  document.apply([
    ...[...pictures.keys()].slice(0, 2).map((elementId) => ({
      type: 'setImageFit' as const,
      elementId,
      fit: 'stretch' as const,
    })),
    // Filled, a part of it zoomed in off its middle (cut as `fo:clip`).
    {
      type: 'setImageFit',
      elementId: 'slmatrix-picture-2',
      fit: 'fill',
      focus: { x: 0.3, y: 0.6, zoom: 1.6 },
    },
    {
      type: 'setBox',
      elementId: 'slmatrix-picture-1',
      box: { x: 0.37, y: 0.2, w: 0.24, h: 0.55 },
      rotation: 20,
      flip: { x: true, y: false },
    },
  ]);
  // Lines the browser draws (`LineView`): level, upright and both diagonals, a hairline to thick,
  // dashed and dotted, without heads, with one at either end and with both – on a slide of
  // their own.
  document.apply([
    {
      type: 'duplicateSlide',
      pageId: empty.pageId!,
      newPageId: 'slsample-lines',
      after: 'slsample-pictures',
    },
  ]);
  const strokes = [
    { color: '#111827', width: 0 },
    { color: '#1e3a8a', width: 0.75 },
    { color: '#b91c1c', width: 3, dash: 'dash' as const },
    { color: '#047857', width: 3, dash: 'dot' as const },
    { color: '#7c3aed', width: 8 },
  ];
  const heads = ['none', 'end', 'start', 'both'] as const;
  const runs = [
    { box: { x: 0, y: 0, w: 0.14, h: 0 }, flip: { x: false, y: false } },
    { box: { x: 0, y: 0, w: 0, h: 0.15 }, flip: { x: false, y: true } },
    { box: { x: 0, y: 0, w: 0.14, h: 0.15 }, flip: { x: false, y: false } },
    { box: { x: 0, y: 0, w: 0.14, h: 0.15 }, flip: { x: true, y: false } },
  ];
  document.apply(
    strokes.flatMap((stroke, row) =>
      runs.map(({ box, flip }, column) => ({
        type: 'addElement' as const,
        pageId: 'slsample-lines',
        elementId: `slline-${row}-${column}`,
        kind: 'line' as const,
        // Flat ones as a frame (a frame is never flat), laid flat after.
        box: {
          x: 0.04 + column * 0.24 + (box.w ? 0 : 0.07),
          y: 0.03 + row * 0.19 + (box.h ? 0 : 0.075),
          w: box.w || 0.01,
          h: box.h || 0.01,
        },
        flip,
        heads: heads[(row + column) % heads.length],
        fill: null,
        stroke,
        paragraphs: [],
      })),
    ),
  );
  document.apply(
    strokes.flatMap((_, row) =>
      runs.flatMap(({ box, flip }, column) =>
        box.w && box.h
          ? []
          : [
              {
                type: 'setBox' as const,
                elementId: `slline-${row}-${column}`,
                box: {
                  x: 0.04 + column * 0.24 + (box.w ? 0 : 0.07),
                  y: 0.03 + row * 0.19 + (box.h ? 0 : 0.075),
                  w: box.w,
                  h: box.h,
                },
                flip,
              },
            ],
      ),
    ),
  );
  // Gradients the browser draws: each kind on a box, an ellipse, a triangle and a rounded box, one
  // turned, one see-through – on a slide of their own.
  document.apply([
    {
      type: 'duplicateSlide',
      pageId: empty.pageId!,
      newPageId: 'slsample-gradients',
      after: 'slsample-pictures',
    },
  ]);
  const kinds = ['linear', 'axial', 'radial', 'ellipsoid', 'square', 'rectangular'] as const;
  const outlines: NewShape[] = ['rectangle', 'ellipse', 'isosceles-triangle', 'rectangle'];
  const gradients: SlideOperation[] = [];
  for (const [row, shape] of outlines.entries()) {
    for (const [column, kind] of kinds.entries()) {
      const elementId = `slgradient-${row}-${column}`;
      gradients.push(
        {
          type: 'addElement',
          pageId: 'slsample-gradients',
          elementId,
          kind: 'rect',
          shape,
          box: { x: 0.03 + column * 0.16, y: 0.05 + row * 0.235, w: 0.13, h: 0.18 },
          fill: '#dbeafe',
          stroke: row === 1 ? { color: '#1e3a8a', width: 1.5 } : null,
          paragraphs: [],
        },
        {
          type: 'setShapeStyle',
          elementId,
          fills: [
            {
              type: 'gradient',
              kind,
              angle: [180, 90, 0, 30, 20, 45][column]!,
              ...(row === 2 && kind !== 'linear' && kind !== 'axial'
                ? { center: { x: 0.3, y: 0.7 } }
                : {}),
              stops: [
                { color: '#1d4ed8', at: 0 },
                ...(row === 3 ? [{ color: '#f59e0b', at: 0.4 }] : []),
                { color: '#fde68a', at: 1 },
              ],
              opacity: row === 3 && column === 0 ? 0.6 : 1,
              visible: true,
            },
          ],
        },
      );
    }
  }
  document.apply(gradients);
  // Backgrounds of their own the browser draws (beneath the master's shapes): a gradient here, one
  // colour on the matrix.
  const pageOf = (pageId: string) => document.slides().find((item) => item.pageId === pageId)!;
  document.apply([
    {
      type: 'setSlideBackground',
      pageId: pageOf('slsample-gradients').pageId!,
      fills: [
        {
          type: 'gradient',
          kind: 'radial',
          angle: 0,
          center: { x: 0.7, y: 0.3 },
          stops: [
            { color: '#ffffff', at: 0 },
            { color: '#cbd5e1', at: 1 },
          ],
          opacity: 1,
          visible: true,
        },
      ],
    },
    {
      type: 'setSlideBackground',
      pageId: pageOf('slsample-matrix').pageId!,
      fills: [{ type: 'solid', color: '#f1f5f9', opacity: 1, visible: true }],
    },
  ]);
  // A picture filling the slide's background, a part of it zoomed in off its middle
  // („Ausschnitt“), baked as the editor bakes it (`bakeFills`) – on the pictures' slide.
  const ground = testPicture('image/jpeg');
  const groundFocus = { x: 0.35, y: 0.6, zoom: 1.5 };
  document.apply(
    [
      {
        type: 'setSlideBackground',
        pageId: pageOf('slsample-pictures').pageId!,
        fills: [
          {
            type: 'image',
            src: 'slground-picture',
            fit: 'fill',
            focus: groundFocus,
            opacity: 1,
            visible: true,
          },
        ],
        composite: { imageId: 'slground-baked' },
      },
    ],
    new Map([
      ['slground-picture', ground],
      ['slground-baked', await bakedCrop(ground, groundFocus, document.pageSize())],
    ]),
  );
  document.apply([
    { type: 'setCornerRadius', elementId: 'slgradient-3-1', radius: 12 },
    {
      type: 'setBox',
      elementId: 'slgradient-0-0',
      box: { x: 0.03, y: 0.05, w: 0.13, h: 0.18 },
      rotation: 25,
    },
  ]);
  // Shapes filled with a picture (its part chosen, baked as `bakeFills` does), drawn by
  // LibreOffice – and by the browser at once over them while a change is on its way
  // (`FillOverlay`, measured with them under `--compose`): presets turned and mirrored, outlines of
  // their own (PowerPoint's as LibreOffice imports them, LibreOffice's arcs).
  document.apply([
    {
      type: 'duplicateSlide',
      pageId: empty.pageId!,
      newPageId: 'slsample-fills',
      after: 'slsample-gradients',
    },
  ]);
  const paths = await OdpDocument.open(
    new Uint8Array(await readFile(path.join(root, 'packages/odp/test/fixtures/own-paths.odp'))),
  );
  const filled: {
    id: string;
    shape?: NewShape;
    from?: string;
    rotation?: number;
    flip?: 'x' | 'y';
    radius?: number;
  }[] = [
    { id: 'slfill-rect', shape: 'rectangle' },
    { id: 'slfill-ellipse', shape: 'ellipse', rotation: 30 },
    { id: 'slfill-triangle', shape: 'isosceles-triangle', rotation: 30 },
    { id: 'slfill-round', shape: 'rectangle', rotation: 20, radius: 12 },
    { id: 'slfill-diamond', shape: 'diamond' },
    { id: 'slfill-arrow', shape: 'right-arrow', flip: 'x' },
    { id: 'slfill-down', shape: 'isosceles-triangle', flip: 'y' },
    { id: 'slfill-star', shape: 'star5' },
    { id: 'slfill-cloud', from: 'slpath-cloud' },
    { id: 'slfill-heart', from: 'slpath-heart', rotation: 15 },
    { id: 'slfill-moon', from: 'slpath-moon' },
    { id: 'slfill-quarter', from: 'slpath-quarter' },
    { id: 'slfill-bolt', from: 'slpath-bolt' },
    { id: 'slfill-wave', from: 'slpath-wave' },
    { id: 'slfill-bowl', from: 'slpath-bowl' },
  ];
  const boxOf = (i: number) => ({
    x: 0.03 + (i % 5) * 0.195,
    y: 0.04 + Math.floor(i / 5) * 0.32,
    w: 0.17,
    h: 0.26,
  });
  const sources = new Map(
    await Promise.all(
      filled
        .flatMap((item) => (item.from ? [item.from] : []))
        .map(async (id) => [id, (await paths.elementSource(id))!] as const),
    ),
  );
  document.apply(
    filled.map((item, i): SlideOperation =>
      item.from
        ? {
            type: 'copyElement',
            elementId: item.from,
            pageId: 'slsample-fills',
            newElementId: item.id,
            box: boxOf(i),
          }
        : {
            type: 'addElement',
            pageId: 'slsample-fills',
            elementId: item.id,
            kind: 'rect',
            shape: item.shape,
            box: boxOf(i),
            fill: '#dbeafe',
            stroke: { color: '#1e3a8a', width: 3 },
            paragraphs: [],
          },
    ),
    new Map(),
    new Map(),
    sources,
  );
  const fillPicture = testPicture('image/jpeg');
  const fillFocus = { x: 0.4, y: 0.45, zoom: 1.2 };
  const pageCm = document.pageSize();
  const baked = new Map<
    string,
    Awaited<ReturnType<typeof bakedCrop>> | ReturnType<typeof testPicture>
  >([['slfill-picture', fillPicture]]);
  for (const [i, item] of filled.entries()) {
    const box = boxOf(i);
    baked.set(
      `${item.id}-baked`,
      await bakedCrop(fillPicture, fillFocus, {
        width: box.w * pageCm.width,
        height: box.h * pageCm.height,
      }),
    );
  }
  document.apply(
    filled.flatMap((item, i): SlideOperation[] => [
      {
        type: 'setShapeStyle',
        elementId: item.id,
        fills: [
          {
            type: 'image',
            src: 'slfill-picture',
            fit: 'fill',
            focus: fillFocus,
            opacity: 1,
            visible: true,
          },
        ],
        composite: {
          imageId: `${item.id}-baked`,
          aspect: (boxOf(i).w * pageCm.width) / (boxOf(i).h * pageCm.height),
        },
      },
      ...(item.radius
        ? [{ type: 'setCornerRadius' as const, elementId: item.id, radius: item.radius }]
        : []),
      ...(item.rotation || item.flip
        ? [
            {
              type: 'setBox' as const,
              elementId: item.id,
              box: boxOf(i),
              ...(item.rotation && { rotation: item.rotation }),
              ...(item.flip && { flip: { x: item.flip === 'x', y: item.flip === 'y' } }),
            },
          ]
        : []),
    ]),
    baked,
  );
  document.apply(operations);
  document.apply([
    { type: 'setShapeStyle', elementId: 'slsample-ruled', verticalAlign: 'bottom' },
    // A plain text box set at its bottom (the text tab's 3 × 3 grid): taller than its text.
    { type: 'setShapeStyle', elementId: 'slsample-corner', verticalAlign: 'bottom' },
    // An unfilled box's shadow is its letters' (drawn as CSS text-shadow while typing).
    {
      type: 'setShapeStyle',
      elementId: 'slsample-shadow',
      effects: {
        shadow: { x: 2, y: 2, blur: 3, color: '#000000', opacity: 0.5 },
        blur: null,
        glow: null,
      },
    },
  ]);
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

/**
 * `fn` with a `document` that makes canvases (`@napi-rs/canvas`): a gradient out from a centre is
 * painted as the editor paints it (`gradientBackground`), not CSS's near guess.
 */
function withCanvas<T>(fn: () => T): T {
  const global = globalThis as { document?: unknown };
  const before = global.document;
  global.document = { createElement: () => createCanvas(1, 1) };
  try {
    return fn();
  } finally {
    global.document = before;
  }
}

/**
 * `picture` filling a page of `page` (cm) with its part `focus`, as `bakeFills` draws it: 1600 px
 * along its longer side, a JPEG.
 */
async function bakedCrop(
  picture: ReturnType<typeof testPicture>,
  focus: { x: number; y: number; zoom: number },
  page: { width: number; height: number },
) {
  const scale = 1600 / Math.max(page.width, page.height);
  const [width, height] = [Math.round(page.width * scale), Math.round(page.height * scale)];
  const crop = coverCrop(picture.width / picture.height, width / height, focus);
  const source = await loadImage(Buffer.from(picture.bytes));
  const canvas = createCanvas(width, height);
  canvas
    .getContext('2d')
    .drawImage(
      source,
      crop.x * picture.width,
      crop.y * picture.height,
      crop.w * picture.width,
      crop.h * picture.height,
      0,
      0,
      width,
      height,
    );
  return {
    bytes: new Uint8Array(canvas.toBuffer('image/jpeg', 90)),
    mediaType: 'image/jpeg' as const,
    width,
    height,
  };
}

/** A small picture of colour blocks and a gradient, its edges sharp: a PNG or a JPEG. */
function testPicture(type: 'image/png' | 'image/jpeg') {
  const [width, height] = [320, 240];
  const canvas = createCanvas(width, height);
  const g = canvas.getContext('2d');
  const gradient = g.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#0ea5e9');
  gradient.addColorStop(1, '#f97316');
  g.fillStyle = gradient;
  g.fillRect(0, 0, width, height);
  g.fillStyle = '#111827';
  g.fillRect(20, 20, 120, 60);
  g.fillStyle = '#ffffff';
  g.fillRect(180, 140, 110, 70);
  const bytes = new Uint8Array(
    type === 'image/png' ? canvas.toBuffer('image/png') : canvas.toBuffer('image/jpeg', 90),
  );
  return { bytes, mediaType: type, width, height };
}
