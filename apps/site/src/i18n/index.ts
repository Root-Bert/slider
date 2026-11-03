import { page } from '~/lib/links';
import { de } from './de';
import { en, type Dict } from './en';
import { fr } from './fr';

/**
 * The website in three languages. English sits at the root (`/slider/`), the others under their
 * code (`/slider/de/`, `/slider/fr/`). A first visit to an English page follows the browser's
 * language (`Base.astro`), the switcher in the footer remembers a choice.
 */
export const LANGS = ['en', 'de', 'fr'] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_NAMES: Record<Lang, string> = { en: 'English', de: 'Deutsch', fr: 'Français' };
const DICTS: Record<Lang, Dict> = { en, de, fr };

export const t = (lang: Lang): Dict => DICTS[lang];

/** A page of the site in a language: `localPage('de', 'pricing')` → `/slider/de/pricing`. */
export function localPage(lang: Lang, path = ''): string {
  const rest = path.replace(/^\//, '');
  return page(lang === 'en' ? rest : rest ? `${lang}/${rest}` : `${lang}/`);
}

export type { Dict };
