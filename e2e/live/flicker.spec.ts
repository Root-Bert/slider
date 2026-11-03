import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from '../support';

/*
 * Every frame the screen shows while the editor turns an edit into LibreOffice's new picture
 * (CLAUDE.md §1 „No flicker after an edit“): a CDP screencast from the gesture until the slide is
 * its picture alone again, each frame probed at a few points of the slide. An element moved never
 * shows at its old place again once it showed at the new one, and is at the new one in every frame
 * after; no frame is blank; what the edit did not touch stays as it was. One test, its scenarios in
 * steps (the suite's case budget).
 */

const RED = '#e0245e';
const BLUE = '#1d4ed8';
const GREEN = '#16a34a';
const PURPLE = '#7c3aed';
const ORANGE = '#f97316';
/** How long a change made elsewhere may take to show here (ms). */
const REMOTE_MS = 3000;

interface Deck {
  id: string;
}
interface EditState {
  seq: number;
  slides: { slideId: string; pageId: string; elements: { id: string; bbox: Box }[] }[];
}
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** A point of the slide, 0–1 – with `r`, the darkest pixel within `r` px of it (text). */
interface At {
  x: number;
  y: number;
  r?: number;
}
type Rgb = [number, number, number];
interface Frame {
  at: number;
  colors: Rgb[];
}

const hex = (color: string): Rgb => [
  parseInt(color.slice(1, 3), 16),
  parseInt(color.slice(3, 5), 16),
  parseInt(color.slice(5, 7), 16),
];
const near = (a: Rgb, b: Rgb, tolerance = 64) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= tolerance;
const WHITE: Rgb = [255, 255, 255];
const centre = (box: Box): At => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });

