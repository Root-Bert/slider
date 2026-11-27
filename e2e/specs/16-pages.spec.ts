import { expect, shot, test } from '../support';

// Leaving a diagram's editor sends its last save as the page goes (a fetch the browser may cut).
test.use({ allowConsoleErrors: [/ERR_NETWORK_IO_SUSPENDED/] });

// To the end of the line: ⌘→ on a Mac, End elsewhere (CI runs on Linux, where ⌘→ does nothing).
const LINE_END = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End';

test('a page reads first, Bearbeiten writes back only what changed; areas open on their Startseite, Seiten opens on one’s own', async ({
  page,
}) => {
  const [workspace] = (await (await page.request.get('/api/workspaces')).json()) as {
    id: string;
  }[];
  const upload = async (name: string, body: string) => {
    const made = await page.request.post(
      `/api/workspaces/${workspace!.id}/cloud/files?name=${encodeURIComponent(name)}&keepBoth=1`,
      { data: body, headers: { 'Content-Type': 'text/markdown; charset=utf-8' } },
    );
    expect(made.status()).toBe(201);
    return ((await made.json()) as { node: { id: string } }).node.id;
  };
  const sub = await upload('Protokolle.md', '# Protokolle\n\nAlles von den Treffen.\n');
  const seeded = (await (
    await page.request.post('/api/diagrams', {
      data: {
        workspaceId: workspace!.id,
        title: 'Ablauf',
        diagram: {
          format: 'slider-diagram',
          version: 1,
          nodes: [
            { id: 'ask', shape: 'rounded', x: 0, y: 0, width: 160, height: 56, text: 'Anfrage' },
            { id: 'offer', shape: 'pill', x: 260, y: 0, width: 160, height: 56, text: 'Angebot' },
          ],
          edges: [{ id: 'e1', from: 'ask', to: 'offer', label: 'passt' }],
        },
      },
    })
  ).json()) as { id: string };
  const FILE = [
    '# Willkommen im Team',
    '',
    'Hier steht, **wie wir arbeiten** und wo was liegt.',
    '',
    `[[file:${sub}|Protokolle.md]]`,
    '',
    '## Regeln',
    '',
    '- Kurz schreiben',
    '- Freundlich bleiben',
    '',
    '- [ ] Onboarding lesen',
    '- [x] Konto anlegen',
    '',
    '> [!NOTE]',
    '> Fragen gehen in den Chat.',
    '',
    '| Wer | Was |',
    '|---|---|',
    '| Anna | Vertrieb |',
    '',
    '```mermaid',
    'flowchart LR',
    '  A[Anfrage] -->|ja| B{Passt?}',
    '```',
    '',
    `[[file:${seeded.id}|Ablauf.diagram]]`,
    '',
    '---',
    '',
    '{{dateien}}',
    '',
    'Ende',
    '',
  ].join('\n');
  const id = await upload('Willkommen.md', FILE);

  await page.goto(`/w/${workspace!.id}/dateien/seite/${id}`);
  const body = page.locator('.page-body');
  await expect(body).toContainText('Willkommen im Team');
  await expect(body).toHaveAttribute('contenteditable', 'false');
  // A flowchart in a ```mermaid block is drawn in the page.
  await expect(page.getByRole('img', { name: 'Diagramm' })).toContainText('Passt?');
  // A diagram from Cloud, its link alone on a line, drawn where it stands.
  const embeds = page.locator('.page-diagram-embed');
  await expect(embeds.first()).toContainText('Angebot');
  await shot(page, 'page-read');
  const agent = page.getByRole('region', { name: 'Agent' });
  await expect(agent).toHaveCount(0);

  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await expect(body).toHaveAttribute('contenteditable', 'true');
  // Bearbeiten: the agent bar floats at the bottom – typed into, a file or a video put on it.
  const ask = agent.getByRole('textbox', { name: 'An die KI' });
  await expect(agent.getByRole('button', { name: 'An die KI senden' })).toBeDisabled();
  await ask.fill('Mach eine Liste daraus');
  await expect(agent.getByRole('button', { name: 'An die KI senden' })).toBeEnabled();
  await expect(agent.getByRole('button', { name: 'Datei anhängen' })).toBeVisible();
  await ask.fill('');
  // A block picked whole; a click into the text after it puts the caret there at once.
  await page.locator('.page-diagram').click();
  await expect(page.getByRole('button', { name: 'In Diagramm umwandeln' })).toBeVisible();
  await body.getByText('Ende', { exact: true }).click();
  await page.keyboard.press(LINE_END);
  await page.keyboard.type(' – ergänzt');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await expect(page.getByRole('listbox', { name: 'Blöcke' })).toBeVisible();
  await shot(page, 'page-slash');
  await page.keyboard.type('über');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Neuer Abschnitt');

  type Opened = { content: { blocks: { id: string; runs?: { text: string }[] }[] } };
  const lines = async () =>
    ((await (await page.request.get(`/api/documents/${id}`)).json()) as Opened).content.blocks.map(
      (block) => (block.runs ?? []).map((run) => run.text).join(''),
    );
  await expect.poll(lines, { timeout: 10_000 }).toContain('# Neuer Abschnitt');
  const saved = await lines();
  // Everything before „Ende“ is as it was written.
  const before = FILE.split('\n');
  expect(saved.slice(0, before.indexOf('Ende'))).toEqual(before.slice(0, before.indexOf('Ende')));
  expect(saved).toContain('Ende – ergänzt');
  await shot(page, 'page-edit');

  // Esc closes an open menu first, then ends Bearbeiten.
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await expect(page.getByRole('listbox', { name: 'Blöcke' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox', { name: 'Blöcke' })).toBeHidden();
  await expect(body).toHaveAttribute('contenteditable', 'true');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');
  await expect(body).toHaveAttribute('contenteditable', 'false');
  await expect(page.getByRole('button', { name: 'Bearbeiten' })).toBeVisible();
  await expect(agent).toHaveCount(0);
  await page.reload();
  await expect(body).toContainText('Neuer Abschnitt');

  // The diagram on the page opens in its editor; closing it comes back.
  await embeds.first().click();
  await expect(page).toHaveURL(new RegExp(`/diagramm/${seeded.id}`));
  await page.getByRole('button', { name: 'Diagramm schließen' }).click();
  await expect(page).toHaveURL(new RegExp(`/seite/${id}`));
  // Bearbeiten: the Mermaid flowchart turns into a diagram of its own; „/Diagramm“ makes a new one
  // under the line and opens it to be drawn.
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await page.locator('.page-diagram').click();
  await page.getByRole('button', { name: 'In Diagramm umwandeln' }).click();
  await expect(embeds).toHaveCount(2);
  await expect(page.locator('.page-diagram')).toHaveCount(0);
  await body.getByText('Neuer Abschnitt', { exact: true }).click();
  await page.keyboard.press(LINE_END);
  await page.keyboard.press('Enter');
  await page.keyboard.type('/diagramm');
  await expect(page.getByRole('option', { name: 'Diagramm' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/diagramm\//);
  await expect(page.getByText('Wähle unten eine Form')).toBeVisible();

  // The editor: a box drawn with its tool, the next pulled out of its port, the AI asked – its
  // change one step to undo. Saved as it is drawn.
  const drawnId = new URL(page.url()).pathname.split('/').at(-1)!;
  type Drawn = { diagram: { nodes: { id: string; text: string }[]; edges: unknown[] } };
  const drawing = async () =>
    ((await (await page.request.get(`/api/diagrams/${drawnId}`)).json()) as Drawn).diagram;
  await page.keyboard.press('r');
  await page.mouse.move(420, 320);
  await page.mouse.down();
  await page.mouse.move(600, 400, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.type('Gezeichnet');
  await page.keyboard.press('Escape');
  const box = page.locator('.react-flow__node').filter({ hasText: 'Gezeichnet' });
  await box.hover();
  const port = (await box.locator('.dg-port[data-side="right"]').boundingBox())!;
  await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
  await page.mouse.down();
  await page.mouse.move(port.x + 220, port.y + 10, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.type('Neue Box');
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => {
      const now = await drawing();
      return [now.nodes.map((each) => each.text).sort(), now.edges.length];
    })
    .toEqual([['Gezeichnet', 'Neue Box'], 1]);
  await page.route(/\/api\/diagrams\/[^/]+\/ask$/, (route) =>
    route.fulfill({
      json: {
        changes: [{ type: 'add_box', id: 'archiv', text: 'Archiv', shape: 'cylinder' }],
        tidy: false,
        note: 'Archiv ergänzt.',
      },
    }),
  );
  await page.getByRole('button', { name: 'Mit KI ändern' }).click();
  await page.getByRole('textbox', { name: 'Was soll sich ändern?' }).fill('Ein Archiv dazu');
  await page.keyboard.press('Enter');
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Archiv' })).toBeVisible();
  await expect
    .poll(async () => (await drawing()).nodes.some((each) => each.id === 'archiv'))
    .toBe(true);
  await shot(page, 'diagram-editor');
  await page.keyboard.press('Escape');
  await page.locator('.react-flow__pane').click({ position: { x: 900, y: 120 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(async () => (await drawing()).nodes.some((each) => each.id === 'archiv'))
    .toBe(false);
  // Closed, the page shows it as drawn, under the line it was made on.
  await page.getByRole('button', { name: 'Diagramm schließen' }).click();
  await expect(page).toHaveURL(new RegExp(`/seite/${id}`));
  await expect(embeds).toHaveCount(3);
  await expect(embeds.filter({ hasText: 'Gezeichnet' })).toBeVisible();
  await shot(page, 'page-diagrams');
  const withDiagrams = await lines();
  expect(withDiagrams.filter((line) => line.endsWith('.diagram]]'))).toHaveLength(3);
  expect(withDiagrams.findIndex((line) => line.includes(`[[file:${drawnId}|`))).toBeGreaterThan(
    withDiagrams.indexOf('# Neuer Abschnitt'),
  );
  await page.reload();
  // A page named in the text leads to it, read first.
  await body.getByRole('link', { name: 'Protokolle' }).click();
  await expect(page).toHaveURL(new RegExp(`/seite/${sub}$`));
  await expect(page.locator('.page-body')).toContainText('Alles von den Treffen.');
  // In place, as every link in the app – not in a new tab as well (Lexical's ClickableLinkPlugin).
  expect(page.context().pages()).toHaveLength(1);
  await shot(page, 'page-reloaded');

  // An area opens on its Startseite; before there is one it shows what the first will say.
  await page.goto(`/w/${workspace!.id}/dateien/meine`);
  await page.getByRole('navigation').getByRole('link', { name: 'Mein Workspace' }).first().click();
  await expect(page.getByRole('link', { name: 'Dateien', exact: true }).last()).toBeVisible();
  await expect(page.locator('.page-frame')).toContainText('Aufgaben');
  await shot(page, 'area-home-empty');

  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await expect(body).toHaveAttribute('contenteditable', 'true');
  await page.keyboard.type('Willkommen im Bereich');
  await page.keyboard.press('Escape');
  await expect(body).toHaveAttribute('contenteditable', 'false');
  await shot(page, 'area-home-written');

  // „Dateien“: the area's files, Startseite.md among them.
  await page.getByRole('link', { name: 'Dateien', exact: true }).last().click();
  await expect(page).toHaveURL(/\/bereich\/[^/]+\/dateien$/);
  await expect(page.getByText('Startseite', { exact: true })).toBeVisible();
  await shot(page, 'area-files');
  // „Neu“ › „Neues Diagramm“ makes one here and opens it; closed, it lies among the files.
  await page.getByRole('button', { name: 'Neu', exact: true }).first().click();
  await page.getByRole('button', { name: 'Neues Diagramm' }).click();
  await expect(page).toHaveURL(/\/diagramm\//);
  await expect(page.getByText('Wähle unten eine Form')).toBeVisible();
  await page.getByRole('button', { name: 'Diagramm schließen' }).click();
  await expect(page).toHaveURL(/\/bereich\/[^/]+\/dateien(\?|$)/);
  await page.getByText('Neues Diagramm', { exact: true }).dblclick();
  await expect(page).toHaveURL(/\/diagramm\//);
  await page.getByRole('button', { name: 'Diagramm schließen' }).click();
  await expect(page).toHaveURL(/\/bereich\/[^/]+\/dateien(\?|$)/);

  // „Seiten“: one's own Startseite, no list – before it is written it shows what it would say;
  // „Bearbeiten“ makes it; „/Seite“ makes a page from it, linked where it was typed.
  await page.getByRole('link', { name: 'Seiten', exact: true }).click();
  await expect(page).toHaveURL(/\/dateien\/seiten(\?|$)/);
  await expect(page.locator('[aria-current="page"]', { hasText: 'Meine' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Alle', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Termine' })).toBeVisible();
  await shot(page, 'own-home-empty');
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  const own = page.locator('.page-body[contenteditable="true"]');
  await expect(own).toBeVisible();
  await own.getByRole('heading', { name: 'Aufgaben' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.type('Meine Woche');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await expect(page.getByRole('listbox', { name: 'Blöcke' })).toBeVisible();
  await page.keyboard.type('Seite');
  await expect(page.getByRole('option').first()).toHaveText('Seite');
  await page.keyboard.press('Enter');
  // The page made opens to be named and written; the Startseite kept its link, named as it is now.
  await expect(page).toHaveURL(/\/seite\/[^/?]+\?neu/);
  await expect(page.getByRole('textbox', { name: 'Titel' })).toHaveValue('Neue Seite');
  await page.getByRole('textbox', { name: 'Titel' }).fill('Einkauf');
  await page.getByRole('textbox', { name: 'Titel' }).press('Enter');
  // Drawn by hand („/Zeichnung“): a stroke with the pointer is a stroke on the page, kept.
  await page.keyboard.type('/');
  await expect(page.getByRole('listbox', { name: 'Blöcke' })).toBeVisible();
  await page.keyboard.type('Zeichnung');
  await page.keyboard.press('Enter');
  const sheet = page.locator('svg.page-ink-surface');
  const sheetBox = (await sheet.boundingBox())!;
  await page.mouse.move(sheetBox.x + 40, sheetBox.y + 80);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(sheetBox.x + 40 + step * 20, sheetBox.y + 80 + (step % 2) * 30);
  }
  await page.mouse.up();
  await expect(sheet.locator('path')).toHaveCount(1);
  await page.getByRole('button', { name: 'Fertig' }).click();
  await expect(page.locator('.page-ink path')).toHaveCount(1);
  await page
    .getByRole('navigation', { name: 'Pfad' })
    .getByRole('link', { name: 'Seiten' })
    .click();
  await expect(page).toHaveURL(/\/dateien\/seiten(\?|$)/);
  await page.reload();
  const home = page.locator('.page-body');
  await expect(home).toContainText('Meine Woche');
  await expect(home.getByRole('link', { name: 'Einkauf' }).first()).toBeVisible();
  // The Startseite is not one of its own pages.
  await expect(home.getByText('Startseite', { exact: true })).toHaveCount(0);
  await shot(page, 'own-home');
  await home.getByRole('link', { name: 'Einkauf' }).first().click();
  await expect(page).toHaveURL(/\/seite\//);
  await expect(page.locator('.page-ink path')).toHaveCount(1);
  await page
    .getByRole('navigation', { name: 'Pfad' })
    .getByRole('link', { name: 'Seiten' })
    .click();
  await expect(page).toHaveURL(/\/dateien\/seiten(\?|$)/);
  await expect(page.locator('.page-body')).toContainText('Meine Woche');
});
