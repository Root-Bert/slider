import type { AppId } from '~/lib/apps';
import { page } from '~/lib/links';
import { de } from './de';
import { en, type Dict } from './en';
import { fr } from './fr';
import { SUITE, type Suite } from './suite';

/**
 * The website in three languages. English sits right under a page's address (`/office/`,
 * `/slider/`), the others under their code (`/office/de/`, `/slider/fr/`). A first visit to an
 * English page follows the browser's language (`Base.astro`), the switcher in the footer
 * remembers a choice.
 */
export const LANGS = ['en', 'de', 'fr'] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_NAMES: Record<Lang, string> = { en: 'English', de: 'Deutsch', fr: 'Français' };
const DICTS: Record<Lang, Dict> = { en, de, fr };

/** Slider's own words (its homepage, download, live comments). */
export const t = (lang: Lang): Dict => DICTS[lang];
/** The office's words: navigation, the apps, plans. */
export const s = (lang: Lang): Suite => SUITE[lang];

/** The office's or an app's page in a language: `appPage('writer', 'de')` → `/writer/de/`. */
export function appPage(app: AppId, lang: Lang, hash = ''): string {
  return `/${app}/${lang === 'en' ? '' : `${lang}/`}${hash}`;
}

/** One of Slider's pages in a language: `localPage('de', 'download')` → `/slider/de/download`. */
export function localPage(lang: Lang, path = ''): string {
  const rest = path.replace(/^\//, '');
  return page(lang === 'en' ? rest : rest ? `${lang}/${rest}` : `${lang}/`);
}

export type { Dict, Suite };
