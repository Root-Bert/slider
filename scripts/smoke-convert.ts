/**
 * The default slide renderer of the container, end to end: a deck through the real LibreOffice
 * (PPTX → PDF), then pdf.js + @napi-rs/canvas on Bun (PDF → WebP per page) – exactly the code an
 * upload runs (apps/api/src/import/libreoffice.ts, pdf-pages.ts). Run by scripts/smoke-image.sh
 * inside the image, from /app/apps/api; works the same from a checkout:
 *
 *   cd apps/api && bun ../../scripts/smoke-convert.ts ../../packages/pptx/samples/slider-demo.pptx
 *
 * Fails unless every visible slide (LibreOffice leaves hidden ones out) became one WebP page.
 * Modules are loaded relative to the working directory, so the script can be copied anywhere.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as LibreOffice from '../apps/api/src/import/libreoffice';
import type * as PdfPages from '../apps/api/src/import/pdf-pages';
import type * as Logger from '../apps/api/src/logger';
import type * as Pptx from '../packages/pptx/src/index';

const load = <T>(file: string) => import(pathToFileURL(path.resolve(file)).href) as Promise<T>;

const deckFile = process.argv[2];
if (!deckFile) throw new Error('usage: bun smoke-convert.ts <deck.pptx>');
// Generous: under emulation (the arm64 image on an amd64 runner) LibreOffice is many times slower.
const timeoutMs = Number(process.env.SMOKE_CONVERT_TIMEOUT_MS ?? 600_000);

const { createLibreOfficePdf, findSoffice } = await load<typeof LibreOffice>(
  'src/import/libreoffice.ts',
);
const { rasterizePdf } = await load<typeof PdfPages>('src/import/pdf-pages.ts');
const { openPptx } = await load<typeof Pptx>('../../packages/pptx/src/index.ts');
const { silentLogger } = await load<typeof Logger>('src/logger.ts');

const deck = new Uint8Array(await readFile(deckFile));
const visible = (await openPptx(deck)).presentation.slides.filter((s) => !s.hidden).length;

const binary = await findSoffice({ configured: process.env.LIBREOFFICE_PATH || null });
if (!binary) throw new Error('soffice not found');

const started = Date.now();
const pdf = await createLibreOfficePdf({ binary, log: silentLogger, timeoutMs })(deck);
const pages = await rasterizePdf(pdf);

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  new TextDecoder().decode(bytes.subarray(from, to));
const isWebp = (bytes: Uint8Array) =>
  bytes.length > 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP';

if (pages.length !== visible) {
  throw new Error(`${pages.length} page images for ${visible} visible slides`);
}
for (const [i, page] of pages.entries()) {
  if (!isWebp(page.image) || !isWebp(page.thumbnail)) throw new Error(`page ${i + 1} is no WebP`);
}
console.info(`${pages.length} slides → WebP in ${Math.round((Date.now() - started) / 1000)} s`);
