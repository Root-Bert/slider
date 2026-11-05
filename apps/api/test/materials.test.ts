import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boardSchema, materialSchema, type Board } from '@slider/shared';
import { utils, write } from 'xlsx';
import { workspaceMembers } from '../src/db/schema';
import { LiveHub } from '../src/realtime/live-hub';
import { materialsBrief } from '../src/services/ai-context';
import { runMaterialTool } from '../src/services/material-tools';
import { workspaceStorageUsage } from '../src/services/workspace-storage';
import {
  createReadyDeck,
  createTestContext,
  signedInUser,
  type DeckFixture,
  type TestContext,
} from './helpers';
import { makeSlidesPdf } from './pdf';

let ctx: TestContext;
let deck: DeckFixture;
let live: LiveHub;
beforeEach(async () => {
  live = new LiveHub();
  ctx = await createTestContext({
    live,
    config: { dataDir: await mkdtemp(path.join(tmpdir(), 'slider-materials-')) },
  });
  deck = await createReadyDeck(ctx, { slideCount: 2 });
});
afterEach(() => ctx.cleanup());

const b64 = (text: string) => Buffer.from(text).toString('base64');

/** A file sent over tus for the deck's board, then put down: the route's answer. */
async function putDown(
  name: string,
  bytes: Uint8Array,
  {
    cookie,
    id = crypto.randomUUID(),
    folderId,
  }: { cookie?: string; id?: string; folderId?: string } = {},
) {
  const tus = (url: string, init: RequestInit) =>
    ctx.request(url, {
      ...init,
      cookie,
      headers: { 'Tus-Resumable': '1.0.0', ...(init.headers as Record<string, string>) },
    });
  const created = await tus('/api/decks/tus', {
    method: 'POST',
    headers: {
      'Upload-Length': String(bytes.length),
      'Upload-Metadata': `filename ${b64(name)},purpose ${b64('material')},deckId ${b64(deck.deckId)}`,
    },
  });
  if (created.status !== 201) return created;
  const url = created.headers.get('location') ?? '';
  expect(
    (
      await tus(url, {
        method: 'PATCH',
        body: bytes,
        headers: { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' },
      })
    ).status,
  ).toBe(204);
  const answer = await ctx.request(`/api/decks/${deck.deckId}/materials`, {
    method: 'POST',
    cookie,
    json: { id, upload: url.split('/').pop(), x: 10, y: 20, w: 220, h: 200, folderId },
  });
  if (answer.status === 201) {
    const retried = await ctx.request(`/api/decks/${deck.deckId}/materials`, {
      method: 'POST',
      cookie,
      json: { id, upload: url.split('/').pop(), x: 10, y: 20, w: 220, h: 200, folderId },
    });
    expect(retried.status).toBe(200);
  }
  return answer;
}

async function board(cookie?: string): Promise<Board> {
  const res = await ctx.request(`/api/decks/${deck.deckId}/board`, { cookie });
  expect(res.status).toBe(200);
  return boardSchema.parse(await res.json());
}

async function member(name: string, role: 'reviewer' | 'viewer') {
  const person = await signedInUser(ctx, { name, email: `${name.toLowerCase()}@firma.de` });
  await ctx.deps.db
    .insert(workspaceMembers)
    .values({ workspaceId: ctx.workspaceId, userId: person.user.id, role });
  return person.cookie;
}

function workbook(): Uint8Array {
  const book = utils.book_new();
  utils.book_append_sheet(
    book,
    utils.aoa_to_sheet([
      ['Quartal', 'Umsatz', 'Kunden'],
      ['Q1', 1200, 40],
      ['Q2', 1850, 52],
    ]),
    'Zahlen',
  );
  utils.book_append_sheet(book, utils.aoa_to_sheet([['Team'], ['Ada']]), 'Team');
  return new Uint8Array(write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

describe('the material board (Folie 0)', () => {
  it('puts down, moves and deletes files, notes and links – rights as comments, told live, never in the deck', async () => {
    const changed = vi.spyOn(live, 'boardChanged');
    const reviewer = await member('Rita', 'reviewer');
    const viewer = await member('Vera', 'viewer');

    // A picture by the reviewer over tus; sent again under its id: the one saved first.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const id = crypto.randomUUID();
    const res = await putDown('Logo.png', png, { cookie: reviewer, id });
    expect(res.status).toBe(201);
    const picture = materialSchema.parse(await res.json());
    expect(picture).toMatchObject({
      id,
      name: 'Logo.png',
      kind: 'image',
      mimeType: 'image/png',
      sizeBytes: png.length,
      readState: 'none',
      author: { name: 'Rita' },
      x: 10,
      y: 20,
    });
    expect((await putDown('Logo.png', png, { cookie: reviewer, id })).status).toBe(200);
    // A name promising a PDF on bytes that are none: stored, but as a plain file.
    const fake = materialSchema.parse(
      await (await putDown('Bericht.pdf', new TextEncoder().encode('<html>hi</html>'))).json(),
    );
    expect(fake).toMatchObject({
      kind: 'other',
      mimeType: 'application/octet-stream',
      readState: 'none',
    });
    const download = await ctx.request(fake.url);
    expect(download.headers.get('content-type')).toBe('application/octet-stream');
    expect(download.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(download.headers.get('content-security-policy')).toMatch(/sandbox/);

    // Viewers see the board and its files, but put nothing down.
    expect(
      (await putDown('Notiz.txt', new TextEncoder().encode('x'), { cookie: viewer })).status,
    ).toBe(403);
    expect((await board(viewer)).materials.map((m) => m.id)).toEqual([id, fake.id]);
    const file = await ctx.request(picture.url, { cookie: viewer });
    expect(file.status).toBe(200);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(png);

    // A box and a link; a link needs http(s); a note stands beside one thing.
    const note = {
      id: crypto.randomUUID(),
      kind: 'box',
      text: 'Zielgruppe: Einkauf',
      x: 300,
      y: 0,
      w: 200,
      h: 160,
    };
    const items = `/api/decks/${deck.deckId}/board/items`;
    expect(
      (await ctx.request(items, { method: 'POST', json: note, cookie: reviewer })).status,
    ).toBe(201);
    const bad = { ...note, id: crypto.randomUUID(), kind: 'link', url: 'javascript:alert(1)' };
    expect((await ctx.request(items, { method: 'POST', json: bad })).status).toBe(400);
    expect(
      (
        await ctx.request(items, {
          method: 'POST',
          json: { ...note, id: crypto.randomUUID(), kind: 'note' },
        })
      ).status,
    ).toBe(400);
    const link = { ...bad, url: 'https://example.com/studie', text: '' };
    expect((await ctx.request(items, { method: 'POST', json: link })).status).toBe(201);
    // Free text is no kind of its own any more (old ones became notes, migration 0088).
    expect(
      (
        await ctx.request(items, {
          method: 'POST',
          json: { ...note, id: crypto.randomUUID(), kind: 'text' },
        })
      ).status,
    ).toBe(400);
    // A note on a file, and one round the file and the link: only on things of this board, only
    // a note hangs on something.
    const onFile = {
      id: crypto.randomUUID(),
      kind: 'note',
      text: 'Diese Zahl stimmt nicht',
      boundIds: [id],
      ...{ x: 300, y: 0, w: 200, h: 160 },
    };
    const round = {
      ...onFile,
      id: crypto.randomUUID(),
      kind: 'box',
      text: 'Beide',
      boundIds: [id, link.id],
    };
    expect(
      (
        await ctx.request(items, {
          method: 'POST',
          json: { ...onFile, kind: 'link', url: link.url },
        })
      ).status,
    ).toBe(400);
    expect(
      (await ctx.request(items, { method: 'POST', json: { ...onFile, boundIds: ['nope'] } }))
        .status,
    ).toBe(404);
    expect((await ctx.request(items, { method: 'POST', json: onFile })).status).toBe(201);
    expect((await ctx.request(items, { method: 'POST', json: round })).status).toBe(201);
    // Only its author changes a note's text.
    expect(
      (await ctx.request(`${items}/${note.id}`, { method: 'PATCH', json: { text: 'Neu' } })).status,
    ).toBe(403);
    expect(
      (
        await ctx.request(`${items}/${note.id}`, {
          method: 'PATCH',
          json: { text: 'Neu' },
          cookie: reviewer,
        })
      ).status,
    ).toBe(200);

    // Anyone who comments moves anything – files, notes and links in one go.
    const moved = await ctx.request(`/api/decks/${deck.deckId}/board`, {
      method: 'PATCH',
      cookie: reviewer,
      json: {
        frames: [
          { id, x: 500, y: 40, w: 260, h: 240 },
          { id: link.id, x: -80, y: 10, w: 240, h: 96 },
        ],
      },
    });
    expect(moved.status).toBe(204);
    const now = await board();
    expect(now.materials[0]).toMatchObject({ x: 500, w: 260 });
    expect(now.items.map((item) => [item.kind, item.text, item.x])).toEqual([
      ['box', 'Neu', 300],
      ['link', '', -80],
      ['note', 'Diese Zahl stimmt nicht', 300],
      ['box', 'Beide', 300],
    ]);
    expect(now.items.at(-1)).toMatchObject({ boundIds: [id, link.id] });
    expect(
      (
        await ctx.request(`/api/decks/${deck.deckId}/board`, {
          method: 'PATCH',
          cookie: viewer,
          json: { frames: [{ id, x: 0, y: 0, w: 99, h: 99 }] },
        })
      ).status,
    ).toBe(403);

    // Deleting: one's own with comment rights; someone else's only who manages the deck.
    const del = (itemId: string, cookie?: string) =>
      ctx.request(`/api/decks/${deck.deckId}/board/${itemId}`, { method: 'DELETE', cookie });
    expect((await del(link.id, reviewer)).status).toBe(403);
    expect((await del(id, viewer)).status).toBe(403);
    expect((await del(link.id)).status).toBe(204);
    // The link gone, the note round both hangs on the file alone.
    expect((await board()).items.find((item) => item.id === round.id)?.boundIds).toEqual([id]);
    // What a frame holds: changed by anyone who moves things, its label only by its author.
    const frameUrl = `/api/decks/${deck.deckId}/board/items/${round.id}`;
    expect(
      (
        await ctx.request(frameUrl, {
          method: 'PATCH',
          json: { boundIds: [id, note.id] },
          cookie: reviewer,
        })
      ).status,
    ).toBe(200);
    expect(
      (await ctx.request(frameUrl, { method: 'PATCH', json: { text: 'Fremd' }, cookie: reviewer }))
        .status,
    ).toBe(403);
    // Its colour: its author's own choice of the comment colours; `null` back to theirs.
    expect(
      (await ctx.request(frameUrl, { method: 'PATCH', json: { color: 'green' }, cookie: reviewer }))
        .status,
    ).toBe(403);
    expect(
      (await ctx.request(frameUrl, { method: 'PATCH', json: { color: 'green' } })).status,
    ).toBe(200);
    expect((await board()).items.find((item) => item.id === round.id)?.color).toBe('green');
    // A sticker's rich text kept as sent (sealed), its Markdown as its text.
    const rich = { root: { type: 'root', children: [{ type: 'paragraph', children: [] }] } };
    expect(
      (
        await ctx.request(frameUrl.replace(round.id, note.id), {
          method: 'PATCH',
          json: { text: '**Neu**', rich },
          cookie: reviewer,
        })
      ).status,
    ).toBe(200);
    expect((await board()).items.find((item) => item.id === note.id)).toMatchObject({
      text: '**Neu**',
      rich,
    });
    expect((await del(note.id, reviewer)).status).toBe(204);

    // Its bytes count in the workspace's storage until the file goes.
    expect(
      (await workspaceStorageUsage(ctx.deps.db, ctx.workspaceId)).other,
    ).toBeGreaterThanOrEqual(png.length + fake.sizeBytes);
    expect((await del(id)).status).toBe(204);
    // The file gone, the notes on it alone go with it.
    // A frame stays, empty or not: its people decide.
    expect((await board()).items.map((item) => [item.kind, item.boundIds])).toEqual([['box', []]]);
    expect((await ctx.request(picture.url)).status).toBe(404);
    expect(changed.mock.calls.every(([deckId]) => deckId === deck.deckId)).toBe(true);
    expect(changed.mock.calls.length).toBeGreaterThanOrEqual(8);

    // Never part of the deck: its slides and its file stay as they were.
    const slides = (await (
      await ctx.request(`/api/decks/${deck.deckId}/slides`)
    ).json()) as unknown[];
    expect(slides).toHaveLength(2);

    // Two completions of one upload must keep the winner's bytes intact.
    const duplicateId = crypto.randomUUID();
    const put = ctx.deps.media.put.bind(ctx.deps.media);
    let arrived = 0;
    let release!: () => void;
    const both = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi.spyOn(ctx.deps.media, 'put').mockImplementation(async (key, bytes) => {
      if (key.includes(duplicateId)) {
        if (++arrived === 2) release();
        await both;
      }
      return put(key, bytes);
    });
    const results = await Promise.all([
      putDown('A.bin', new Uint8Array([1, 2]), { id: duplicateId }),
      putDown('B.bin', new Uint8Array([3, 4]), { id: duplicateId }),
    ]);
    spy.mockRestore();
    expect(results.map((each) => each.status).sort()).toEqual([200, 201]);
    const kept = materialSchema.parse(await results[0]!.json());
    const keptBytes = await ctx.request(kept.url);
    expect(keptBytes.status).toBe(200);
    expect(new Uint8Array(await keptBytes.arrayBuffer())).toEqual(
      new Uint8Array(kept.name === 'A.bin' ? [1, 2] : [3, 4]),
    );
  });

  it('reads the text of a PDF and the sheets of a spreadsheet for the AI, which finds and reads the right cell', async () => {
    const pdf = makeSlidesPdf([
      { texts: [{ text: 'Marktanalyse 2026', x: 40, y: 40, size: 28 }] },
      { texts: [{ text: 'Der Markt waechst um 12 Prozent.', x: 40, y: 40, size: 20 }] },
    ]);
    const report = materialSchema.parse(await (await putDown('Studie.pdf', pdf)).json());
    const sheet = materialSchema.parse(await (await putDown('Zahlen.xlsx', workbook())).json());
    expect([report.readState, sheet.readState]).toEqual(['pending', 'pending']);
    await ctx.deps.background?.idle();

    const read = await board();
    expect(read.materials.find((m) => m.id === report.id)).toMatchObject({
      kind: 'pdf',
      readState: 'done',
      pages: 2,
      previewUrl: `/api/materials/${report.id}/preview`,
    });
    expect(
      (await ctx.request(`/api/materials/${report.id}/preview`)).headers.get('content-type'),
    ).toBe('image/jpeg');
    expect(read.materials.find((m) => m.id === sheet.id)).toMatchObject({
      kind: 'spreadsheet',
      readState: 'done',
      pages: 2,
      sheets: [
        { name: 'Zahlen', rows: 3, columns: 3 },
        { name: 'Team', rows: 2, columns: 1 },
      ],
    });

    // A note on the PDF goes with it: in the brief, the list and its text.
    expect(
      (
        await ctx.request(`/api/decks/${deck.deckId}/board/items`, {
          method: 'POST',
          json: {
            id: crypto.randomUUID(),
            kind: 'note',
            text: 'Wachstum prüfen',
            boundIds: [report.id],
            ...{ x: 0, y: 0, w: 200, h: 160 },
          },
        })
      ).status,
    ).toBe(201);

    // The first message names the files, not what they say.
    const brief = await materialsBrief(ctx.deps, deck.deckId);
    expect(brief).toMatch(/„Studie\.pdf“[^\n]*\n {2}note on this file by [^\n]*: Wachstum prüfen/);
    expect(brief).toContain('„Studie.pdf“ (PDF');
    expect(brief).toContain('„Zahlen.xlsx“ (spreadsheet');
    expect(brief).toContain('Zahlen: Quartal | Umsatz | Kunden');

    const tool = (name: string, input: unknown) =>
      runMaterialTool(ctx.deps, deck.deckId, name, input);
    // A folder put down: its files go into it, the AI lists them with it; the folder deleted, they
    // stay as files of the board.
    const folderId = crypto.randomUUID();
    const items = `/api/decks/${deck.deckId}/board/items`;
    expect(
      (
        await ctx.request(items, {
          method: 'POST',
          json: { id: folderId, kind: 'folder', text: 'Quellen', x: 0, y: 400, w: 240, h: 200 },
        })
      ).status,
    ).toBe(201);
    const inFolder = materialSchema.parse(
      await (await putDown('Anhang.txt', new TextEncoder().encode('Anhang'), { folderId })).json(),
    );
    expect(inFolder.folderId).toBe(folderId);
    expect((await board()).items.find((item) => item.id === folderId)?.boundIds).toEqual([
      inFolder.id,
    ]);
    expect((await tool('list_materials', {}))?.content).toContain(
      '- folder „Quellen“ by Robert Hofmann with 1 file(s): „Anhang.txt“',
    );
    expect(
      (await ctx.request(`/api/decks/${deck.deckId}/board/${folderId}`, { method: 'DELETE' }))
        .status,
    ).toBe(204);
    expect((await board()).materials.find((m) => m.id === inFolder.id)?.folderId).toBeNull();
    // „Nimm die Zahlen aus der Excel“: the search finds the sheet, read_sheet the cell.
    const found = await tool('search_materials', { query: 'umsatz' });
    expect(found?.content).toContain('„Zahlen.xlsx“');
    expect(found?.content).toContain('sheet „Zahlen“');
    const cells = await tool('read_sheet', { material: 'Zahlen.xlsx', range: 'A1:C3' });
    expect(cells?.isError).toBe(false);
    expect(cells?.content).toContain('# | A | B | C');
    expect(cells?.content).toContain('3 | Q2 | 1850 | 52');
    const page = await tool('read_material', { material: report.id, from: 2 });
    expect(page?.content).toContain('page 2');
    expect(page?.content).toContain('Der Markt waechst um 12 Prozent.');
    expect(page?.content).not.toContain('Marktanalyse');
    expect(page?.content).toContain('Notes people put on „Studie.pdf“');
    expect((await tool('list_materials', {}))?.content).toMatch(
      /„Studie\.pdf“[\s\S]*note on this file by .*Wachstum prüfen/,
    );
    expect((await tool('search_materials', { query: 'markt prozent' }))?.content).toContain(
      'page 2',
    );
    const look = await tool('view_material', { material: 'Studie.pdf', page: 1 });
    expect(
      Array.isArray(look?.content) && look.content.some((block) => block.type === 'image'),
    ).toBe(true);
    expect(await tool('read_sheet', { material: 'Fehlt.xlsx' })).toMatchObject({ isError: true });
    expect(await tool('view_slide', {})).toBeNull();
  });
});