async function editState(page: Page, deckId: string): Promise<EditState> {
  const response = await page.request.get(`/api/decks/${deckId}/edit`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as EditState;
}

async function apply(page: Page, deckId: string, operations: unknown[]): Promise<void> {
  const { seq } = await editState(page, deckId);
  const response = await page.request.post(`/api/decks/${deckId}/edit/operations`, {
    data: { operations, baseSeq: seq },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

/** The slide's picture on screen, in CSS px. */
async function slideRect(page: Page) {
  const rect = await page.evaluate(() => {
    const group = document.querySelector('[role="group"]')!.getBoundingClientRect();
    const view = {
      left: Math.max(0, group.left),
      top: Math.max(0, group.top),
      right: Math.min(innerWidth, group.right),
      bottom: Math.min(innerHeight, group.bottom),
    };
    const images = [...document.querySelectorAll<HTMLImageElement>('[role="group"] img')];
    const largest = images
      .map((img) => img.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return largest
      ? { x: largest.x, y: largest.y, w: largest.width, h: largest.height, view }
      : null;
  });
  expect(rect).not.toBeNull();
  return rect!;
}

/** Waits until no edit is on its way: nothing drawn over the composed slide until its picture. */
async function settled(page: Page) {
  await expect
    .poll(() => page.evaluate(() => !document.querySelector('[data-photo-preview]')), {
      timeout: 30_000,
      intervals: [50],
    })
    .toBe(true);
  // Its newest picture swapped in (`SwapImage` keeps one `<img>` once it is shown), and the slide
  // still where it is (picking a small element zooms in on it, letting it go zooms back).
  let last = '';
  await expect
    .poll(
      async () => {
        await page.waitForTimeout(250);
        const now = JSON.stringify(await slideRect(page));
        const still = now === last;
        last = now;
        return still;
      },
      { timeout: 15_000, intervals: [0] },
    )
    .toBe(true);
}

/**
 * Records every frame of `action` until the slide is its picture alone, probing `points` (of the
 * slide) in each. Decoded in a page of its own, so the editor's frames are not disturbed.
 */
async function record(
  page: Page,
  decoder: Page,
  points: At[],
  action: () => Promise<void>,
  /** A change from elsewhere: how long it may take to arrive (ms) before the slide counts settled. */
  linger = 0,
  /** Every frame from the gesture's start (a drag seen elsewhere while it goes on), not from its end. */
  sinceStart = false,
): Promise<Frame[]> {
  const rect = await slideRect(page);
  shownAt = rect;
  const client: CDPSession = await page.context().newCDPSession(page);
  const shots: { data: string; at: number }[] = [];
  client.on(
    'Page.screencastFrame',
    (event: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
      shots.push({ data: event.data, at: event.metadata.timestamp ?? 0 });
      void client.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
    },
  );
  await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await page.evaluate(startLog);
  await page.waitForTimeout(200);
  const started = Date.now() / 1000;
  await action();
  // From the release on: the handover to LibreOffice's picture (while dragged, the frame and the
  // element itself pass over the points).
  const released = Date.now() / 1000;
  lastReleased = released;
  if (linger) await page.waitForTimeout(linger);
  await settled(page);
  await client.send('Page.stopScreencast');
  await client.detach();
  lastLog = await page.evaluate(stopLog);
  // Points the slide's frame shows (picking may zoom it: one off screen is not probed).
  const px = points.map((point) => ({
    x: Math.round(rect.x + point.x * rect.w),
    y: Math.round(rect.y + point.y * rect.h),
    r: point.r ?? 0,
  }));
  // …and not under a panel floating over the slide (its colours change with the edit).
  const open = await page.evaluate(
    (points) =>
      points.map(({ x, y }) => {
        const top = document.elementFromPoint(x, y);
        return !!top && !!top.closest('[role="group"]');
      }),
    px,
  );
  const seen = px.map(
    ({ x, y }, i) =>
      open[i] &&
      x > rect.view.left + 2 &&
      x < rect.view.right - 2 &&
      y > rect.view.top + 2 &&
      y < rect.view.bottom - 2,
  );
  const frames: Frame[] = [];
  const viewport = page.viewportSize();
  const from = sinceStart ? started : released - 0.02;
  for (const shot of shots.filter((item) => item.at >= from)) {
    const colors = await decoder.evaluate(
      async ({ data, px, width }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        // Not the page: a clipped `page.screenshot` (the probe read while dragging, `dragEnd`)
        // comes through the screencast as a frame of its own – 1 × 1 px, no frame of the page.
        if (width !== undefined && image.width < width) return null;
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return px.map(({ x, y, r: radius }) => {
          const side = radius * 2 + 1;
          const data = context.getImageData(x - radius, y - radius, side, side).data;
          let best: [number, number, number] = [data[0]!, data[1]!, data[2]!];
          for (let i = 0; i < data.length; i += 4) {
            const color: [number, number, number] = [data[i]!, data[i + 1]!, data[i + 2]!];
            if (color[0] + color[1] + color[2] < best[0] + best[1] + best[2]) best = color;
          }
          return best;
        });
      },
      { data: shot.data, px, width: viewport?.width },
    );
    if (!colors) continue;
    frames.push({
      at: shot.at,
      colors: colors.map((color, i) => (seen[i] ? color : ([-1, -1, -1] as Rgb))),
    });
  }
  return frames;
}

/**
 * What each animation frame drew over the slide (the composed layer and its pictures, the
 * slide's own pictures): printed with a failure, to name the layer that showed the wrong frame.
 */
let lastLog: string[] = [];
/** When the last recording's gesture ended (s, as the frames' timestamps). */
let lastReleased = 0;
/** The slide's picture on screen as the scenario recording now measured it (picking may zoom). */
let shownAt = {
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  view: { left: 0, top: 0, right: 0, bottom: 0 },
};
function startLog() {
  const log: string[] = [];
  const w = window as unknown as { __flickerLog?: string[]; __flickerStop?: boolean };
  w.__flickerLog = log;
  w.__flickerStop = false;
  const describe = () => {
    const slide = [...document.querySelectorAll<HTMLImageElement>('[role="group"] img')]
      .filter((img) => img.getBoundingClientRect().width > 300)
      .map((img) => `${img.src.split('/').pop()?.slice(0, 10)}${img.complete ? '' : '…'}`);
    const layer = document.querySelector<HTMLElement>('[data-compose-shown]');
    const parts = layer
      ? [...layer.querySelectorAll<HTMLElement>('img, [style*="mask"]')].map((el) => {
          const style = getComputedStyle(el);
          const url =
            el.tagName === 'IMG'
              ? (el as HTMLImageElement).src
              : (/url\("?([^")]+)/.exec(style.maskImage || style.webkitMaskImage)?.[1] ?? '');
          const name = url.split('/').pop()?.split('?')[0]?.slice(0, 8);
          return `${el.tagName === 'IMG' ? 'img' : 'mask'}:${name}${style.visibility === 'hidden' ? '(h)' : ''}`;
        })
      : [];
    // The track's scroll and where the slide on screen is, how opaque (a slide that glides or fades).
    let scroller: HTMLElement | null = document.querySelector<HTMLElement>('[data-track]');
    while (scroller && scroller.scrollWidth <= scroller.clientWidth)
      scroller = scroller.parentElement;
    const shown = [...document.querySelectorAll<HTMLImageElement>('[role="group"] img')]
      .map((img) => ({ img, rect: img.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 300 && rect.right > 0 && rect.left < innerWidth)
      .map(({ img, rect }) => {
        let opacity = 1;
        for (let el: HTMLElement | null = img; el; el = el.parentElement)
          opacity *= Number(getComputedStyle(el).opacity);
        return `${Math.round(rect.x)}@${opacity.toFixed(2)}`;
      });
    return `${(performance.timeOrigin + performance.now()).toFixed(0)} scroll=${Math.round(scroller?.scrollLeft ?? -1)} at[${shown.join(',')}] slide[${slide.join(',')}] layer${
      layer ? `(${getComputedStyle(layer).visibility[0]})[${parts.join(',')}]` : '-'
    }`;
  };
  const tick = () => {
    const line = describe();
    if (log.at(-1)?.split(' ').slice(1).join(' ') !== line.split(' ').slice(1).join(' '))
      log.push(line);
    if (!w.__flickerStop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function stopLog(): string[] {
  const w = window as unknown as { __flickerLog?: string[]; __flickerStop?: boolean };
  w.__flickerStop = true;
  return w.__flickerLog ?? [];
}

/** A failure's evidence: each frame's colour at the point and what each animation frame drew. */
const trail = (frames: Frame[], index: number) =>
  `\n${frames.map((frame) => `${(frame.at * 1000).toFixed(0)}:${frame.colors[index]!.join(',')}`).join(' | ')}\n${lastLog.join('\n')}`;

/** `color` at point `index`: from the first frame it shows there, in every frame after. */
function staysOnceShown(frames: Frame[], index: number, color: Rgb, what: string) {
  const first = frames.findIndex((frame) => near(frame.colors[index]!, color));
  expect(first, `${what}: never shown`).toBeGreaterThanOrEqual(0);
  const lost = frames.slice(first).findIndex((frame) => !near(frame.colors[index]!, color));
  expect(
    lost,
    `${what}: gone again in frame ${first + lost} of ${frames.length}${trail(frames, index)}`,
  ).toBe(-1);
  return first;
}

/** Once `color` left point `index`, it never comes back. */
function neverBack(frames: Frame[], index: number, color: Rgb, what: string, from = 0) {
  const left = frames.findIndex((frame, i) => i >= from && !near(frame.colors[index]!, color));
  if (left < 0) return;
  const back = frames.slice(left).findIndex((frame) => near(frame.colors[index]!, color));
  expect(
    back,
    `${what}: back in frame ${left + back} of ${frames.length}${trail(frames, index)}`,
  ).toBe(-1);
}

/** Point `index` shows in every frame what it showed in the first (what the edit did not touch). */
function stable(frames: Frame[], index: number, what: string) {
  if (frames.length === 0 || frames[0]!.colors[index]![0] < 0) return;
  always(frames, index, frames[0]!.colors[index]!, what);
}

/** Point `index` keeps `color` in every frame. */
function always(frames: Frame[], index: number, color: Rgb, what: string) {
  // No frame painted after the gesture: nothing changed.
  if (frames.length === 0 || frames[0]!.colors[index]![0] < 0) return; // off screen (zoomed in)
  const off = frames.findIndex((frame) => !near(frame.colors[index]!, color));
  expect(off, `${what}: off in frame ${off} of ${frames.length}${trail(frames, index)}`).toBe(-1);
}

// Offline (19), the browser reports each request it cannot make; a slide deleted from elsewhere
// while its layers were asked for (two editors, h) answers 404. Wrapped once more: a fixture
// given an array takes it as `[value, options]`.
test.use({
  allowConsoleErrors: [
    [/ERR_INTERNET_DISCONNECTED/, /404 \(Not Found\).*\/edit\/slides\/[^/]+\/layers/],
    { scope: 'test' },
  ],
});

test('edits never show a stale or empty frame', async ({ page, browser }) => {
  test.slow();
  test.setTimeout(240_000);
  const decoder = await browser.newPage();
  // Bearbeiten composed per element (CLAUDE.md §1).
  await scenarios(page, decoder);
  await decoder.close();
});

/** Every scenario on a deck of its own. */
async function scenarios(page: Page, decoder: Page) {
  const created = await page.request.post('/api/decks/blank', { data: {} });
  expect(created.status()).toBe(201);
  const deck = (await created.json()) as Deck;
  // Drawn by LibreOffice first: editable once its slide is there.
  await expect
    .poll(async () => (await editState(page, deck.id)).slides?.length ?? 0, { timeout: 60_000 })
    .toBeGreaterThan(0);
  const state = await editState(page, deck.id);
  const pageId = state.slides[0]!.pageId;
  const red: Box = { x: 0.1, y: 0.35, w: 0.2, h: 0.25 };
  const blue: Box = { x: 0.45, y: 0.35, w: 0.15, h: 0.25 };
  const green: Box = { x: 0.75, y: 0.7, w: 0.15, h: 0.15 };
  const shape = (id: string, box: Box, fill: string, shapeName = 'rectangle') => ({
    type: 'addElement',
    pageId,
    elementId: id,
    kind: 'rect',
    shape: shapeName,
    box,
    fill,
    stroke: null,
    paragraphs: [],
  });
  const text: Box = { x: 0.08, y: 0.72, w: 0.3, h: 0.14 };
  await apply(page, deck.id, [
    {
      type: 'addElement',
      pageId,
      elementId: 'sltextbox01',
      kind: 'text',
      box: text,
      fill: null,
      stroke: null,
      paragraphs: [
        {
          align: 'left',
          runs: [
            {
              text: 'Hallo',
              font: 'Inter',
              size: 40,
              color: '#111111',
              bold: true,
              italic: false,
              underline: false,
            },
          ],
        },
      ],
    },
    shape('slredbox01', red, RED),
    shape('slbluetri01', blue, BLUE, 'isosceles-triangle'),
    shape('slgreenbox01', green, GREEN),
    // A thick arrow (6b), drawn by the browser.
    {
      type: 'addElement',
      pageId,
      elementId: 'slarrow01',
      kind: 'line',
      box: { x: 0.62, y: 0.2, w: 0.26, h: 0.01 },
      heads: 'end',
      fill: null,
      stroke: { color: PURPLE, width: 8 },
      paragraphs: [],
    },
    { type: 'setBox', elementId: 'slarrow01', box: { x: 0.62, y: 0.2, w: 0.26, h: 0 } },
  ]);

  // Picking a small element would zoom in on it and letting it go back out – frames of a moving
  // slide, not of the edit: off here (its own behaviour, „Kleine Elemente heranzoomen“).
  await page.addInitScript(() =>
    localStorage.setItem('slider.workPreferences.v1', JSON.stringify({ autoZoom: false })),
  );
  await page.goto(`/d/${deck.id}`);
  await page.getByRole('radio', { name: 'Bearbeiten' }).click();
  await settled(page);
  await expect(page.locator('[data-compose-shown]')).toBeVisible({ timeout: 30_000 });
  shownAt = await slideRect(page);
  const toScreen = (point: At) => ({
    x: shownAt.x + point.x * shownAt.w,
    y: shownAt.y + point.y * shownAt.h,
  });
  // The untouched green box: it must never move or vanish.
  const greenAt = { x: green.x + 0.03, y: green.y + 0.03 }; // off its sides and middles: no snap line over it

  // 1. Moving a shape not picked yet: never back at its old place once at the new one.
  {
    const from = centre(red);
    const to = { x: from.x, y: from.y - 0.22 };
    // A point the box covers only where it was, one only where it goes.
    const oldOnly = { x: from.x, y: red.y + red.h - 0.03 };
    const newOnly = { x: to.x, y: red.y - 0.22 + 0.03 };
    const frames = await record(page, decoder, [oldOnly, newOnly, greenAt], async () => {
      const a = toScreen(from);
      const b = toScreen(to);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) {
        await page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10);
      }
      await page.mouse.up();
    });
    // Composed, little changes after the release: the screencast may send only a few frames.
    expect(frames.length).toBeGreaterThan(1);
    const shown = staysOnceShown(frames, 1, hex(RED), 'moved box at its new place');
    neverBack(frames, 0, hex(RED), 'moved box at its old place', shown);
    stable(frames, 2, 'untouched box');
    // From the release to the box's final pixels at its new place.
    console.info(
      `composed: moved box final ${((frames[shown]!.at - lastReleased) * 1000).toFixed(0)} ms after release (frame ${shown})`,
    );
    expect(shown, 'composed: the moved box is where it goes at once').toBe(0);
    red.y -= 0.22;
  }

  // 2. Moving the picked shape: the same.
  {
    const from = centre(red);
    await page.mouse.click(toScreen(from).x, toScreen(from).y);
    await expect(page.getByText('Form „Rechteck 1“')).toBeVisible();
    await settled(page);
    shownAt = await slideRect(page);
    const to = { x: from.x + 0.2, y: from.y };
    const oldOnly = { x: red.x + 0.02, y: from.y };
    const newOnly = { x: red.x + red.w + 0.2 - 0.02, y: from.y };
    const frames = await record(page, decoder, [oldOnly, newOnly, greenAt], async () => {
      const a = toScreen(from);
      const b = toScreen(to);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) {
        await page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10);
      }
      await page.mouse.up();
    });
    const shown = staysOnceShown(frames, 1, hex(RED), 'picked box at its new place');
    neverBack(frames, 0, hex(RED), 'picked box at its old place', shown);
    stable(frames, 2, 'untouched box');
    red.x += 0.2;
  }

  // 3. Resizing it by its top left corner (its panel and bar sit right and below): the new part
  // stays once shown.
  {
    const corner = { x: red.x, y: red.y };
    const grown = { x: corner.x - 0.06, y: corner.y - 0.06 };
    const inside = centre(red);
    const added = { x: corner.x - 0.03, y: corner.y - 0.03 };
    const frames = await record(page, decoder, [inside, added, greenAt], async () => {
      const a = toScreen(corner);
      const b = toScreen(grown);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) {
        await page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10);
      }
      await page.mouse.up();
    });
    always(frames, 0, hex(RED), 'resized box inside');
    staysOnceShown(frames, 1, hex(RED), 'resized box grown part');
    stable(frames, 2, 'untouched box');
    red.x -= 0.06;
    red.y -= 0.06;
    red.w += 0.06;
    red.h += 0.06;
  }

  // 4. Undo (⌘Z) the resize: the grown part goes and never comes back.
  {
    const added = { x: red.x + 0.03, y: red.y + 0.03 };
    const frames = await record(page, decoder, [centre(red), added, greenAt], async () => {
      await page.keyboard.press('Meta+z');
    });
    always(frames, 0, hex(RED), 'box inside after undo');
    neverBack(frames, 1, hex(RED), 'undone grown part');
    stable(frames, 2, 'untouched box');
    red.x += 0.06;
    red.y += 0.06;
    red.w -= 0.06;
    red.h -= 0.06;
  }

  // 5. Moving the triangle (another outline, its cutout another shape) – the box let go first,
  // the slide zoomed back out.
  {
    await page.keyboard.press('Escape');
    await expect(page.getByText('Form „Rechteck 1“')).toBeHidden();
    await page.waitForTimeout(600);
    await settled(page);
    shownAt = await slideRect(page);
    const from = { x: blue.x + blue.w / 2, y: blue.y + blue.h * 0.75 };
    const to = { x: from.x, y: from.y + 0.2 };
    const oldOnly = { x: from.x, y: blue.y + blue.h * 0.4 };
    const newOnly = { x: to.x, y: blue.y + blue.h + 0.2 - 0.03 };
    const frames = await record(page, decoder, [oldOnly, newOnly, greenAt], async () => {
      const a = toScreen(from);
      const b = toScreen(to);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) {
        await page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10);
      }
      await page.mouse.up();
    });
    const shown = staysOnceShown(frames, 1, hex(BLUE), 'moved triangle at its new place');
    neverBack(frames, 0, hex(BLUE), 'moved triangle at its old place', shown);
    stable(frames, 2, 'untouched box');
    blue.y += 0.2;
  }

  // 6. Deleting the triangle, picked: gone at once and never back; nothing else blinks.
  {
    const inside = { x: blue.x + blue.w / 2, y: blue.y + blue.h * 0.75 };
    await page.mouse.click(toScreen(inside).x, toScreen(inside).y);
    await expect(page.getByText('Form „Dreieck 1“')).toBeVisible();
    await settled(page);
    shownAt = await slideRect(page);
    const frames = await record(page, decoder, [inside, centre(red), greenAt], async () => {
      await page.keyboard.press('Backspace');
    });
    neverBack(frames, 0, hex(BLUE), 'deleted triangle');
    expect(near(frames.at(-1)!.colors[0]!, WHITE), 'deleted triangle: slide white').toBe(true);
    always(frames, 1, hex(RED), 'untouched box after delete');
    stable(frames, 2, 'untouched box');
  }

  // 6b. A line's end dragged by its handle: the line runs to where it went in every frame after,
  // never along where it was; deleted, it is gone at once.
  {
    await page.keyboard.press('Escape');
    await settled(page);
    shownAt = await slideRect(page);
    const on = toScreen({ x: 0.7, y: 0.2 });
    await page.mouse.click(on.x, on.y);
    await expect(page.getByText('Linie „Pfeil 1“')).toBeVisible();
    await settled(page);
    shownAt = await slideRect(page);
    const end = page.locator('[data-line-end="to"]');
    await expect(end).toBeVisible();
    const oldOnly = { x: 0.8, y: 0.2 };
    // Beside its middle: the picked line's frame runs along it there.
    const newOnly = { x: 0.75, y: 0.282 };
    const frames = await record(page, decoder, [oldOnly, newOnly, greenAt], async () => {
      const a = toScreen({ x: 0.88, y: 0.2 });
      const b = toScreen({ x: 0.88, y: 0.35 });
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(a.x, a.y + ((b.y - a.y) * i) / 10);
      await page.mouse.up();
    });
    const shown = staysOnceShown(frames, 1, hex(PURPLE), 'dragged line where it runs now');
    neverBack(frames, 0, hex(PURPLE), 'dragged line where it ran', shown);
    stable(frames, 2, 'untouched box');
    const gone = await record(page, decoder, [newOnly, greenAt], async () => {
      await page.keyboard.press('Backspace');
    });
    neverBack(gone, 0, hex(PURPLE), 'deleted line');
    stable(gone, 1, 'untouched box');
  }

  // 7. A fill changed (hex typed in its colour picker): the new colour stays once shown.
  {
    const inside = centre(red);
    await page.mouse.click(toScreen(inside).x, toScreen(inside).y);
    await expect(page.getByText('Form „Rechteck 1“')).toBeVisible();
    await page.getByRole('tab', { name: 'Aussehen' }).click();
    await page.getByRole('button', { name: 'Ebene bearbeiten' }).first().click();
    const hexField = page.getByLabel('Farbe als Hex');
    await expect(hexField).toBeVisible();
    await settled(page);
    shownAt = await slideRect(page);
    const frames = await record(page, decoder, [inside, greenAt], async () => {
      await hexField.fill('1d4ed8');
    });
    staysOnceShown(frames, 0, hex(BLUE), 'new fill');
    neverBack(frames, 0, hex(RED), 'old fill', 1);
    stable(frames, 1, 'untouched box');
    // Let go (its panel's „Fertig“).
    await page.getByRole('button', { name: /^Fertig/ }).click();
    await expect(page.getByText('Form „Rechteck 1“')).toBeHidden();
    await settled(page);
  }

  // 8. Typing in a text box and letting it go: its text is there in every frame.
  {
    shownAt = await slideRect(page);
    const word = { x: text.x + 0.05, y: text.y + 0.05, r: 6 };
    const textBox = toScreen(centre(text));
    await page.mouse.dblclick(textBox.x, textBox.y);
    await page.waitForTimeout(500);
    // Typed in, its text shows once: the editor's – none drawn under it (the slide's pictures
    // leave a live text out).
    const shownTexts = () =>
      page.evaluate(
        () =>
          [...document.querySelectorAll<HTMLElement>('[role="group"] *')].filter(
            (el) =>
              el.childElementCount === 0 &&
              el.textContent?.includes('Hallo') &&
              getComputedStyle(el).visibility !== 'hidden' &&
              el.getBoundingClientRect().width > 0,
          ).length,
      );
    expect(await shownTexts(), 'typed text shown once').toBe(1);
    const frames = await record(page, decoder, [word, greenAt], async () => {
      await page.keyboard.press('End');
      await page.keyboard.type(' Welt', { delay: 60 });
      expect(await shownTexts(), 'typed text shown once while typed').toBe(1);
      await page.keyboard.press('Escape');
    });
    const dark = frames.findIndex((frame) => frame.colors[0]!.reduce((a, b) => a + b, 0) > 300);
    expect(dark, `typed text gone in frame ${dark}${trail(frames, 0)}`).toBe(-1);
    stable(frames, 1, 'untouched box');
    await page.keyboard.press('Escape');
    await settled(page);
  }

  // 9. The slide's background changed (its panel from the slide's menu – drawn by the browser
  // under the slide's foreground until LibreOffice's picture comes): once the new background
  // shows, the old white never comes back, and what lies on it stays.
  {
    shownAt = await slideRect(page);
    const empty = { x: 0.95, y: 0.06 };
    const corner = toScreen(empty);
    await page.mouse.click(corner.x, corner.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Hintergrund' }).click();
    await page.getByRole('tab', { name: 'Farbe' }).click();
    const hexField = page.getByLabel('Farbe als Hex');
    await expect(hexField).toBeVisible();
    await settled(page);
    const frames = await record(page, decoder, [empty, centre(red), greenAt], async () => {
      await hexField.fill('facc15');
    });
    const changed = frames.findIndex((frame) => !near(frame.colors[0]!, WHITE, 12));
    expect(changed, `background never changed${trail(frames, 0)}`).toBeGreaterThanOrEqual(0);
    const back = frames.slice(changed).findIndex((frame) => near(frame.colors[0]!, WHITE, 12));
    expect(back, `old background back in frame ${changed + back}${trail(frames, 0)}`).toBe(-1);
    always(frames, 1, hex(BLUE), 'box over the new background');
    stable(frames, 2, 'untouched box');
    await page.keyboard.press('Escape');
    await settled(page);
  }

  // The box is blue since its fill changed (7). What follows changes the slide from elsewhere
  // (the API, as another person would) while it is edited here.
  const box = red;

  // 10. A shape with a shadow (LibreOffice draws it: its picture comes a moment later) added,
  // the box moved right after: the slide never falls back to how it was, nothing jumps.
  {
    shownAt = await slideRect(page);
    const shadowed: Box = { x: 0.62, y: 0.08, w: 0.12, h: 0.12 };
    await apply(page, deck.id, [
      shape('slshadowed01', shadowed, PURPLE),
      {
        type: 'setShapeStyle',
        elementId: 'slshadowed01',
        effects: {
          shadow: { x: 3, y: 3, blur: 4, color: '#000000', opacity: 0.4 },
          blur: null,
          glow: null,
          backdrop: null,
        },
      },
    ]);
    const from = centre(box);
    const to = { x: from.x, y: from.y + 0.15 };
    const oldOnly = { x: from.x, y: box.y + 0.03 };
    const newOnly = { x: to.x, y: box.y + box.h + 0.15 - 0.03 };
    const frames = await record(
      page,
      decoder,
      [oldOnly, newOnly, greenAt, centre(shadowed)],
      async () => {
        const a = toScreen(from);
        const b = toScreen(to);
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        for (let i = 1; i <= 10; i++) {
          await page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10);
        }
        await page.mouse.up();
      },
    );
    const shown = staysOnceShown(frames, 1, hex(BLUE), 'box moved beside a new shape');
    neverBack(frames, 0, hex(BLUE), 'box at its old place beside a new shape', shown);
    stable(frames, 2, 'untouched box');
    staysOnceShown(frames, 3, hex(PURPLE), 'shadowed shape added');
    box.y += 0.15;
    await page.keyboard.press('Escape');
    await settled(page);
  }

  // 11. The box turned: once a corner of it is uncovered, the box never shows there again.
  {
    shownAt = await slideRect(page);
    const corner = { x: box.x + 0.012, y: box.y + 0.02 };
    const frames = await record(
      page,
      decoder,
      [centre(box), corner, greenAt],
      async () => {
        await apply(page, deck.id, [
          { type: 'setBox', elementId: 'slredbox01', box, rotation: 30 },
        ]);
      },
      REMOTE_MS,
    );
    always(frames, 0, hex(BLUE), 'turned box inside');
    const uncovered = frames.findIndex((frame) => !near(frame.colors[1]!, hex(BLUE)));
    expect(
      uncovered,
      `turned box: corner never uncovered${trail(frames, 1)}`,
    ).toBeGreaterThanOrEqual(0);
    neverBack(frames, 1, hex(BLUE), 'turned box corner', uncovered);
    stable(frames, 2, 'untouched box');
  }

  // 12. Its line dashed: inside it nothing blinks.
  {
    shownAt = await slideRect(page);
    const frames = await record(
      page,
      decoder,
      [centre(box), greenAt],
      async () => {
        await apply(page, deck.id, [
          {
            type: 'setShapeStyle',
            elementId: 'slredbox01',
            stroke: { color: '#000000', width: 4, dash: 'dash' },
          },
        ]);
      },
      REMOTE_MS,
    );
    always(frames, 0, hex(BLUE), 'dashed box inside');
    stable(frames, 1, 'untouched box');
  }

  // 13. A picture added: once it shows, it stays; nothing else blinks.
  const picture: Box = { x: 0.62, y: 0.42, w: 0.12, h: 0.16 };
  {
    shownAt = await slideRect(page);
    // Orange on its left half, purple on its right: a part of it shown is seen (15).
    const png = await decoder.evaluate(
      async ([left, right]) => {
        const canvas = new OffscreenCanvas(64, 48);
        const context = canvas.getContext('2d')!;
        context.fillStyle = left!;
        context.fillRect(0, 0, 32, 48);
        context.fillStyle = right!;
        context.fillRect(32, 0, 32, 48);
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return btoa(String.fromCharCode(...bytes));
      },
      [ORANGE, PURPLE],
    );
    const uploaded = await page.request.post(`/api/decks/${deck.id}/edit/images`, {
      multipart: {
        file: { name: 'orange.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
      },
    });
    expect(uploaded.ok(), await uploaded.text()).toBe(true);
    const { imageId } = (await uploaded.json()) as { imageId: string };
    const leftQuarter = { x: picture.x + picture.w * 0.15, y: picture.y + picture.h / 2 };
    const frames = await record(
      page,
      decoder,
      [leftQuarter, greenAt],
      async () => {
        await apply(page, deck.id, [
          { type: 'addImage', pageId, elementId: 'slpicture01', box: picture, imageId },
        ]);
      },
      REMOTE_MS,
    );
    staysOnceShown(frames, 0, hex(ORANGE), 'picture added');
    stable(frames, 1, 'untouched box');
  }

  // 14. A gradient fill on the box (from elsewhere): once it shows, the old blue never comes back.
  {
    shownAt = await slideRect(page);
    const frames = await record(
      page,
      decoder,
      [centre(box), greenAt],
      async () => {
        await apply(page, deck.id, [
          {
            type: 'setShapeStyle',
            elementId: 'slredbox01',
            fills: [
              {
                type: 'gradient',
                kind: 'linear',
                angle: 90,
                // Orange to past its middle, then into purple: an end dragged shows (17).
                stops: [
                  { color: ORANGE, at: 0 },
                  { color: ORANGE, at: 0.6 },
                  { color: PURPLE, at: 1 },
                ],
                opacity: 1,
                visible: true,
              },
            ],
          },
        ]);
      },
      REMOTE_MS,
    );
    const shown = staysOnceShown(frames, 0, hex(ORANGE), 'gradient fill');
    neverBack(frames, 0, hex(BLUE), 'fill before the gradient', shown);
    stable(frames, 1, 'untouched box');
    // Someone else's step drawn from its operations (live stream), not after a refetch.
    console.info(
      `remote: gradient shown ${((frames[shown]!.at - lastReleased) * 1000).toFixed(0)} ms after the step was answered (frame ${shown})`,
    );
  }

  // 15. The picture's part chosen (from elsewhere): zoomed in on its orange half, its right
  // quarter turns orange and never purple again.
  {
    shownAt = await slideRect(page);
    const rightQuarter = { x: picture.x + picture.w * 0.85, y: picture.y + picture.h / 2 };
    const frames = await record(
      page,
      decoder,
      [rightQuarter, greenAt],
      async () => {
        await apply(page, deck.id, [
          {
            type: 'setImageFit',
            elementId: 'slpicture01',
            fit: 'fill',
            focus: { x: 0.25, y: 0.5, zoom: 2 },
          },
        ]);
      },
      REMOTE_MS,
    );
    const shown = staysOnceShown(frames, 0, hex(ORANGE), 'picture part chosen');
    neverBack(frames, 0, hex(PURPLE), 'picture before its part was chosen', shown);
    stable(frames, 1, 'untouched box');
  }

  // 16. The background's gradient: its end dragged up – the slide follows while dragged, and once
  // let go nothing changes any more (no picture lands over it).
  {
    shownAt = await slideRect(page);
    const empty = { x: 0.95, y: 0.06 };
    const low = { x: 0.04, y: 0.94 };
    const corner = toScreen(empty);
    await page.mouse.click(corner.x, corner.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Hintergrund' }).click();
    await page.getByRole('tab', { name: 'Verlauf' }).click();
    await settled(page);
    const frames = await dragEnd(page, decoder, [low, greenAt]);
    stable(frames, 0, 'background once its gradient was let go');
    stable(frames, 1, 'untouched box');
    expect(lastDrag.changed, 'background followed the drag').toBeGreaterThan(3);
    await page.keyboard.press('Escape');
    await settled(page);
  }

  // 17. The box's gradient: its end dragged on the box – the same.
  {
    shownAt = await slideRect(page);
    const inside = centre(box);
    await page.mouse.click(toScreen(inside).x, toScreen(inside).y);
    await page.getByRole('tab', { name: 'Aussehen' }).click();
    await page.getByRole('button', { name: 'Ebene bearbeiten' }).first().click();
    await settled(page);
    // Along its length towards its gradient's end, turned with it (30°, 11) – off the handles'
    // line across it, which passes over the middle.
    const aspect = shownAt.w / shownAt.h;
    const along = box.w * 0.35;
    const aside = (box.h * 0.3) / aspect;
    const [c, s] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
    const near = {
      x: box.x + box.w / 2 + along * c - aside * s,
      y: box.y + box.h / 2 + (along * s + aside * c) * aspect,
    };
    const frames = await dragEnd(page, decoder, [near, greenAt], centre(box));
    stable(frames, 0, 'box once its gradient was let go');
    stable(frames, 1, 'untouched box');
    expect(lastDrag.changed, 'box followed the drag').toBeGreaterThan(3);
    await page.getByRole('button', { name: /^Fertig/ }).click();
    await settled(page);
  }

  // 18. The slide's own background dropped („Wie im Master“): the master's shows at once (drawn
  // alone by LibreOffice ahead), the slide's own never again.
  {
    await page.keyboard.press('Escape');
    shownAt = await slideRect(page);
    const empty = { x: 0.95, y: 0.06 };
    const corner = toScreen(empty);
    await page.mouse.click(corner.x, corner.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Hintergrund' }).click();
    await page.getByRole('tab', { name: 'Farbe' }).click();
    await page.getByLabel('Farbe als Hex').fill('facc15');
    await settled(page);
    const reset = await record(page, decoder, [empty, greenAt], async () => {
      await page.getByRole('button', { name: 'Wie im Master' }).click();
    });
    // The first frame may be the one before the click was drawn; the next one shows the master's.
    const white = reset.findIndex((frame) => near(frame.colors[0]!, WHITE, 12));
    expect(white, `master's background not at once${trail(reset, 0)}`).toBeGreaterThanOrEqual(0);
    expect(white, `master's background not at once${trail(reset, 0)}`).toBeLessThanOrEqual(1);
    neverBack(reset, 0, hex('#facc15'), 'own background after „Wie im Master“', white);
    stable(reset, 1, 'untouched box');
    await page.keyboard.press('Escape');
    await settled(page);
  }

  // 20. The background a picture (orange left, purple right), its part chosen on the slide
  // („Ausschnitt“, the slide its frame): zoomed in 2×, dragged left – the slide follows while
  // dragged (the browser draws the background), and once taken (↵) nothing changes any more.
  {
    const split = await uploadPicture(page, decoder, deck.id, [ORANGE, PURPLE]);
    await apply(page, deck.id, [
      {
        type: 'setSlideBackground',
        pageId,
        fills: [{ type: 'image', src: split, fit: 'fill', opacity: 1, visible: true }],
        composite: { imageId: split },
      },
    ]);
    await settled(page);
    shownAt = await slideRect(page);
    const empty = { x: 0.95, y: 0.06 };
    const corner = toScreen(empty);
    await page.mouse.click(corner.x, corner.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Hintergrund' }).click();
    await page.getByRole('tab', { name: 'Bild' }).click();
    await page.getByRole('button', { name: 'Ausschnitt', exact: true }).click();
    await expect(page.locator('[data-picture-crop]')).toBeVisible();
    shownAt = await slideRect(page);
    const middle = toScreen({ x: 0.5, y: 0.5 });
    await page.mouse.move(middle.x, middle.y);
    await page.mouse.wheel(0, -350);
    await settled(page);
    // Left of the middle, above the shapes: orange now, purple once the picture moved left.
    const probe = { x: 0.42, y: 0.2 };
    let letGo = 0;
    const frames = await record(
      page,
      decoder,
      [probe, greenAt],
      async () => {
        const to = toScreen({ x: 0.35, y: 0.5 });
        await page.mouse.down();
        for (let i = 1; i <= 20; i++)
          await page.mouse.move(middle.x + ((to.x - middle.x) * i) / 20, middle.y);
        letGo = Date.now() / 1000;
        await page.mouse.up();
        await page.keyboard.press('Enter');
      },
      0,
      true,
    );
    const shown = staysOnceShown(frames, 0, hex(PURPLE), 'background part chosen');
    expect(
      frames[shown]!.at,
      `background followed only after the drag${trail(frames, 0)}`,
    ).toBeLessThan(letGo);
    neverBack(frames, 0, hex(ORANGE), 'background before its part was chosen', shown);
    stable(frames, 1, 'untouched box');
    await expect(page.locator('[data-picture-crop]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await apply(page, deck.id, [{ type: 'setSlideBackground', pageId, fills: [] }]);
    await settled(page);
  }

  // 21. An ellipse with text, filled with a picture zoomed in on its orange half: „Strecken“ in
  // its fill – its right side purple in the next frames (drawn at once over it, cut to the
  // ellipse, under its text), never orange again; its text there in every frame.
  {
    const split = await uploadPicture(page, decoder, deck.id, [ORANGE, PURPLE]);
    const orange = await uploadPicture(page, decoder, deck.id, [ORANGE, ORANGE]);
    const oval: Box = { x: 0.72, y: 0.05, w: 0.2, h: 0.28 }; // clear of where step 19 moves the green box
    const plain: Box = { x: 0.04, y: 0.06, w: 0.12, h: 0.18 };
    const filled = (elementId: string, box: Box) => ({
      type: 'setShapeStyle',
      elementId,
      fills: [
        {
          type: 'image',
          src: split,
          fit: 'fill',
          focus: { x: 0.25, y: 0.5, zoom: 2 },
          opacity: 1,
          visible: true,
        },
      ],
      composite: { imageId: orange, aspect: (box.w * 16) / (box.h * 9) },
    });
    await apply(page, deck.id, [
      {
        ...shape('slpicoval01', oval, '#ffffff', 'ellipse'),
        paragraphs: [
          {
            align: 'center',
            runs: [
              {
                text: 'Hi',
                font: 'Inter',
                size: 28,
                color: '#111111',
                bold: true,
                italic: false,
                underline: false,
              },
            ],
          },
        ],
      },
      filled('slpicoval01', oval),
      shape('slpicplain01', plain, '#ffffff'),
      filled('slpicplain01', plain),
    ]);
    await settled(page);
    shownAt = await slideRect(page);
    // Double-clicked: the shape without text has its part chosen on the slide, the one with
    // text is typed in.
    await page.mouse.dblclick(toScreen(centre(plain)).x, toScreen(centre(plain)).y);
    await expect(page.locator('[data-picture-crop="slpicplain01"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-picture-crop]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.mouse.dblclick(toScreen(centre(oval)).x, toScreen(centre(oval)).y);
    await expect(page.locator('[contenteditable="true"]')).toBeVisible();
    await expect(page.locator('[data-picture-crop]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await settled(page);
    await page.mouse.click(toScreen(centre(oval)).x, toScreen(centre(oval)).y);
    await page.getByRole('tab', { name: 'Aussehen' }).click();
    await page.getByRole('button', { name: 'Ebene bearbeiten' }).first().click();
    await settled(page);
    const right = { x: oval.x + oval.w * 0.82, y: oval.y + oval.h * 0.5 };
    const word = { ...centre(oval), r: 12 };
    const frames = await record(page, decoder, [right, word, greenAt], async () => {
      await page.getByRole('radio', { name: 'Strecken' }).click();
    });
    const shown = staysOnceShown(frames, 0, hex(PURPLE), 'ellipse stretched');
    const ms = (frames[shown]!.at - lastReleased) * 1000;
    console.info(
      `ellipse fill: stretched shown ${ms.toFixed(0)} ms after the click (frame ${shown})`,
    );
    expect(ms, `ellipse fill not at once${trail(frames, 0)}`).toBeLessThan(150);
    neverBack(frames, 0, hex(ORANGE), 'ellipse before it was stretched', shown);
    const pale = frames.findIndex((frame) => frame.colors[1]!.reduce((a, b) => a + b, 0) > 300);
    expect(pale, `ellipse text gone in frame ${pale}${trail(frames, 1)}`).toBe(-1);
    stable(frames, 2, 'untouched box');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await settled(page);
    // The shape without text stretched, then typed in (a double click opens „Ausschnitt“, ↵ takes
    // it and starts the text): nothing chosen, so it stays „Strecken“ – in the file and the panel.
    await apply(page, deck.id, [
      {
        ...filled('slpicplain01', plain),
        fills: [{ ...filled('slpicplain01', plain).fills[0], fit: 'stretch' }],
      },
    ]);
    await settled(page);
    await page.mouse.dblclick(toScreen(centre(plain)).x, toScreen(centre(plain)).y);
    await expect(page.locator('[data-picture-crop="slpicplain01"]')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('[contenteditable="true"]')).toBeVisible();
    await page.keyboard.type('Go');
    await page.keyboard.press('Escape');
    await settled(page);
    const typed = (await editState(page, deck.id)).slides
      .flatMap((slide) => slide.elements)
      .find((element) => element.id === 'slpicplain01') as unknown as {
      look: { fills: { fit: string }[] };
    };
    expect(typed.look.fills[0]?.fit, 'stretched fill typed in').toBe('stretch');
    await page.mouse.click(toScreen(centre(plain)).x, toScreen(centre(plain)).y);
    await page.getByRole('tab', { name: 'Aussehen' }).click();
    await page.getByRole('button', { name: 'Ebene bearbeiten' }).first().click();
    await expect(page.getByRole('radio', { name: 'Strecken' })).toBeChecked();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await settled(page);
  }

  // 19. Offline: the green box moved, undone (⌘Z) and done again (⇧⌘Z) without a connection –
  // each at once (the first frame may be the one before the key), in the browser; back online, the server has it where it ended, nothing blinks.
  {
    shownAt = await slideRect(page);
    await page.context().setOffline(true);
    const from = centre(green);
    const to = { x: from.x - 0.25, y: from.y };
    const newAt = { x: greenAt.x - 0.25, y: greenAt.y };
    const moved = await record(page, decoder, [greenAt, newAt], async () => {
      const a = toScreen(from);
      const b = toScreen(to);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) {
        await page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10);
      }
      await page.mouse.up();
    });
    const shown = staysOnceShown(moved, 1, hex(GREEN), 'offline: moved box at its new place');
    neverBack(moved, 0, hex(GREEN), 'offline: moved box at its old place', shown);
    const undone = await record(page, decoder, [greenAt, newAt], async () => {
      await page.keyboard.press('Meta+z');
    });
    expect(
      staysOnceShown(undone, 0, hex(GREEN), 'offline: undone box back'),
      'undo at once',
    ).toBeLessThanOrEqual(1);
    neverBack(undone, 1, hex(GREEN), 'offline: undone box at the place it left');
    const redone = await record(page, decoder, [greenAt, newAt], async () => {
      await page.keyboard.press('Meta+Shift+z');
    });
    expect(
      staysOnceShown(redone, 1, hex(GREEN), 'offline: redone box'),
      'redo at once',
    ).toBeLessThanOrEqual(1);
    neverBack(redone, 0, hex(GREEN), 'offline: redone box at its old place');
    // Back online: the queued edits go out – the box stays where it is in every frame.
    const back = await record(page, decoder, [greenAt, newAt], async () => {
      await page.context().setOffline(false);
    });
    always(back, 1, hex(GREEN), 'box after reconnecting');
    neverBack(back, 0, hex(GREEN), 'box at its old place after reconnecting');
    await expect
      .poll(
        async () =>
          (await editState(page, deck.id)).slides[0]!.elements.find(
            (element) => element.id === 'slgreenbox01',
          )?.bbox.x ?? -1,
        { timeout: 30_000 },
      )
      .toBeCloseTo(green.x - 0.25, 2);
  }
}

/** The last {@link dragEnd}: how many frames while dragged showed the probe in a new colour. */
let lastDrag = { changed: 0 };

/**
 * A gradient's end (its handle over the slide) dragged a third of the way towards `toward` (of
 * the slide, its middle unless said) in 20 steps: the frames from the release on, and how often the first point changed while dragged.
 */
async function dragEnd(
  page: Page,
  decoder: Page,
  points: At[],
  toward: At = { x: 0.5, y: 0.5 },
): Promise<Frame[]> {
  const handle = page
    .locator('[data-gradient-handles] circle')
    .filter({ has: page.locator('title', { hasText: 'Ende verschieben' }) });
  const grip = (await handle.boundingBox())!;
  expect(grip, 'gradient end shown').toBeTruthy();
  const a = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
  const middle = { x: shownAt.x + toward.x * shownAt.w, y: shownAt.y + toward.y * shownAt.h };
  const b = { x: a.x + (middle.x - a.x) / 3, y: a.y + (middle.y - a.y) / 3 };
  const rect = await slideRect(page);
  const probe = {
    x: Math.round(rect.x + points[0]!.x * rect.w),
    y: Math.round(rect.y + points[0]!.y * rect.h),
  };
  const colours: string[] = [];
  const frames = await record(page, decoder, points, async () => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(a.x + ((b.x - a.x) * i) / 20, a.y + ((b.y - a.y) * i) / 20);
      // What the probe shows now (the page's own pixels, as drawn this frame).
      const shot = await page.screenshot({ clip: { ...probe, width: 1, height: 1 } });
      colours.push(shot.toString('base64'));
    }
    await page.mouse.up();
  });
  lastDrag = { changed: colours.filter((colour, i) => i > 0 && colour !== colours[i - 1]).length };
  return frames;
}

/** A 64 × 48 picture of two colours, left and right, uploaded to the deck: its image id. */
async function uploadPicture(page: Page, decoder: Page, deckId: string, [left, right]: string[]) {
  const png = await decoder.evaluate(
    async ([left, right]) => {
      const canvas = new OffscreenCanvas(64, 48);
      const context = canvas.getContext('2d')!;
      context.fillStyle = left!;
      context.fillRect(0, 0, 32, 48);
      context.fillStyle = right!;
      context.fillRect(32, 0, 32, 48);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return btoa(String.fromCharCode(...bytes));
    },
    [left, right],
  );
  const uploaded = await page.request.post(`/api/decks/${deckId}/edit/images`, {
    multipart: {
      file: { name: 'two.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
    },
  });
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  return ((await uploaded.json()) as { imageId: string }).imageId;
}

/** The colour of one point of the slide on `page` now (its own pixels). */
async function pixelAt(page: Page, decoder: Page, point: At): Promise<Rgb> {
  const rect = await slideRect(page);
  const clip = {
    x: Math.round(rect.x + point.x * rect.w),
    y: Math.round(rect.y + point.y * rect.h),
    width: 1,
    height: 1,
  };
  const data = (await page.screenshot({ clip })).toString('base64');
  return decoder.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return [r!, g!, b!] as Rgb;
  }, data);
}

/** Drags on `page` from `a` to `b` (of the slide) in `steps`, `pause` ms between them. */
async function drag(page: Page, a: At, b: At, steps = 10, pause = 0, release = true) {
  const rect = await slideRect(page);
  const at = (point: At) => ({ x: rect.x + point.x * rect.w, y: rect.y + point.y * rect.h });
  const from = at(a);
  const to = at(b);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    );
    if (pause) await page.waitForTimeout(pause);
  }
  if (release) await page.mouse.up();
}

const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
};

/*
 * Two editors in one deck (two tabs: the editor tells them apart by tab, as two people): what one
 * does shows on the other's slide at once – drawn by the browser from the step (CLAUDE.md §1
 * „Someone else's edits draw in the same frame“), the other's own edits never jumping back, and
 * no stale or blank frame there either.
 */
test('two editors see each other at once', async ({ page, browser }) => {
  test.slow();
  test.setTimeout(300_000);
  const decoder = await browser.newPage();
  const other = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'de-DE',
  });
  const b = await other.newPage();
  await together(page, b, decoder);
  await other.close();
  await decoder.close();
});

