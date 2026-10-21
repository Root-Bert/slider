import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test as base, type Page } from '@playwright/test';

/** The part of the API's deck the suite reads. */
interface Deck {
  id: string;
  workspaceId: string;
  import: { status: string };
}

export const SAMPLE_DECK = fileURLToPath(
  new URL('../packages/pptx/samples/slider-demo.pptx', import.meta.url),
);
/** slider-demo.pptx: five visible slides (plus one hidden). */
export const SAMPLE_SLIDES = [
  'Q4 Strategie 2026',
  'Agenda',
  'Umsatz nach Region',
  'Produkt-Roadmap',
  'Vielen Dank',
];

const MIMETYPE_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
let copies = 0;

/**
 * slider-demo.pptx as a file of its own: the same bytes again would open the deck they made
 * (the API never imports one file twice into a workspace), so each copy gets its own ZIP comment.
 */
export function sampleDeckFile(): { name: string; mimeType: string; buffer: Buffer } {
  const bytes = readFileSync(SAMPLE_DECK);
  // The end-of-central-directory record: 22 bytes, its last two the comment length (0 here).
  const end = bytes.length - 22;
  if (bytes.readUInt32LE(end) !== 0x06054b50 || bytes.readUInt16LE(end + 20) !== 0) {
    throw new Error('slider-demo.pptx: unexpected ZIP ending');
  }
  const comment = Buffer.from(`e2e copy ${process.pid}-${++copies}`);
  const buffer = Buffer.concat([bytes, comment]);
  buffer.writeUInt16LE(comment.length, end + 20);
  return { name: 'slider-demo.pptx', mimeType: MIMETYPE_PPTX, buffer };
}

const shotsDir = process.env.E2E_SHOTS
  ? path.resolve(process.env.E2E_SHOTS_DIR ?? fileURLToPath(new URL('./.shots', import.meta.url)))
  : null;

/**
 * Waits until the images on screen have loaded and finite animations (the import stage's
 * reveal, fades) are over – so screenshots show the settled page.
 */
export async function settle(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const visible = (el: Element) => {
            const r = el.getBoundingClientRect();
            return (
              r.width > 0 &&
              r.bottom > 0 &&
              r.top < innerHeight &&
              r.right > 0 &&
              r.left < innerWidth
            );
          };
          const loading = [...document.images].filter(
            (img) => visible(img) && !(img.complete && img.naturalWidth > 0),
          ).length;
          const animating = document
            .getAnimations()
            .filter((a) => a.playState === 'running')
            .filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime))).length;
          return loading + animating;
        }),
      { timeout: 15_000 },
    )
    .toBe(0);
}

/** Full-page screenshot into the shots folder – only when `E2E_SHOTS` is set. */
export async function shot(page: Page, name: string): Promise<void> {
  if (!shotsDir) return;
  await settle(page);
  mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`), fullPage: true });
}

/**
 * `page` that fails the test on uncaught errors and `console.error` in the browser. Expected
 * errors (e.g. a 404 the test provokes) go into `allowConsoleErrors`.
 */
export const test = base.extend<{ allowConsoleErrors: RegExp[] }>({
  allowConsoleErrors: [[], { option: true }],
  page: async ({ page, allowConsoleErrors }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = `${message.text()} (${message.location().url})`;
      if (!allowConsoleErrors.some((re) => re.test(text))) errors.push(`console.error: ${text}`);
    });
    await use(page);
    expect(errors, 'browser errors during the test').toEqual([]);
  },
});
export { expect };

/** Uploads the sample deck through the API (as the dev owner) and waits for its import. */
export async function uploadSampleDeck(page: Page): Promise<Deck> {
  const response = await page.request.post('/api/decks/upload', {
    multipart: { file: sampleDeckFile() },
  });
  expect(response.status()).toBe(201);
  const deck = (await response.json()) as Deck;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/decks/${deck.id}`);
        return ((await res.json()) as Deck).import.status;
      },
      { timeout: 30_000 },
    )
    .toBe('ready');
  return deck;
}

/** Opens a deck and waits until its slides are on screen. */
export async function openDeck(page: Page, deckId: string): Promise<void> {
  await page.goto(`/d/${deckId}`);
  await expect(
    page.getByRole('group', { name: `Folie 1 von 5: ${SAMPLE_SLIDES[0]}` }),
  ).toBeVisible();
}
