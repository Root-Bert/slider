/**
 * The office and its five apps. Each has a page of its own (`/office`, `/slider`, `/writer`,
 * `/solver`, `/reader`, `/cloud`); the office introduces all of them at once. Names are the same in every
 * language.
 */
export const PRODUCTS = ['slider', 'writer', 'solver', 'reader', 'cloud'] as const;
export type ProductId = (typeof PRODUCTS)[number];
export type AppId = 'office' | ProductId;
export const APPS: readonly AppId[] = ['office', ...PRODUCTS];

export const APP_NAMES: Record<AppId, string> = {
  office: 'Office',
  slider: 'Slider',
  writer: 'Writer',
  solver: 'Solver',
  reader: 'Reader',
  cloud: 'Cloud',
};

/** What can be used today; the others say so and still lead to an account. */
const LIVE = new Set<ProductId>(['slider', 'reader', 'cloud']);
export const isLive = (app: ProductId): boolean => LIVE.has(app);

/** The app's colour as a CSS value (`site.css` sets them, a lighter Writer blue on dark). */
export const appColor = (app: ProductId): string => `var(--app-${app})`;
