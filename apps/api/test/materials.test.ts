import type Anthropic from '@anthropic-ai/sdk';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { boardSchema, materialSchema, type Board, type MaterialQuestion } from '@slider/shared';
import { utils, write } from 'xlsx';
import { workspaceMembers, workspaces } from '../src/db/schema';
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

/** The AI's answers, scripted in order: each a message or a function of the request. */
type Scripted =
  | Record<string, unknown>
  | ((body: { messages: unknown[] }) => Record<string, unknown> | Promise<Record<string, unknown>>);
let answers: Scripted[] = [];
const fakeAnthropic = () =>
  ({
    models: {
      retrieve: async (model: string) => ({ id: model, max_tokens: 64_000 }),
      list: async function* () {
        await Promise.resolve();
        yield { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' };
      },
    },
    beta: {
      messages: {
        stream: (body: { messages: unknown[] }) => ({
          finalMessage: async () => {
            const next = answers.shift();
            if (!next) throw new Error('no scripted answer left');
            return typeof next === 'function' ? next(body) : next;
          },
          abort: () => undefined,
        }),
      },
    },
  }) as unknown as Anthropic;
const aiMessage = (content: unknown[], stop: string) => ({
  id: `msg_${crypto.randomUUID()}`,
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-5-5',
  content,
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
});

let ctx: TestContext;
let deck: DeckFixture;
let live: LiveHub;
beforeEach(async () => {
  live = new LiveHub();
  answers = [];
  ctx = await createTestContext({
    live,
    anthropic: fakeAnthropic,
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

describe('the material page', () => {
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

    // „Fragen“: a question put down as a comment (or a note asked with ⌘↵) – refused without an
    // AI key; with one the AI reads the page and answers from it, its source named – streamed,
    // kept under it for everyone, written anew when asked again, gone with „Antwort löschen“ or it.
    const questions = `/api/decks/${deck.deckId}/material-questions`;
    const note = async (text: string, kind: 'box' | 'question' = 'box') => {
      const id = crypto.randomUUID();
      await ctx.request(items, {
        method: 'POST',
        json: { id, kind, text, x: 600, y: 0, w: 200, h: 120 },
      });
      return id;
    };
    const market = await note('Wie stark wächst der Markt?', 'question');
    // A question hangs on nothing.
    expect(
      (
        await ctx.request(items, {
          method: 'POST',
          json: {
            id: crypto.randomUUID(),
            kind: 'question',
            text: 'Und?',
            boundIds: [folderId],
            x: 0,
            y: 0,
            w: 320,
            h: 140,
          },
        })
      ).status,
    ).toBe(400);
    const ask = (noteId: string, question: string, cookie?: string) =>
      ctx.request(questions, {
        method: 'POST',
        cookie,
        json: { id: crypto.randomUUID(), noteId, question },
      });
    expect((await ask(market, 'Wie stark wächst der Markt?')).status).toBe(409);
    expect((await ask(folderId, 'Was liegt hier?')).status).toBe(404);
    await ctx.request(`/api/workspaces/${ctx.workspaceId}/integrations/keys`, {
      method: 'POST',
      json: { kind: 'ai', provider: 'anthropic', apiKey: 'sk-ant-api03-good-AbCdEfGhIjKlMnOpQrSt' },
    });
    answers.push(
      aiMessage(
        [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'read_material',
            input: { material: report.id, from: 2 },
          },
        ],
        'tool_use',
      ),
      (body) => {
        expect(JSON.stringify(body.messages.at(-1))).toContain('12 Prozent');
        return aiMessage(
          [{ type: 'text', text: `Um **12 Prozent** [[${report.id}#2]].`, citations: null }],
          'end_turn',
        );
      },
    );
    const asked = await ask(market, 'Wie stark wächst der Markt?');
    expect(asked.headers.get('content-type')).toContain('text/event-stream');
    const events = (await asked.text())
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => JSON.parse(line.slice(5)) as { type: string; [key: string]: unknown });
    expect(events.map((event) => event.type)).toEqual(['reading', 'text', 'done']);
    expect(events[0]).toEqual({ type: 'reading', label: 'Liest „Studie.pdf“ ab Seite 2' });
    expect(events[2]).toMatchObject({
      question: { state: 'done', answer: `Um **12 Prozent** [[${report.id}#2]].` },
    });
    expect(await (await ctx.request(questions)).json()).toMatchObject([
      { noteId: market, question: 'Wie stark wächst der Markt?', state: 'done' },
    ]);
    // Asked again (the note typed into): the one answer under it is written anew.
    answers.push(
      aiMessage([{ type: 'text', text: 'Um 14 Prozent.', citations: null }], 'end_turn'),
    );
    await (await ask(market, 'Und 2024?')).text();
    const [again] = (await (await ctx.request(questions)).json()) as MaterialQuestion[];
    expect(again).toMatchObject({
      noteId: market,
      question: 'Und 2024?',
      answer: 'Um 14 Prozent.',
    });
    // Its thread, as a comment's: a reply not asked about is kept at once; one asked is answered
    // with the note and the thread so far in mind; „Antwort löschen“ under a reply keeps it, its
    // writer deletes it.
    const reply = async (question: string, asking: boolean) =>
      (
        await (
          await ctx.request(questions, {
            method: 'POST',
            json: { id: crypto.randomUUID(), noteId: market, question, kind: 'reply', ask: asking },
          })
        ).text()
      )
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => JSON.parse(line.slice(5)) as { type: string; question?: MaterialQuestion });
    const thanks = await reply('Danke!', false);
    expect(thanks).toMatchObject([
      {
        type: 'done',
        question: { kind: 'reply', state: null, author: { name: expect.any(String) } },
      },
    ]);
    answers.push((body) => {
      const said = JSON.stringify(body.messages);
      expect(said).toContain('Um 14 Prozent.');
      expect(said).toMatch(/Reply by [^:]+: Danke![\s\S]*Reply by [^:]+: Und 2025\?/);
      expect((body.messages.at(-1) as { role?: string } | undefined)?.role).toBe('user');
      return aiMessage([{ type: 'text', text: 'Dazu steht nichts.', citations: null }], 'end_turn');
    });
    const followUp = await reply('Und 2025?', true);
    expect(followUp.at(-1)?.question).toMatchObject({
      state: 'done',
      answer: 'Dazu steht nichts.',
    });
    const thread = (await (await ctx.request(questions)).json()) as MaterialQuestion[];
    expect(thread.map((each) => [each.kind, each.question])).toEqual([
      ['note', 'Und 2024?'],
      ['reply', 'Danke!'],
      ['reply', 'Und 2025?'],
    ]);
    const followUpId = followUp.at(-1)!.question!.id;
    await ctx.request(`/api/material-questions/${followUpId}`, { method: 'DELETE' });
    expect(
      ((await (await ctx.request(questions)).json()) as MaterialQuestion[]).at(-1),
    ).toMatchObject({ id: followUpId, state: null, answer: '' });
    for (const id of [followUpId, thanks[0]!.question!.id])
      expect(
        (await ctx.request(`/api/material-questions/${id}?part=all`, { method: 'DELETE' })).status,
      ).toBe(204);
    // Three at once per person – a fourth sent together with them waits all the same.
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = async () => {
      await gate;
      return aiMessage([{ type: 'text', text: 'Ja.', citations: null }], 'end_turn');
    };
    answers.push(slow, slow, slow);
    const burst = await Promise.all(
      await Promise.all(['A?', 'B?', 'C?', 'D?'].map(async (each) => ask(await note(each), each))),
    );
    expect(burst.map((res) => res.status).sort()).toEqual([200, 200, 200, 429]);
    release();
    await Promise.all(burst.map((res) => res.text()));
    // Betrachter see the answers under the notes, like the notes, but ask the AI nothing.
    const reader = await member('Lea', 'viewer');
    const seen = (await (await ctx.request(questions, { cookie: reader })).json()) as {
      id: string;
      noteId: string;
    }[];
    expect(seen).toHaveLength(4);
    expect((await ask(market, 'Und 2025?', reader)).status).toBe(403);
    expect(
      (
        await ctx.request(`/api/material-questions/${again!.id}`, {
          method: 'DELETE',
          cookie: reader,
        })
      ).status,
    ).toBe(403);
    // „Antwort löschen“: the note stays; a note deleted takes its answer along.
    expect(
      (await ctx.request(`/api/material-questions/${again!.id}`, { method: 'DELETE' })).status,
    ).toBe(204);
    expect(
      (await ctx.request(`/api/material-questions/${again!.id}`, { method: 'DELETE' })).status,
    ).toBe(404);
    const other = seen.find((each) => each.noteId !== market)!;
    expect(
      (await ctx.request(`/api/decks/${deck.deckId}/board/${other.noteId}`, { method: 'DELETE' }))
        .status,
    ).toBe(204);
    expect(
      ((await (await ctx.request(questions)).json()) as { id: string }[]).map((each) => each.id),
    ).not.toContain(other.id);
    expect((await board()).items.some((each) => each.id === market)).toBe(true);
  });

  it('lets AI apps in over MCP – OAuth with PKCE or a token, held to a workspace, never the cookie', async () => {
    const origin = ctx.deps.config.webOrigin;
    const rpc = async (token: string | null, method: string, params: object = {}) => {
      const res = await ctx.request('/api/mcp', {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        json: { jsonrpc: '2.0', id: 1, method, params },
      });
      const body =
        res.status === 200
          ? ((await res.json()) as {
              result: {
                tools?: { name: string }[];
                content?: { text?: string }[];
                isError?: boolean;
              };
            })
          : null;
      return { status: res.status, res, body };
    };
    const call = async (token: string, name: string, args: object = {}) => {
      const { body } = await rpc(token, 'tools/call', { name, arguments: args });
      return {
        text: (body?.result.content ?? []).map((part) => part.text ?? '').join('\n'),
        error: !!body?.result.isError,
      };
    };

    // Without a token (the session cookie goes along, as from a page): 401 with where to sign in.
    const bare = await rpc(null, 'tools/list');
    expect(bare.status).toBe(401);
    expect(bare.res.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`,
    );
    expect((await rpc('slider_at_nope', 'tools/list')).status).toBe(401);
    const resource = await (
      await ctx.request('/.well-known/oauth-protected-resource/api/mcp')
    ).json();
    expect(resource).toMatchObject({
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
    });
    const server = await (await ctx.request('/.well-known/oauth-authorization-server')).json();
    expect(server).toMatchObject({
      token_endpoint: `${origin}/api/oauth/token`,
      code_challenge_methods_supported: ['S256'],
    });

    // OAuth: registration, consent on /verbinden (for one workspace), code with PKCE, tokens.
    const redirect = 'https://claude.ai/api/mcp/auth_callback';
    const registered = await ctx.request('/api/oauth/register', {
      method: 'POST',
      json: { client_name: 'Claude', redirect_uris: [redirect] },
    });
    expect(registered.status).toBe(201);
    const { client_id } = (await registered.json()) as { client_id: string };
    const verifier = 'v'.repeat(64);
    const challenge = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ).toString('base64url');
    const authorize = await ctx.request(
      `/api/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 's1' })}`,
      { redirect: 'manual' },
    );
    expect(authorize.status).toBe(302);
    const request = new URL(authorize.headers.get('location')!, origin).searchParams.get(
      'anfrage',
    )!;
    expect(
      (
        await ctx.request(
          `/api/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id, redirect_uri: 'https://evil.example/cb', code_challenge: challenge, code_challenge_method: 'S256' })}`,
          { redirect: 'manual' },
        )
      ).status,
    ).toBe(400);
    expect(
      await (
        await ctx.request('/api/connections/request', { method: 'POST', json: { request } })
      ).json(),
    ).toMatchObject({ clientName: 'Claude' });
    const approved = await ctx.request('/api/connections/approve', {
      method: 'POST',
      json: { request, workspaceId: ctx.workspaceId },
    });
    const back = new URL(((await approved.json()) as { redirectUrl: string }).redirectUrl);
    expect([back.origin + back.pathname, back.searchParams.get('state')]).toEqual([redirect, 's1']);
    const token = (fields: Record<string, string>) =>
      ctx.request('/api/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
      });
    const code = back.searchParams.get('code')!;
    const exchange = { grant_type: 'authorization_code', code, redirect_uri: redirect, client_id };
    // The request named its redirect, so must the swap (RFC 6749 4.1.3) – the code stays good.
    const { redirect_uri: _named, ...unnamed } = exchange;
    expect((await token({ ...unnamed, code_verifier: verifier })).status).toBe(400);
    const granted = await token({ ...exchange, code_verifier: verifier });
    expect(granted.status).toBe(200);
    const tokens = (await granted.json()) as { access_token: string; refresh_token: string };
    expect(tokens.access_token).toMatch(/^slider_at_/);
    expect((await token({ ...exchange, code_verifier: verifier })).status).toBe(400);

    // The tools: a note on the board under the person's name, found again by search and fetch.
    const { body: listed } = await rpc(tokens.access_token, 'tools/list');
    const names = (listed?.result.tools ?? []).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['search', 'fetch', 'add_note', 'edit_slides']));
    // Files come from the app – the server fetches no address for it (the page has none either).
    expect(
      await call(tokens.access_token, 'add_file', {
        presentation: deck.deckId,
        name: 'Studie.pdf',
        url: 'http://127.0.0.1:8787/api/health',
      }),
    ).toEqual({
      text: expect.stringContaining('Give exactly one of text or base64.'),
      error: true,
    });
    const noted = await call(tokens.access_token, 'add_note', {
      presentation: deck.deckId,
      text: '## Marktanteil\n\nNord: **12 Prozent**',
    });
    expect(noted.text).toMatch(/^Put on the board as sticker /);
    const sticker = (await board()).items.find((item) => item.text.startsWith('## Marktanteil'));
    expect(sticker).toMatchObject({ kind: 'box', author: { id: ctx.ownerId } });
    const found = JSON.parse(
      (await call(tokens.access_token, 'search', { query: 'marktanteil' })).text,
    );
    expect(found.results[0]).toMatchObject({
      id: `note:${sticker!.id}`,
      title: 'Note: Marktanteil',
    });
    expect(
      JSON.parse((await call(tokens.access_token, 'fetch', { id: found.results[0].id })).text),
    ).toMatchObject({ text: '## Marktanteil\n\nNord: **12 Prozent**' });
    // A blocked workspace (BER-167) is out of reach for apps too – lists and search included.
    const block = (blockedAt: Date | null) =>
      ctx.deps.db.update(workspaces).set({ blockedAt }).where(eq(workspaces.id, ctx.workspaceId));
    await block(new Date());
    expect(await call(tokens.access_token, 'list_presentations')).toEqual({
      text: 'No presentations.',
      error: false,
    });
    expect(
      JSON.parse((await call(tokens.access_token, 'search', { query: 'marktanteil' })).text),
    ).toEqual({ results: [] });
    await block(null);
    expect(
      await call(tokens.access_token, 'get_presentation', { presentation: 'Gibt es nicht' }),
    ).toMatchObject({ error: true });
    // The AI's window is the page's: used up there, edit_slides waits too.
    for (let i = 0; i < 20; i += 1)
      await ctx.request(`/api/decks/${deck.deckId}/ai/proposals`, { method: 'POST', json: {} });
    expect(
      await call(tokens.access_token, 'edit_slides', {
        presentation: deck.deckId,
        slide: 1,
        instruction: 'Kürzer',
      }),
    ).toMatchObject({ error: true, text: expect.stringMatching(/^Too many AI requests/) });

    // Refresh tokens rotate, for their own app only.
    const refresh = (refresh_token: string, fields: Record<string, string> = { client_id }) =>
      token({ grant_type: 'refresh_token', refresh_token, ...fields });
    expect((await refresh(tokens.refresh_token, {})).status).toBe(400);
    expect((await refresh(tokens.refresh_token, { client_id: 'slider_client_x' })).status).toBe(
      400,
    );
    const refreshed = await refresh(tokens.refresh_token);
    expect(refreshed.status).toBe(200);
    const fresh = (await refreshed.json()) as { access_token: string; refresh_token: string };
    expect((await rpc(fresh.access_token, 'tools/list')).status).toBe(200);

    // A token held to another workspace sees nothing of this one.
    const other = { id: crypto.randomUUID() };
    await ctx.deps.db.insert(workspaces).values({ id: other.id, name: 'Andere', slug: 'andere' });
    await ctx.deps.db
      .insert(workspaceMembers)
      .values({ workspaceId: other.id, userId: ctx.ownerId, role: 'admin' });
    const made = await ctx.request('/api/connections/tokens', {
      method: 'POST',
      json: { name: 'Claude Code', workspaceId: other.id },
    });
    expect(made.status).toBe(201);
    const held = ((await made.json()) as { token: string }).token;
    expect(held).toMatch(/^slider_pat_/);
    expect(await call(held, 'list_presentations')).toEqual({
      text: 'No presentations.',
      error: false,
    });
    expect(await call(held, 'get_presentation', { presentation: deck.deckId })).toMatchObject({
      error: true,
    });
    // Nor by its title: no answer tells that a deck of that name is somewhere else.
    const { title } = (await (await ctx.request(`/api/decks/${deck.deckId}`)).json()) as {
      title: string;
    };
    expect(await call(held, 'get_presentation', { presentation: title })).toEqual({
      text: `No presentation "${title}" – list_presentations finds it.`,
      error: true,
    });
    expect(JSON.parse((await call(held, 'search', { query: 'marktanteil' })).text)).toEqual({
      results: [],
    });
    // Searching decrypts every deck's text: the page's window counts the apps' searches too.
    for (let i = 0; i < 60; i += 1) await ctx.request('/api/decks/search?q=x');
    expect(await call(held, 'search', { query: 'marktanteil' })).toMatchObject({
      error: true,
      text: expect.stringMatching(/^Too many searches/),
    });

    // „Entfernen“ on /konto ends an app's access at once.
    const connections = (await (await ctx.request('/api/connections')).json()) as {
      connections: { id: string; name: string; kind: string }[];
    };
    expect(connections.connections.map((each) => [each.name, each.kind]).sort()).toEqual([
      ['Claude Code', 'token'],
      ['Claude', 'oauth'],
    ]);
    const byHand = connections.connections.find((each) => each.kind === 'token')!;
    expect((await ctx.request(`/api/connections/${byHand.id}`, { method: 'DELETE' })).status).toBe(
      204,
    );
    expect((await rpc(held, 'tools/list')).status).toBe(401);
    // A replaced refresh token given again right after its renewal – the app asking twice:
    // refused, the connection stays.
    expect((await refresh(tokens.refresh_token)).status).toBe(400);
    expect((await rpc(fresh.access_token, 'tools/list')).status).toBe(200);
    // Later – someone else has it: the connection ends.
    ctx.clock.advance(2 * 60_000);
    expect((await refresh(tokens.refresh_token)).status).toBe(400);
    expect((await rpc(fresh.access_token, 'tools/list')).status).toBe(401);
    expect((await refresh(fresh.refresh_token)).status).toBe(400);
    expect(
      ((await (await ctx.request('/api/connections')).json()) as { connections: [] }).connections,
    ).toEqual([]);
  });
});
