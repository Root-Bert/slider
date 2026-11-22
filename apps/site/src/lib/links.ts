/** Where the website points to: the hosted app and the public repository. */
export const APP_URL = 'https://office.bertro.dev';
/** Cloud in the hosted app (it has no address of its own). */
export const CLOUD_URL = `${APP_URL}/cloud`;
/** Reader in the hosted app: on to the PDFs of the workspace last open. */
export const READER_URL = `${APP_URL}/reader`;
export const REPO_URL = 'https://github.com/Root-Bert/slider';
export const CHANGELOG_URL = `${REPO_URL}/releases`;
/** The personal page of the person behind it all. */
export const BERTRO_URL = '/me/';
export const CONTACT_URL = 'mailto:slider@bertro.dev';
/** Imprint and privacy policy: one each for the whole domain, at its root. */
export const IMPRINT_URL = '/impressum';
export const PRIVACY_URL = '/datenschutz';
/** Slider's API as the website reaches it (Caddy in production, a dev middleware in `astro.config.mjs`). */
export const API_URL = '/slider/api';

/**
 * One of Slider's own pages (`/slider/…`): blog, contact, download. The office and the
 * apps' pages are built with `appPage` (`~/i18n`).
 */
export function page(path = ''): string {
  const rest = path.replace(/^\//, '');
  return rest ? `/slider/${rest}` : '/slider/';
}

/** A file from `public/`. */
export const asset = (path: string): string => `/${path.replace(/^\//, '')}`;
