/**
 * Builds the template library: every spec in `src/templates/` becomes `library/<slug>.otp`, is
 * read as Slider reads an uploaded template, and is drawn by the real LibreOffice – one filled
 * slide per layout – into `previews/<slug>.jpg` (all its layouts on one sheet) to look at.
 *
 *   cd packages/templates && bun src/build.ts            # all
 *   bun src/build.ts pop-art zeitung                     # only these
 *   bun src/build.ts --no-draw                           # files only, no LibreOffice
 *
 * `library/index.json` lists what was built (name, group, tags, colours, fonts, layouts), and
 * `library/<slug>/<n>.jpg` shows each layout: what the API offers as Slider's own templates.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { OFFICE_FONTS } from '@slider/shared';
import { cover, samplePicture } from './art';
import { PAGE, type Template, type TemplateModule } from './model';
import { problems, templateFiles } from './odf';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const api = path.resolve(root, '../../apps/api/src');
const load = <T>(file: string) => import(pathToFileURL(file).href) as Promise<T>;

/** The parts of the API the build draws and checks with, loaded from its sources. */
interface Api {
  libreoffice: {
    findSoffice(options: { configured: string | null }): Promise<string | null>;
    createLibreOfficePdf(options: {
      binary: string;
      log: unknown;
      timeoutMs?: number;
    }): (deck: Uint8Array) => Promise<Uint8Array>;
  };
  pages: {
    rasterizePdf(
      pdf: Uint8Array,
      onPage: (page: { image: Uint8Array; thumbnail: Uint8Array }, index: number) => Promise<void>,
    ): Promise<number>;
  };
  logger: { silentLogger: unknown };
  odp: {
    OdpDocument: {
      open(bytes: Uint8Array): Promise<{
        masterPages(): {
          displayName: string | null;
          placeholders: { kind: string; style: string | null; prompt: string | null }[];
        }[];
      }>;
    };
  };
  masters: {
    readMasterFile(bytes: Uint8Array): Promise<{
      layouts: { name: string | null }[];
      colors: { color: string; name: string }[];
      aspectRatio: number;
    }>;
  };
}

const args = process.argv.slice(2);
const draw = !args.includes('--no-draw');
const wanted = args.filter((arg) => !arg.startsWith('--'));

const files = (await readdir(path.join(here, 'templates')))
  .filter((file) => file.endsWith('.ts'))
  .sort();
const templates: Template[] = [];
for (const file of files) {
  const slug = file.replace(/\.ts$/, '');
  if (wanted.length > 0 && !wanted.includes(slug)) continue;
  const module = await load<{ default: TemplateModule }>(path.join(here, 'templates', file));
  const template = typeof module.default === 'function' ? await module.default() : module.default;
  if (template.slug !== slug) throw new Error(`${file}: its slug is „${template.slug}“`);
  templates.push(template);
}
if (templates.length === 0) throw new Error('No template to build.');

/** A template stays light: it is copied into every deck made from it. */
const MAX_BYTES = 2048 * 1024;

const fonts = new Set<string>(OFFICE_FONTS);
let failed = false;
for (const template of templates) {
  for (const problem of problems(template, fonts)) {
    console.error(`✗ ${template.slug}: ${problem}`);
    failed = true;
  }
}
if (failed) process.exit(1);

await mkdir(path.join(root, 'library'), { recursive: true });
await mkdir(path.join(root, 'previews'), { recursive: true });

const odp = await load<Api['odp']>(path.resolve(root, '../odp/src/index.ts'));
const masters = await load<Api['masters']>(path.join(api, 'import/master-deck.ts'));
const libreoffice = await load<Api['libreoffice']>(path.join(api, 'import/libreoffice.ts'));
const pages = await load<Api['pages']>(path.join(api, 'import/pdf-pages.ts'));
const { silentLogger } = await load<Api['logger']>(path.join(api, 'logger.ts'));
const binary = draw
  ? await libreoffice.findSoffice({ configured: process.env.LIBREOFFICE_PATH || null })
  : null;
if (draw && !binary) throw new Error('soffice not found (or pass --no-draw)');
const toPdf = binary
  ? libreoffice.createLibreOfficePdf({ binary, log: silentLogger, timeoutMs: 180_000 })
  : null;

/** A layout's picture as the editor's „Folie einfügen“ shows it: this wide, a JPEG. */
const TILE_WIDTH = 640;

async function tile(bytes: Uint8Array): Promise<Buffer> {
  const height = Math.round((TILE_WIDTH * PAGE.h) / PAGE.w);
  const canvas = createCanvas(TILE_WIDTH, height);
  canvas.getContext('2d').drawImage(await loadImage(Buffer.from(bytes)), 0, 0, TILE_WIDTH, height);
  return canvas.toBuffer('image/jpeg', 84);
}

