import type { Page } from '@playwright/test';
import { expect, test } from '../support';

/*
 * A deck opened once reopens offline in Bearbeiten and stays editable (docs/do-not-break.md „Undo is
 * instant and works offline“): its slide composed from what the service worker kept – an element
 * LibreOffice draws at its place now, though its picture is from before it moved –, a box moved,
 * undone and done again without a connection; back online, the server has it where it ended.
 * Bundle mode only (`bun run e2e:live:bundle`): a service worker is registered by production
 * builds alone.
 */

test.skip(!process.env.E2E_BUNDLE, 'needs the production build served by the API');
// The pause detector (speaking to the AI) is not loaded ahead offline – its files are not kept –,
// so no `loading model file /vad/…` error is allowed here.
test.use({
  allowConsoleErrors: [
    [/ERR_INTERNET_DISCONNECTED/, /Failed to load resource/],
    { scope: 'test' },
  ],
});

const RED = '#e0245e';
const PURPLE = '#7c3aed';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface EditState {
  seq: number;
  slides: { pageId: string; elements: { id: string; bbox: Box }[] }[];
}

const hex = (color: string) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
const near = (a: number[], b: number[]) =>
  Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!) + Math.abs(a[2]! - b[2]!) <= 64;
const centre = (box: Box) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });

async function editState(page: Page, deckId: string): Promise<EditState> {
  const response = await page.request.get(`/api/decks/${deckId}/edit`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as EditState;
}

async function apply(page: Page, deckId: string, operations: unknown[]) {
  const { seq } = await editState(page, deckId);
  const response = await page.request.post(`/api/decks/${deckId}/edit/operations`, {
    data: { operations, baseSeq: seq },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

/** The slide on screen (its largest picture), CSS px. */
async function slideRect(page: Page) {
  return page.evaluate(() => {
    const largest = [...document.querySelectorAll<HTMLImageElement>('[role="group"] img')]
      .map((img) => img.getBoundingClientRect())
      .filter((r) => r.width > 0)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0]!;
    return { x: largest.x, y: largest.y, w: largest.width, h: largest.height };
  });
}

/** The colour at a point of the slide now. */
async function colourAt(page: Page, at: { x: number; y: number }) {
  const rect = await slideRect(page);
  const shot = await page.screenshot({
    clip: {
      x: Math.round(rect.x + at.x * rect.w),
      y: Math.round(rect.y + at.y * rect.h),
      width: 1,
      height: 1,
    },
  });
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  }, shot.toString('base64'));
}

const shows = (page: Page, at: { x: number; y: number }, color: string) =>
  expect
    .poll(async () => near(await colourAt(page, at), hex(color)), { timeout: 15_000 })
    .toBe(true);

async function openComposed(page: Page, deckId: string) {
  await page.goto(`/d/${deckId}`);
  await page.getByRole('radio', { name: 'Bearbeiten' }).click();
  await expect(page.locator('[data-compose-shown]')).toBeVisible({ timeout: 30_000 });
}

test('a deck reopened offline stays editable', async ({ page, context }) => {
  test.setTimeout(240_000);
  const created = await page.request.post('/api/decks/blank', { data: {} });
  expect(created.status()).toBe(201);
  const deck = (await created.json()) as { id: string };
  await expect
    .poll(async () => (await editState(page, deck.id)).slides?.length ?? 0, { timeout: 60_000 })
    .toBeGreaterThan(0);
  const pageId = (await editState(page, deck.id)).slides[0]!.pageId;
  const red: Box = { x: 0.1, y: 0.4, w: 0.2, h: 0.25 };
  const purple: Box = { x: 0.6, y: 0.15, w: 0.15, h: 0.15 };
  await apply(page, deck.id, [
    {
      type: 'addElement',
      pageId,
      elementId: 'slredbox01',
      kind: 'rect',
      shape: 'rectangle',
      box: red,
      fill: RED,
      stroke: null,
      paragraphs: [],
    },
    {
      type: 'addElement',
      pageId,
      elementId: 'slshadowed01',
      kind: 'rect',
      shape: 'rectangle',
      box: purple,
      fill: PURPLE,
      stroke: null,
      paragraphs: [],
    },
    // A shadow: LibreOffice draws it (no `paint`), from its layer picture.
    {
      type: 'setShapeStyle',
      elementId: 'slshadowed01',
      effects: {
        shadow: { x: 3, y: 3, blur: 4, color: '#000000', opacity: 0.4 },
        blur: null,
        glow: null,
        softEdge: null,
      },
    },
  ]);
  await page.addInitScript(() =>
    localStorage.setItem('slider.workPreferences.v1', JSON.stringify({ autoZoom: false })),
  );
  await openComposed(page, deck.id);
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  // Under the service worker once more: now it keeps what Bearbeiten loads.
  await openComposed(page, deck.id);
  await shows(page, { x: purple.x + 0.03, y: purple.y + 0.03 }, PURPLE);

  // The shadowed box moved meanwhile (as someone else would): its picture is from before.
  const moved = { ...purple, y: purple.y + 0.4 };
  await apply(page, deck.id, [{ type: 'setBox', elementId: 'slshadowed01', box: moved }]);
  await shows(page, { x: moved.x + 0.03, y: moved.y + 0.03 }, PURPLE);

  await context.setOffline(true);
  await openComposed(page, deck.id);
  // Where it is now, though offline.
  await shows(page, { x: moved.x + 0.03, y: moved.y + 0.03 }, PURPLE);
  await shows(page, centre(red), RED);

  // The red box moved, undone, done again – all offline.
  const to = { ...red, x: red.x + 0.3 };
  const rect = await slideRect(page);
  const at = (point: { x: number; y: number }) => ({
    x: rect.x + point.x * rect.w,
    y: rect.y + point.y * rect.h,
  });
  const a = at(centre(red));
  const b = at(centre(to));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++)
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10);
  await page.mouse.up();
  const newOnly = { x: to.x + to.w - 0.03, y: to.y + to.h / 2 };
  const oldOnly = { x: red.x + 0.03, y: red.y + red.h / 2 };
  await shows(page, newOnly, RED);
  await page.keyboard.press('Meta+z');
  await shows(page, oldOnly, RED);
  await page.keyboard.press('Meta+Shift+z');
  await shows(page, newOnly, RED);

  await context.setOffline(false);
  await expect
    .poll(
      async () =>
        (await editState(page, deck.id)).slides[0]!.elements.find((e) => e.id === 'slredbox01')
          ?.bbox.x ?? -1,
      { timeout: 30_000 },
    )
    .toBeCloseTo(to.x, 2);
});
