import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLIDER_TEMPLATE_PREFIX, type SliderTemplate } from '@slider/shared';
import type { AppDeps } from '../deps';
import { notFound } from '../http/errors';

/**
 * The templates Slider brings along: files `packages/templates` builds (`index.json`, a
 * `<slug>.otp` each and a picture of every layout, `<slug>/<n>.jpg`) – the same for every
 * workspace, never in the database. An instance without the folder has none.
 */

const DEFAULT_DIR = fileURLToPath(
  new URL('../../../../packages/templates/library', import.meta.url),
);

type Deps = Pick<AppDeps, 'config'>;

const dirOf = (deps: Deps) => deps.config.sliderTemplatesDir ?? DEFAULT_DIR;

/** A slug as the build names its files: nothing that could leave the folder. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface Entry {
  slug: string;
  name: string;
  group: string;
  description: string;
  tags: string[];
  aspectRatio?: number;
  layouts: string[];
  bytes: number;
}

/** The catalogue as last read, by its folder; read again once `index.json` changed. */
const read = new Map<string, { stamp: number; templates: SliderTemplate[] }>();

export async function listSliderTemplates(deps: Deps): Promise<SliderTemplate[]> {
  const dir = dirOf(deps);
  const file = path.join(dir, 'index.json');
  const stamp = await stat(file).then(
    (found) => found.mtimeMs,
    () => null,
  );
  if (stamp === null) return [];
  const kept = read.get(dir);
  if (kept?.stamp === stamp) return kept.templates;
  const entries = JSON.parse(await readFile(file, 'utf8')) as Entry[];
  const templates = entries
    .filter((entry) => SLUG.test(entry.slug) && entry.aspectRatio !== undefined)
    .map((entry) => ({
      id: `${SLIDER_TEMPLATE_PREFIX}${entry.slug}`,
      name: entry.name,
      group: entry.group,
      description: entry.description,
      tags: entry.tags,
      aspectRatio: entry.aspectRatio!,
      layouts: entry.layouts.map((name, index) => ({
        name,
        // The file's size names its build: a template built anew is fetched anew.
        thumbnailUrl: `/api/slider-templates/${entry.slug}/${index + 1}.jpg?v=${entry.bytes}`,
      })),
    }));
  read.set(dir, { stamp, templates });
  return templates;
}

/** The picture of layout `number` (from 1) of the template `slug`. */
export async function sliderTemplatePicture(
  deps: Deps,
  slug: string,
  number: string,
): Promise<Uint8Array> {
  if (!SLUG.test(slug) || !/^[1-9]\d{0,2}$/.test(number)) throw notFound();
  return readFile(path.join(dirOf(deps), slug, `${number}.jpg`)).catch(() => {
    throw notFound();
  });
}

/** The file of the template an `addSlide` names as its `design`; `null` when it is not Slider's. */
export async function sliderTemplateFile(deps: Deps, id: string): Promise<Uint8Array | null> {
  if (!id.startsWith(SLIDER_TEMPLATE_PREFIX)) return null;
  const slug = id.slice(SLIDER_TEMPLATE_PREFIX.length);
  if (!SLUG.test(slug)) return null;
  return readFile(path.join(dirOf(deps), `${slug}.otp`)).catch(() => null);
}
