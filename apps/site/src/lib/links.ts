/** Where the website points to: the hosted app, the source and the self-hosting guide. */
export const APP_URL = 'https://slider.bertro.dev';
export const REPO_URL = 'https://github.com/Root-Bert/slider';
export const SELF_HOSTING_URL = `${REPO_URL}/blob/main/docs/self-hosting.md`;
export const CHANGELOG_URL = `${REPO_URL}/releases`;
export const BERTRO_URL = 'https://bertro.dev';
export const CONTACT_URL = 'mailto:slider@bertro.dev';

/** A path inside the website, under its base (`/slider`). */
export function page(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const rest = path.replace(/^\//, '');
  return rest ? `${base}/${rest}` : `${base}/`;
}

/** A file from `public/`, under the base. */
export const asset = (path: string): string => page(path);
