import { expect, openDeck, SAMPLE_SLIDES, shot, test, uploadSampleDeck } from '../support';

test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: [
      '--no-proxy-server',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  },
});

test('slides can be navigated with the keyboard', async ({ page }) => {
  const deck = await uploadSampleDeck(page);
  await openDeck(page, deck.id);
  const counter = page.getByRole('textbox', { name: 'Aktuelle Folie, 1 bis 5' });
  const slideParam = async () => new URL(page.url()).searchParams.get('slide');
  await expect(counter).toHaveValue('1');

  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveValue('2');
  await expect(page.getByText('Folie 2 von 5', { exact: true })).toBeAttached();
  const second = await slideParam();

  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveValue('3');
  await page.keyboard.press('ArrowLeft');
  await expect(counter).toHaveValue('2');
  await expect.poll(slideParam).toBe(second);

  await page.keyboard.press('End');
  await expect(counter).toHaveValue('5');
  await expect(page.getByRole('img', { name: SAMPLE_SLIDES[4] })).toBeInViewport();
  // Past the last slide nothing happens.
  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveValue('5');

  await page.keyboard.press('Home');
  await expect(counter).toHaveValue('1');
  await expect(page.getByRole('img', { name: SAMPLE_SLIDES[0] })).toBeInViewport();

  // Typing a number into the counter jumps there.
  await counter.fill('4');
  await counter.press('Enter');
  await expect(counter).toHaveValue('4');
  await expect(page.getByRole('img', { name: SAMPLE_SLIDES[3] })).toBeInViewport();

  // A right click on „Präsentieren“ chooses the presenter view: the slide shown, the next one,
  // the notes; the slide show's keys step through it, Esc ends it on the slide it was on.
  // (The track may still be gliding to slide 4: a scroll closes a menu, so open it again.)
  await expect(async () => {
    await page.getByRole('button', { name: 'Präsentieren' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Referentenansicht' }).click({ timeout: 2_000 });
  }).toPass();
  const presenter = page.getByRole('dialog', { name: /^Referentenansicht/ });
  const shown = presenter.getByRole('region', { name: 'Aktuelle Folie' });
  const next = presenter.getByRole('region', { name: 'Nächste Folie' });
  await expect(presenter.getByText('Folie 4 von 5', { exact: true })).toBeVisible();
  await expect(shown.getByRole('img', { name: 'Folie 4' })).toBeVisible();
  await expect(next.getByRole('img', { name: 'Folie 5' })).toBeVisible();
  await expect(presenter.getByRole('region', { name: 'Notizen' })).toBeVisible();
  // The stopwatch waits at 0:00 for ▶.
  const timer = presenter.getByRole('timer', { name: 'Vergangene Zeit' });
  await expect(timer).toHaveText('0:00');
  await expect(presenter.getByRole('button', { name: 'Zeit zurücksetzen' })).toBeDisabled();
  await presenter.getByRole('button', { name: 'Zeit starten' }).click();
  await expect(presenter.getByRole('button', { name: 'Zeit anhalten' })).toBeVisible();
  await expect(presenter.getByRole('button', { name: 'Publikum öffnen' })).toBeVisible();
  await presenter.getByRole('button', { name: 'Aufnehmen', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Ohne Kamera' }).click();
  await expect(presenter.getByText('Aufnahme läuft')).toBeVisible();
  // A drag on the slide draws a box (no comment); Esc clears it before it ends anything.
  const layer = shown.locator('[data-show-boxes]');
  const area = (await layer.boundingBox())!;
  await page.mouse.move(area.x + area.width * 0.2, area.y + area.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * 0.5, area.y + area.height * 0.6, { steps: 4 });
  await page.mouse.up();
  await expect(layer.locator('[style*="opacity"]')).toHaveCount(1);
  await expect(presenter.getByText('Folie 4 von 5', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(layer.locator('[style*="opacity"]')).toHaveCount(0);
  await expect(presenter).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(presenter.getByText('Folie 5 von 5', { exact: true })).toBeVisible();
  await expect(shown.getByRole('img', { name: 'Folie 5' })).toBeVisible();
  await expect(next.getByText('Ende der Präsentation')).toBeVisible();
  await shot(page, 'presenter-view');
  // Past the last slide: the overview takes the next slide's pane – time per slide, the ones
  // never shown; ending goes straight back to the deck, nothing pops up.
  await page.keyboard.press('ArrowRight');
  const overview = presenter.getByRole('region', { name: 'Übersicht' });
  await expect(overview.locator('[data-summary-row]')).toHaveCount(5);
  await expect(overview.getByText('nicht gezeigt', { exact: true })).toHaveCount(3);
  await expect(overview.getByText(/3 Folien nicht gezeigt/)).toBeVisible();
  await presenter.getByRole('button', { name: 'Referentenansicht beenden' }).click();
  await expect(presenter).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Übersicht' })).toHaveCount(0);
  await expect(counter).toHaveValue('5');
  // ⌥P opens it as well.
  await page.keyboard.press('Alt+KeyP');
  await expect(presenter.getByText('Folie 5 von 5', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(presenter).toBeHidden();

  // The run is kept: „Durchgänge“ in the deck's menu shows it, as „Speicherplatz“ does.
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  const card = page.locator(`[data-select-id="${deck.id}"]`);
  await card.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Durchgänge …' }).click();
  const lastRun = page.getByRole('region', { name: 'Durchgänge' });
  await expect(lastRun.locator('[data-summary-row]')).toHaveCount(5);
  await expect(lastRun.getByText(/3 Folien nicht gezeigt/)).toBeVisible();
  await expect(lastRun.locator('video')).toBeVisible();
  await expect
    .poll(() => lastRun.locator('video').evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(2);
  await lastRun.locator('video').evaluate(async (video: HTMLVideoElement) => {
    await video.play();
  });
  await expect
    .poll(() => lastRun.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(0);
  await lastRun.locator('video').evaluate((video: HTMLVideoElement) => video.pause());
  await shot(page, 'last-run');
  await lastRun.getByRole('button', { name: 'Schließen' }).click();
  await expect(lastRun).toBeHidden();

  // Permission arriving after closing must never leave the microphone recording.
  await openDeck(page, deck.id);
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const state = window as unknown as { delayedMic: { stream: MediaStream; release: () => void } };
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      await new Promise<void>((resolve) => {
        state.delayedMic = { stream, release: resolve };
      });
      return stream;
    };
  });
  await page.keyboard.press('Alt+KeyP');
  await presenter.getByRole('button', { name: 'Aufnehmen', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Ohne Kamera' }).click();
  await page.waitForFunction(() =>
    Boolean((window as unknown as { delayedMic?: unknown }).delayedMic),
  );
  await presenter.getByRole('button', { name: 'Referentenansicht beenden' }).click();
  await page.evaluate(() =>
    (window as unknown as { delayedMic: { release: () => void } }).delayedMic.release(),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { delayedMic: { stream: MediaStream } }).delayedMic.stream
          .getTracks()
          .every((track) => track.readyState === 'ended'),
      ),
    )
    .toBe(true);
});

test('the viewer works at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const deck = await uploadSampleDeck(page);
  await openDeck(page, deck.id);
  await expect(page.getByRole('img', { name: SAMPLE_SLIDES[0] })).toBeInViewport();
  await shot(page, 'viewer-375');
});