/** All layouts of a template on one sheet, three across, each with its name. */
async function sheet(template: Template, thumbnails: Uint8Array[]): Promise<Buffer> {
  const [across, width, gap, label] = [3, 800, 16, 30];
  const height = Math.round((width * PAGE.h) / PAGE.w);
  const down = Math.ceil(thumbnails.length / across);
  const canvas = createCanvas(
    across * width + (across + 1) * gap,
    down * (height + label) + (down + 1) * gap,
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e9e9ec';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '18px sans-serif';
  for (const [index, bytes] of thumbnails.entries()) {
    const x = gap + (index % across) * (width + gap);
    const y = gap + Math.floor(index / across) * (height + label + gap);
    ctx.drawImage(await loadImage(Buffer.from(bytes)), x, y, width, height);
    ctx.fillStyle = '#333333';
    ctx.fillText(`${index + 1}  ${template.layouts[index]?.name ?? ''}`, x + 2, y + height + 21);
  }
  return canvas.toBuffer('image/jpeg', 88);
}

async function build(template: Template): Promise<Record<string, unknown>> {
  const colors = [...template.palette.accents, template.palette.bg2, template.palette.text2];
  const made = await templateFiles(template, async (box, index) => {
    const own = template.samplePictures;
    return own?.length
      ? cover(own[index % own.length]!, box)
      : samplePicture(box, colors, index + 1);
  });

  // As an upload: must be a template with these layouts and its ten colours.
  const read = await masters.readMasterFile(made.template);
  const names = read.layouts.map((layout) => layout.name);
  const expected = template.layouts.map((layout) => layout.name);
  if (names.join('|') !== expected.join('|')) {
    throw new Error(`${template.slug}: read back as ${names.join(', ')}`);
  }
  // As a deck made from it: every placeholder with its look and what it asks for.
  const document = await odp.OdpDocument.open(made.template);
  for (const master of document.masterPages()) {
    for (const holder of master.placeholders) {
      if (holder.kind !== 'picture' && (!holder.style || holder.prompt === null)) {
        throw new Error(
          `${template.slug}: ${master.displayName} – a ${holder.kind} without its style`,
        );
      }
    }
  }
  if (read.colors.length !== 10) {
    throw new Error(`${template.slug}: ${read.colors.length} colours read back, not 10`);
  }
  if (made.template.length > MAX_BYTES) {
    throw new Error(
      `${template.slug}: ${Math.round(made.template.length / 1024)} kB – over ${MAX_BYTES / 1024} kB (smaller or fewer pictures, one picture for several layouts)`,
    );
  }
  await writeFile(path.join(root, 'library', `${template.slug}.otp`), made.template);

  if (toPdf) {
    const pdf = await toPdf(made.preview);
    const thumbnails: Uint8Array[] = [];
    const count = await pages.rasterizePdf(pdf, async (page, index) => {
      thumbnails[index] = page.thumbnail;
    });
    if (count !== template.layouts.length) {
      throw new Error(`${template.slug}: ${count} pages drawn for ${expected.length} layouts`);
    }
    await writeFile(
      path.join(root, 'previews', `${template.slug}.jpg`),
      await sheet(template, thumbnails),
    );
    await mkdir(path.join(root, 'library', template.slug), { recursive: true });
    for (const [index, bytes] of thumbnails.entries()) {
      await writeFile(
        path.join(root, 'library', template.slug, `${index + 1}.jpg`),
        await tile(bytes),
      );
    }
  }
  console.info(
    `✓ ${template.slug} – ${expected.length} layouts, ${Math.round(made.template.length / 1024)} kB`,
  );
  return {
    slug: template.slug,
    name: template.name,
    group: template.group,
    tags: template.tags,
    description: template.description,
    fonts: template.fonts,
    colors: read.colors,
    aspectRatio: read.aspectRatio,
    layouts: expected,
    file: `${template.slug}.otp`,
    bytes: made.template.length,
  };
}

// A few LibreOffices side by side; each run has its own profile.
const entries: Record<string, unknown>[] = [];
const queue = [...templates];
await Promise.all(
  Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      try {
        entries.push(await build(next));
      } catch (error) {
        failed = true;
        console.error(`✗ ${next.slug}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }),
);

// The catalogue keeps what earlier runs built; this run's entries replace theirs.
const indexFile = path.join(root, 'library', 'index.json');
const kept: Record<string, unknown>[] = await readFile(indexFile, 'utf8')
  .then((text) => JSON.parse(text) as Record<string, unknown>[])
  .catch(() => []);
const slugs = new Set(files.map((file) => file.replace(/\.ts$/, '')));
const built = new Map(entries.map((entry) => [entry.slug, entry]));
const all = [...kept.filter((entry) => !built.has(entry.slug as string)), ...entries]
  .filter((entry) => slugs.has(entry.slug as string))
  .sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
await writeFile(indexFile, `${JSON.stringify(all, null, 2)}\n`);
console.info(`${entries.length} built, ${all.length} in the library.`);
process.exit(failed ? 1 : 0);
