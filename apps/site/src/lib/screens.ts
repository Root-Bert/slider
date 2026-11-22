import type { ImageMetadata } from 'astro';
import type { ProductId } from './apps';

/**
 * The apps' screens (Figma: each app's "Prototyp" page, exported at 2×; Reader's taken from the
 * running app at 1440 × 900, 2×) under
 * `assets/screens/{app}/{nn-name}.png`. The number orders them, the name is the key their
 * caption is filed under (`i18n/screens.ts`).
 */
const FILES = import.meta.glob<ImageMetadata>('../assets/screens/*/*.png', {
  eager: true,
  import: 'default',
});

export interface AppScreen {
  /** The file's name without its number: `editor`, `ai-done`. */
  name: string;
  image: ImageMetadata;
}

const BY_APP = new Map<string, AppScreen[]>();
for (const [path, image] of Object.entries(FILES).sort(([a], [b]) => a.localeCompare(b))) {
  const [, app, name] = /\/screens\/([^/]+)\/\d+-(.+)\.png$/.exec(path) ?? [];
  if (!app || !name) continue;
  BY_APP.set(app, [...(BY_APP.get(app) ?? []), { name, image }]);
}

/** All screens of an app, in their order. */
export function screensOf(app: ProductId): AppScreen[] {
  return BY_APP.get(app) ?? [];
}

/** One screen of an app by its name. */
export function screenOf(app: ProductId, name: string): AppScreen {
  const found = screensOf(app).find((screen) => screen.name === name);
  if (!found) throw new Error(`No screen "${name}" for ${app}`);
  return found;
}

/** The screen an app is shown with first, and the ones that stand beside its three principles. */
export const LEAD_SCREEN: Record<ProductId, string> = {
  slider: 'discuss',
  writer: 'editor',
  solver: 'canvas',
  reader: 'fill',
  cloud: 'recent',
};
export const PRINCIPLE_SCREENS: Record<ProductId, [string, string, string]> = {
  slider: ['thread', 'ai-changed', 'export'],
  writer: ['focus', 'ai-done', 'slide-from-slider'],
  solver: ['in-slider', 'answer', 'origin'],
  reader: ['sign', 'discuss', 'search'],
  cloud: ['ask', 'area', 'deleted'],
};