async function together(a: Page, b: Page, decoder: Page) {
  const created = await a.request.post('/api/decks/blank', { data: {} });
  expect(created.status()).toBe(201);
  const deck = (await created.json()) as Deck;
  await expect
    .poll(async () => (await editState(a, deck.id)).slides?.length ?? 0, { timeout: 60_000 })
    .toBeGreaterThan(0);
  const pageId = (await editState(a, deck.id)).slides[0]!.pageId;
  let red: Box = { x: 0.1, y: 0.4, w: 0.2, h: 0.25 };
  const green: Box = { x: 0.75, y: 0.7, w: 0.15, h: 0.15 };
  const shape = (id: string, box: Box, fill: string) => ({
    type: 'addElement',
    pageId,
    elementId: id,
    kind: 'rect',
    shape: 'rectangle',
    box,
    fill,
    stroke: null,
    paragraphs: [],
  });
  const text: Box = { x: 0.08, y: 0.08, w: 0.4, h: 0.14 };
  const shadowed: Box = { x: 0.8, y: 0.05, w: 0.1, h: 0.1 };
  await apply(a, deck.id, [
    {
      type: 'addElement',
      pageId,
      elementId: 'sltextbox01',
      kind: 'text',
      box: text,
      fill: null,
      stroke: null,
      paragraphs: [
        {
          align: 'left',
          runs: [
            {
              text: 'Hallo',
              font: 'Inter',
              size: 40,
              color: '#111111',
              bold: true,
              italic: false,
              underline: false,
            },
          ],
        },
      ],
    },
    shape('slredbox01', red, RED),
    shape('slgreenbox01', green, GREEN),
    // LibreOffice draws it (a shadow): its picture must show as the editor opens.
    shape('slshadowed01', shadowed, PURPLE),
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
  for (const page of [a, b]) {
    await page.addInitScript(() =>
      localStorage.setItem('slider.workPreferences.v1', JSON.stringify({ autoZoom: false })),
    );
    await page.goto(`/d/${deck.id}`);
    await page.getByRole('radio', { name: 'Bearbeiten' }).click();
    await settled(page);
    await expect(page.locator('[data-compose-shown]')).toBeVisible({ timeout: 30_000 });
  }
  // An element LibreOffice draws shows from its picture as the editor opens (its first picture,
  // decoded after the slide was composed, once stayed an empty frame).
  for (const page of [a, b]) {
    await expect
      .poll(
        async () =>
          near(
            await pixelAt(page, decoder, { x: shadowed.x + 0.03, y: shadowed.y + 0.03 }),
            hex(PURPLE),
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
  }
  // The untouched green box on B's slide: never moves or vanishes while A edits.
  const greenAt = { x: green.x + 0.03, y: green.y + 0.03 };
  const element = async (id: string) =>
    (
      (await (await a.request.get(`/api/decks/${deck.id}/edit`)).json()) as {
        slides: {
          elements: (EditState['slides'][number]['elements'][number] & {
            look: { fill: string | null } | null;
          })[];
        }[];
      }
    ).slides[0]!.elements.find((item) => item.id === id);

  // a. A moves the box ten times (up, down, …): on B it is at its new place in a frame of its own
  // right after the step, never back at its old one; the time from A's release to B's pixels.
  const latencies: number[] = [];
  for (let i = 0; i < 10; i++) {
    const dy = i % 2 === 0 ? -0.2 : 0.2;
    const from = red;
    const to = { ...red, y: red.y + dy };
    const oldOnly = { x: from.x + from.w / 2, y: dy < 0 ? from.y + from.h - 0.03 : from.y + 0.03 };
    const newOnly = { x: to.x + to.w / 2, y: dy < 0 ? to.y + 0.03 : to.y + to.h - 0.03 };
    const frames = await record(
      b,
      decoder,
      [oldOnly, newOnly, greenAt],
      async () => {
        await drag(a, centre(from), centre(to));
      },
      REMOTE_MS,
    );
    const shown = staysOnceShown(frames, 1, hex(RED), `B: moved box at its new place (${i})`);
    neverBack(frames, 0, hex(RED), `B: moved box at its old place (${i})`, shown);
    stable(frames, 2, 'B: untouched box');
    latencies.push((frames[shown]!.at - lastReleased) * 1000);
    red = to;
    await settled(a);
  }
  console.info(
    `together: A's move on B after ${quantile(latencies, 0.5).toFixed(0)} ms (p50), ${quantile(latencies, 0.95).toFixed(0)} ms (p95) – ${latencies.map((ms) => ms.toFixed(0)).join(', ')}`,
  );
  expect(quantile(latencies, 0.5), 'A’s move on B, p50 (ms)').toBeLessThan(100);

  // b. A drags slowly: B sees it on its way (A's presence), then at the end – no jump back.
  {
    const from = red;
    const to = { ...red, x: red.x + 0.3 };
    // Covered only while on its way: right of where it was, left of where it goes.
    const between = { x: from.x + 0.25, y: from.y + from.h / 2 };
    const oldOnly = { x: from.x + 0.03, y: from.y + from.h / 2 };
    const newOnly = { x: to.x + to.w - 0.03, y: to.y + to.h / 2 };
    const frames = await record(
      b,
      decoder,
      [between, oldOnly, newOnly, greenAt],
      async () => {
        await drag(a, centre(from), centre(to), 12, 80);
      },
      REMOTE_MS,
      true,
    );
    const released = frames.findIndex((frame) => frame.at >= lastReleased);
    const onItsWay = frames
      .slice(0, released < 0 ? frames.length : released)
      .some((frame) => near(frame.colors[0]!, hex(RED)));
    expect(onItsWay, `B: A's drag not seen on its way${trail(frames, 0)}`).toBe(true);
    const shown = staysOnceShown(frames, 2, hex(RED), 'B: dragged box at its end');
    neverBack(frames, 1, hex(RED), 'B: dragged box back at its start', shown);
    stable(frames, 3, 'B: untouched box');
    red = to;
    await settled(a);
  }

  // c. A picks the box: on B a frame in A's colour with A's name; let go, it goes.
  {
    await a.keyboard.press('Escape');
    await expect(b.locator('[data-peer-pick="slredbox01"]')).toHaveCount(0);
    const rect = await slideRect(a);
    await a.mouse.click(rect.x + centre(red).x * rect.w, rect.y + centre(red).y * rect.h);
    const pick = b.locator('[data-peer-pick="slredbox01"]');
    await expect(pick).toBeVisible({ timeout: REMOTE_MS });
    await expect(pick).not.toHaveText('');
    await a.keyboard.press('Escape');
    await expect(pick).toHaveCount(0, { timeout: REMOTE_MS });
  }

  // d. At once, A moves the green box and B recolours it: both stay – on both screens, in the file.
  {
    // Up, out of the way of the red box's places below.
    const from = green;
    const to = { ...green, y: green.y - 0.4 };
    await drag(a, centre(from), centre(to), 10, 20, false);
    await apply(b, deck.id, [{ type: 'setShapeStyle', elementId: 'slgreenbox01', fill: PURPLE }]);
    await a.mouse.up();
    const inside = { x: to.x + 0.03, y: to.y + 0.03 };
    for (const page of [a, b]) {
      await expect
        .poll(async () => near(await pixelAt(page, decoder, inside), hex(PURPLE)), {
          timeout: REMOTE_MS,
        })
        .toBe(true);
    }
    // A's step may still be on its way: both in the file once it is in.
    await expect
      .poll(async () => (await element('slgreenbox01'))?.bbox.y ?? -1, { timeout: REMOTE_MS })
      .toBeCloseTo(to.y, 2);
    expect((await element('slgreenbox01'))?.look?.fill?.toLowerCase()).toBe(PURPLE);
    await settled(a);
    await settled(b);
  }

  // e. Both put the box somewhere at once: both screens end where the server's last step has it,
  // and once there it never flips back.
  {
    const left = { ...red, x: 0.05 };
    const right = { ...red, x: 0.45 };
    const leftOnly = { x: left.x + 0.03, y: left.y + left.h / 2 };
    const rightOnly = { x: right.x + right.w - 0.03, y: right.y + right.h / 2 };
    const frames = await record(
      b,
      decoder,
      [leftOnly, rightOnly, greenAt],
      async () => {
        const { seq } = await editState(a, deck.id);
        await Promise.all(
          [
            [a, left],
            [b, right],
          ].map(([page, box]) =>
            (page as Page).request.post(`/api/decks/${deck.id}/edit/operations`, {
              data: {
                operations: [{ type: 'setBox', elementId: 'slredbox01', box }],
                baseSeq: seq,
              },
            }),
          ),
        );
      },
      REMOTE_MS,
    );
    const stored = await element('slredbox01');
    const won = Math.abs(stored!.bbox.x - left.x) < 0.01 ? 0 : 1;
    const shown = staysOnceShown(frames, won, hex(RED), 'B: the box where the server has it');
    const flips = frames.slice(shown).findIndex((frame) => near(frame.colors[1 - won]!, hex(RED)));
    expect(
      flips,
      `B: the box flipped back in frame ${shown + flips}${trail(frames, 1 - won)}`,
    ).toBe(-1);
    const winner = won === 0 ? leftOnly : rightOnly;
    await expect
      .poll(async () => near(await pixelAt(a, decoder, winner), hex(RED)), { timeout: REMOTE_MS })
      .toBe(true);
    red = won === 0 ? left : right;
    await settled(a);
    await settled(b);
  }

  // f. B drags the box while A's recolour comes in: B's box stays under B's pointer, the new
  // colour shows on it, its old place never shows it again.
  {
    const from = red;
    const to = { ...red, y: red.y + 0.2 };
    const oldOnly = { x: from.x + from.w / 2, y: from.y + 0.03 };
    const newOnly = { x: to.x + to.w / 2, y: to.y + to.h - 0.03 };
    const frames = await record(
      b,
      decoder,
      [oldOnly, newOnly, greenAt],
      async () => {
        await drag(b, centre(from), centre(to), 10, 20, false);
        await apply(a, deck.id, [{ type: 'setShapeStyle', elementId: 'slredbox01', fill: ORANGE }]);
        await expect
          .poll(async () => near(await pixelAt(b, decoder, newOnly), hex(ORANGE)), {
            timeout: REMOTE_MS,
          })
          .toBe(true);
        await b.mouse.up();
      },
      REMOTE_MS,
      true,
    );
    const moved = frames.findIndex(
      (frame) => near(frame.colors[1]!, hex(RED)) || near(frame.colors[1]!, hex(ORANGE)),
    );
    expect(
      moved,
      `B: dragged box never at its new place${trail(frames, 1)}`,
    ).toBeGreaterThanOrEqual(0);
    const back = frames
      .slice(moved)
      .findIndex(
        (frame) => near(frame.colors[0]!, hex(RED)) || near(frame.colors[0]!, hex(ORANGE)),
      );
    expect(
      back,
      `B: dragged box back at its old place in frame ${moved + back}${trail(frames, 0)}`,
    ).toBe(-1);
    staysOnceShown(frames, 1, hex(ORANGE), 'B: new colour on the dragged box');
    stable(frames, 2, 'B: untouched box');
    await expect
      .poll(async () => (await element('slredbox01'))?.bbox.y ?? -1, { timeout: REMOTE_MS })
      .toBeCloseTo(to.y, 2);
    expect((await element('slredbox01'))?.look?.fill?.toLowerCase()).toBe(ORANGE);
    await settled(a);
    await settled(b);
  }

  // g. Both type in the text box at once, one taking the bold off all of it meanwhile: both
  // screens show the same text, the file too.
  {
    for (const page of [a, b]) {
      const rect = await slideRect(page);
      await page.mouse.dblclick(rect.x + centre(text).x * rect.w, rect.y + centre(text).y * rect.h);
      await page.waitForTimeout(400);
      await page.keyboard.press('End');
    }
    await Promise.all([
      (async () => {
        await a.keyboard.type(' abc', { delay: 80 });
        await a.keyboard.press('Meta+a');
        await a.keyboard.press('Meta+b');
      })(),
      b.keyboard.type(' XYZ', { delay: 70 }),
    ]);
    // What each screen's editor shows: its characters, each with its weight.
    const written = (page: Page) =>
      page.evaluate(() => {
        const box = document.querySelector<HTMLElement>('[role="group"] [contenteditable="true"]');
        if (!box) return '';
        const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
        let out = '';
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const weight =
            Number(getComputedStyle(node.parentElement!).fontWeight) >= 600 ? 'B' : 'n';
          out += [...(node.textContent ?? '')].map((char) => `${char}${weight}`).join('');
        }
        return out;
      });
    await expect
      .poll(async () => (await written(a)) === (await written(b)) && (await written(a)) !== '', {
        timeout: REMOTE_MS,
      })
      .toBe(true);
    const typed = (await written(a)).replace(/[Bn]/g, '');
    expect(typed).toContain('abc');
    expect(typed).toContain('XYZ');
    for (const page of [a, b]) await page.keyboard.press('Escape');
    await expect
      .poll(
        async () =>
          (
            (await element('sltextbox01')) as { paragraphs?: string[] } | undefined
          )?.paragraphs?.join('\n'),
        {
          timeout: REMOTE_MS * 3,
        },
      )
      .toBe(typed);
    for (const page of [a, b]) {
      await page.keyboard.press('Escape');
      await settled(page);
    }
  }

  // h. A copies slides, moves one in front of B's and deletes them: B's slide overview has each at
  // once – B's own refetch held back, so only the step itself can show it – and B's slide stays
  // where it is on screen (the track scrolls by the slide put in front of it), never fading anew.
  {
    const held: (() => void)[] = [];
    await b.route(/\/api\/decks\/[^/]+\/(edit|slides)(\?.*)?$/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await new Promise<void>((resolve) => held.push(resolve));
      await route.fallback();
    });
    const thumbs = () =>
      b.evaluate(() =>
        [...document.querySelectorAll('[data-thumb]')].map((el) => el.getAttribute('data-thumb')),
      );
    const first = (await thumbs())[0]!;
    const copy = (n: number) => `pending:slcopyslide0${n}`;
    const at = { timeout: 1500, intervals: [20] };
    // Two copies behind it first: room for the track to scroll by one put in front.
    await apply(a, deck.id, [
      { type: 'duplicateSlide', pageId, newPageId: 'slcopyslide01', after: pageId },
      { type: 'duplicateSlide', pageId, newPageId: 'slcopyslide02', after: 'slcopyslide01' },
    ]);
    await expect.poll(thumbs, at).toEqual([first, copy(1), copy(2)]);
    await settled(b);
    // B's slide on screen, by its id (the copies show its picture until theirs come).
    const ownAt = () =>
      b.evaluate(
        (id) =>
          document.querySelector(`[data-slide-frame="${id}"]`)?.getBoundingClientRect().x ?? null,
        first,
      );
    const before = await ownAt();
    expect(before).not.toBeNull();
    const frames = await record(
      b,
      decoder,
      [greenAt],
      async () => {
        await apply(a, deck.id, [{ type: 'moveSlide', pageId: 'slcopyslide02', after: null }]);
        await expect.poll(thumbs, at).toEqual([copy(2), first, copy(1)]);
        await b.waitForTimeout(300);
      },
      0,
      true,
    );
    stable(frames, 0, 'B: its slide while A changes the slides');
    expect(await ownAt(), 'B: its slide stays where it is on screen').toBeCloseTo(before!, 0);
    await apply(a, deck.id, [
      { type: 'deleteSlide', pageId: 'slcopyslide01' },
      { type: 'deleteSlide', pageId: 'slcopyslide02' },
    ]);
    await expect.poll(thumbs, at).toEqual([first]);
    await b.unroute(/\/api\/decks\/[^/]+\/(edit|slides)(\?.*)?$/);
    for (const release of held) release();
    await expect.poll(thumbs, { timeout: REMOTE_MS }).toEqual([first]);
    await settled(b);
  }
}
