import type Anthropic from '@anthropic-ai/sdk';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  boardSchema,
  materialSchema,
  type Board,
  type MaterialChatDto,
  type MaterialQuestion,
} from '@slider/shared';
import { utils, write } from 'xlsx';
import {
  deckBoardItems,
  deckMaterials,
  materialChats,
  materialQuestions,
  workspaceMembers,
  workspaces,
} from '../src/db/schema';
import { LiveHub } from '../src/realtime/live-hub';
import { materialsBrief } from '../src/services/ai-context';
import { deckBoard } from '../src/services/board-owner';
import { documentAiIdle } from '../src/services/document-ai';
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
    documentId,
  }: { cookie?: string; id?: string; folderId?: string; documentId?: string } = {},
) {
  // On the deck's board, or on a text document's.
  const base = documentId ? `/api/documents/${documentId}` : `/api/decks/${deck.deckId}`;
  const owner = documentId ? `documentId ${b64(documentId)}` : `deckId ${b64(deck.deckId)}`;
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
      'Upload-Metadata': `filename ${b64(name)},purpose ${b64('material')},${owner}`,
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
  const answer = await ctx.request(`${base}/materials`, {
    method: 'POST',
    cookie,
    json: { id, upload: url.split('/').pop(), x: 10, y: 20, w: 220, h: 200, folderId },
  });
  if (answer.status === 201) {
    const retried = await ctx.request(`${base}/materials`, {
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
    const brief = await materialsBrief(ctx.deps, deckBoard(deck.deckId));
    // What people wrote stands between tags, as content; a note is named by its id.
    expect(brief).toMatch(/<material_list>\n[^]*<\/material_list>$/);
    expect(brief).toMatch(
      /„Studie\.pdf“[^\n]*\n {2}note \S+ on this file by [^\n]*: Wachstum prüfen/,
    );
    expect(brief).toContain('„Studie.pdf“ (PDF');
    expect(brief).toContain('„Zahlen.xlsx“ (spreadsheet');
    expect(brief).toContain('Zahlen: Quartal | Umsatz | Kunden');

    const tool = (name: string, input: unknown) =>
      runMaterialTool(ctx.deps, deckBoard(deck.deckId), name, input);
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
      /„Studie\.pdf“[\s\S]*note \S+ on this file by .*Wachstum prüfen/,
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
    // „Nochmal fragen“ on someone else's reply would put words under their name: refused.
    const colleague = await member('Kai', 'reviewer');
    const forged = await ctx.request(questions, {
      method: 'POST',
      cookie: colleague,
      json: {
        id: crypto.randomUUID(),
        noteId: market,
        question: 'Untergeschoben',
        kind: 'reply',
        ask: false,
        replaces: thanks[0]!.question!.id,
      },
    });
    expect(forged.status).toBe(403);
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

    // The AI's chat (✨): each person's own, kept – the message at once, the answer as it ended –
    // the next message goes on with the chat so far; Betrachter ask nothing; deleted, it is gone.
    ctx.clock.advance(61_000);
    const chats = `/api/decks/${deck.deckId}/material-chats`;
    const say = (text: string, chatId: string | null, cookie?: string) =>
      ctx.request(`/api/decks/${deck.deckId}/material-chat`, {
        method: 'POST',
        cookie,
        json: { chatId, text },
      });
    const heard = async (res: Response) =>
      (await res.text())
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => JSON.parse(line.slice(5)) as { type: string; [key: string]: unknown });
    answers.push(
      aiMessage(
        [{ type: 'text', text: 'Der Markt wächst um 12 Prozent.', citations: null }],
        'end_turn',
      ),
    );
    const first = await heard(await say('Wie wächst der Markt?\nKurz bitte', null));
    expect(first.map((event) => event.type)).toEqual(['chat', 'text', 'done']);
    expect(first[0]).toMatchObject({ title: 'Wie wächst der Markt?' });
    const chatId = first[0]!.id as string;
    answers.push((body) => {
      expect(JSON.stringify(body.messages)).toMatch(
        /Wie wächst der Markt\?[\s\S]*12 Prozent[\s\S]*Und 2025\?/,
      );
      return aiMessage([{ type: 'text', text: 'Dazu steht nichts.', citations: null }], 'end_turn');
    });
    await (await say('Und 2025?', chatId)).text();
    expect(await (await ctx.request(chats)).json()).toMatchObject([
      { id: chatId, title: 'Wie wächst der Markt?' },
    ]);
    const kept = (await (await ctx.request(`${chats}/${chatId}`)).json()) as MaterialChatDto;
    expect(kept.messages.map((each) => [each.role, each.text, each.state])).toEqual([
      ['user', 'Wie wächst der Markt?\nKurz bitte', null],
      ['assistant', 'Der Markt wächst um 12 Prozent.', 'done'],
      ['user', 'Und 2025?', null],
      ['assistant', 'Dazu steht nichts.', 'done'],
    ]);
    expect((await ctx.request(`${chats}/${chatId}`, { cookie: reader })).status).toBe(404);
    expect(await (await ctx.request(chats, { cookie: reader })).json()).toEqual([]);
    expect((await say('Hallo', null, reader)).status).toBe(403);
    expect((await ctx.request(`${chats}/${chatId}`, { method: 'DELETE' })).status).toBe(204);
    expect((await ctx.request(`${chats}/${chatId}`)).status).toBe(404);
  });

  it('keeps a board for a text document too: Prüfende put down, Betrachter read, strangers see nothing, the AIs read it, and it goes with the document', async () => {
    const made = await ctx.request('/api/documents', {
      method: 'POST',
      json: { workspaceId: ctx.workspaceId, title: 'Bericht', template: 'report' },
    });
    const documentId = ((await made.json()) as { id: string }).id;
    const base = `/api/documents/${documentId}`;
    // New, it lies in its maker's own files: into the workspace's area, where all see it.
    const { areas } = (await (
      await ctx.request(`/api/workspaces/${ctx.workspaceId}/cloud`)
    ).json()) as { areas: { id: string; root: boolean }[] };
    await ctx.request('/api/cloud/nodes/move', {
      method: 'POST',
      json: { ids: [documentId], areaId: areas.find((area) => area.root)?.id },
    });
    const reviewer = await member('Rolf', 'reviewer');
    const reader = await member('Vera', 'viewer');
    const stranger = (await signedInUser(ctx, { name: 'Fremd', email: 'fremd@anders.de' })).cookie;
    const pdf = makeSlidesPdf([
      { texts: [{ text: 'Der Markt waechst um 12 Prozent.', x: 40, y: 40, size: 20 }] },
    ]);

    // A file over tus names the document; one owner, not both.
    const both = await ctx.request('/api/decks/tus', {
      method: 'POST',
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Length': '4',
        'Upload-Metadata': `filename ${b64('a.pdf')},purpose ${b64('material')},deckId ${b64(deck.deckId)},documentId ${b64(documentId)}`,
      },
    });
    expect(both.status).toBe(400);
    expect((await putDown('Studie.pdf', pdf, { documentId, cookie: reader })).status).toBe(403);
    expect((await putDown('Studie.pdf', pdf, { documentId, cookie: stranger })).status).toBe(404);
    const report = materialSchema.parse(
      await (await putDown('Studie.pdf', pdf, { documentId, cookie: reviewer })).json(),
    );
    expect(report).toMatchObject({ deckId: null, documentId, name: 'Studie.pdf' });
    await ctx.deps.background?.idle();
    const item = (json: object, cookie?: string) =>
      ctx.request(`${base}/board/items`, {
        method: 'POST',
        cookie,
        json: { id: crypto.randomUUID(), x: 0, y: 0, w: 200, h: 160, ...json },
      });
    expect((await item({ kind: 'box', text: 'Wachstum prüfen' })).status).toBe(201);
    expect((await item({ kind: 'link', url: 'https://example.org/markt' }, reviewer)).status).toBe(
      201,
    );
    expect((await item({ kind: 'box', text: 'Nein' }, reader)).status).toBe(403);
    expect((await item({ kind: 'box', text: 'Nein' }, stranger)).status).toBe(404);
    const questionId = crypto.randomUUID();
    await item({ id: questionId, kind: 'question', text: 'Wie stark wächst der Markt?' });

    // Who may open the document reads its board; the deck's board knows none of it.
    expect((await ctx.request(`${base}/board`, { cookie: stranger })).status).toBe(404);
    const seen = boardSchema.parse(
      await (await ctx.request(`${base}/board`, { cookie: reader })).json(),
    );
    expect(seen.materials.map((each) => [each.name, each.readState, each.documentId])).toEqual([
      ['Studie.pdf', 'done', documentId],
    ]);
    expect(seen.items.map((each) => each.kind).sort()).toEqual(['box', 'link', 'question']);
    expect((await board()).materials).toEqual([]);
    const file = await ctx.request(`/api/materials/${report.id}/file`, { cookie: reader });
    expect(file.status).toBe(200);
    expect((await file.arrayBuffer()).byteLength).toBe(pdf.length);
    expect(
      (await ctx.request(`/api/materials/${report.id}/file`, { cookie: stranger })).status,
    ).toBe(404);
    // Its bytes lie under the document's prefix and count in the workspace's storage.
    const prefix = `documents/${documentId}/materials/`;
    expect((await ctx.deps.media.list(prefix)).length).toBeGreaterThan(0);
    expect(
      (await workspaceStorageUsage(ctx.deps.db, ctx.workspaceId)).other,
    ).toBeGreaterThanOrEqual(pdf.length);

    // „Fragen“ and the chat answer from this board; the chat's note lands on it.
    await ctx.request(`/api/workspaces/${ctx.workspaceId}/integrations/keys`, {
      method: 'POST',
      json: { kind: 'ai', provider: 'anthropic', apiKey: 'sk-ant-api03-good-AbCdEfGhIjKlMnOpQrSt' },
    });
    const heard = async (res: Response) =>
      (await res.text())
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => JSON.parse(line.slice(5)) as { type: string; [key: string]: unknown });
    const readsReport = aiMessage(
      [{ type: 'tool_use', id: 'toolu_1', name: 'read_material', input: { material: report.id } }],
      'tool_use',
    );
    answers.push(readsReport, (body) => {
      expect(JSON.stringify(body.messages.at(-1))).toContain('12 Prozent');
      expect(JSON.stringify(body)).toContain('The document: „Bericht“');
      return aiMessage([{ type: 'text', text: 'Um 12 Prozent.', citations: null }], 'end_turn');
    });
    const asked = await heard(
      await ctx.request(`${base}/material-questions`, {
        method: 'POST',
        json: {
          id: crypto.randomUUID(),
          noteId: questionId,
          question: 'Wie stark wächst der Markt?',
        },
      }),
    );
    expect(asked.at(-1)).toMatchObject({
      type: 'done',
      question: { deckId: null, documentId, state: 'done', answer: 'Um 12 Prozent.' },
    });
    expect(await (await ctx.request(`${base}/material-questions`)).json()).toHaveLength(1);
    answers.push(
      aiMessage(
        [
          {
            type: 'tool_use',
            id: 'toolu_2',
            name: 'add_note',
            input: { text: 'Markt: plus 12 Prozent' },
          },
        ],
        'tool_use',
      ),
      aiMessage([{ type: 'text', text: 'Notiert.', citations: null }], 'end_turn'),
    );
    const said = await heard(
      await ctx.request(`${base}/material-chat`, {
        method: 'POST',
        json: { chatId: null, text: 'Notier das Wachstum' },
      }),
    );
    expect(said.at(-1)).toMatchObject({ type: 'done' });
    expect(await (await ctx.request(`${base}/material-chats`)).json()).toHaveLength(1);
    expect(await (await ctx.request(`${base}/material-chats`, { cookie: reader })).json()).toEqual(
      [],
    );
    const withNote = boardSchema.parse(await (await ctx.request(`${base}/board`)).json());
    expect(withNote.items.map((each) => each.text)).toContain('Markt: plus 12 Prozent');

    // A comment handed to the AI: the board is listed, the material tools stand beside
    // edit_document, what it read goes into the text.
    const comment = (await (
      await ctx.request(`${base}/comments`, {
        method: 'POST',
        json: {
          id: crypto.randomUUID(),
          parentId: null,
          body: 'Wachstum nennen',
          anchor: { paragraphId: 'w3', start: 0, end: 2, quote: 'Oh' },
        },
      })
    ).json()) as { id: string };
    answers.push(
      (body) => {
        const sent = body as unknown as { tools: { name: string }[]; messages: unknown[] };
        expect(sent.tools.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(['edit_document', 'read_material', 'search_materials']),
        );
        expect(JSON.stringify(sent.messages)).toMatch(/<material_list>[^]*Studie\.pdf/);
        return readsReport;
      },
      (body) => {
        expect(JSON.stringify(body.messages.at(-1))).toContain('12 Prozent');
        return aiMessage(
          [
            {
              type: 'tool_use',
              id: 'toolu_3',
              name: 'edit_document',
              input: {
                changes: [{ action: 'insert', id: 'w3', text: 'Der Markt wächst um 12 Prozent.' }],
                summary: 'Wachstum genannt.',
              },
            },
          ],
          'tool_use',
        );
      },
    );
    expect(
      (
        await ctx.request(`${base}/ai-proposals`, {
          method: 'POST',
          json: { id: crypto.randomUUID(), commentId: comment.id },
        })
      ).status,
    ).toBe(202);
    await documentAiIdle();
    expect(await (await ctx.request(`${base}/ai-proposals`)).json()).toMatchObject([
      { status: 'applied', summary: 'Wachstum genannt.' },
    ]);
    expect(answers).toEqual([]);

    // Deleted for good, the document takes its board along – rows and bytes.
    await ctx.request('/api/cloud/nodes/trash', { method: 'POST', json: { ids: [documentId] } });
    expect((await ctx.deps.media.list(prefix)).length).toBeGreaterThan(0);
    const purged = await ctx.request('/api/cloud/nodes/purge', {
      method: 'POST',
      json: { ids: [documentId] },
    });
    expect(((await purged.json()) as { purged: string[] }).purged).toEqual([documentId]);
    for (const table of [deckMaterials, deckBoardItems, materialQuestions, materialChats]) {
      expect(
        await ctx.deps.db.select().from(table).where(eq(table.documentId, documentId)),
      ).toEqual([]);
    }
    expect(await ctx.deps.media.list(prefix)).toEqual([]);
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
                content?: {
                  text?: string;
                  resource?: { uri: string; mimeType: string; blob: string };
                }[];
                isError?: boolean;
              };
            })
          : null;
      return { status: res.status, res, body };
    };
    const call = async (token: string, name: string, args: object = {}) => {
      const { body } = await rpc(token, 'tools/call', { name, arguments: args });
      const files = (body?.result.content ?? []).flatMap((part) => part.resource ?? []);
      return {
        text: (body?.result.content ?? []).map((part) => part.text ?? '').join('\n'),
        error: !!body?.result.isError,
        ...(files.length > 0 ? { files } : {}),
      };
    };

    // Without a token (the session cookie goes along, as from a page): 401 with where to sign in.
    const bare = await rpc(null, 'tools/list');
    expect(bare.status).toBe(401);
    expect(bare.res.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`,
    );
    expect((await rpc('slider_at_nope', 'tools/list')).status).toBe(401);
    // … answered before a byte of the body is read: nothing is held for a stranger.
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 200_000) controller.close();
        else controller.enqueue(new Uint8Array(1024));
      },
    });
    const unread = await ctx.request('/api/mcp', {
      method: 'POST',
      body: endless,
      duplex: 'half',
    } as RequestInit);
    expect(unread.status).toBe(401);
    expect(pulled).toBeLessThan(5);
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
    // These need no session: a body is not read further than they need.
    expect(
      (
        await ctx.request('/api/oauth/register', {
          method: 'POST',
          json: { client_name: 'x'.repeat(70_000), redirect_uris: [redirect] },
        })
      ).status,
    ).toBe(413);
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
    // A wrong request of a registered client is shown, not sent to its address: anyone may
    // register any address, so that would be an open redirect without sign-in.
    const wrong = await ctx.request(
      `/api/oauth/authorize?${new URLSearchParams({ response_type: 'token', client_id, redirect_uri: redirect })}`,
      { redirect: 'manual' },
    );
    expect([wrong.status, wrong.headers.get('location')]).toEqual([400, null]);
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
    // The app shows Slider's mark for the connector (MCP `icons`, absolute, on the site).
    const hello = await rpc(tokens.access_token, 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(hello.body?.result).toMatchObject({
      serverInfo: {
        title: 'Slider',
        icons: [
          { src: `${origin}/favicon.svg`, mimeType: 'image/svg+xml' },
          { src: `${origin}/icon-192.png`, mimeType: 'image/png', sizes: ['192x192'] },
        ],
      },
    });

    // The tools: a note on the board under the person's name, found again by search and fetch.
    const { body: listed } = await rpc(tokens.access_token, 'tools/list');
    const names = (listed?.result.tools ?? []).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['search', 'fetch', 'add_note', 'edit_slides']));
    // show_presentation brings a card: an MCP App page that renders the tool's A2UI messages.
    const shown = (listed?.result.tools ?? []).find((tool) => tool.name === 'show_presentation') as
      { _meta?: { ui?: { resourceUri?: string } } } | undefined;
    expect(shown?._meta?.ui?.resourceUri).toBe('ui://slider/presentation.html');
    const page = (await rpc(tokens.access_token, 'resources/read', {
      uri: 'ui://slider/presentation.html',
    })) as unknown as { body: { result: { contents: { mimeType: string; text: string }[] } } };
    expect(page.body.result.contents[0]).toMatchObject({
      mimeType: 'text/html;profile=mcp-app',
      text: expect.stringMatching(/^<!doctype html>[\s\S]*<script type="module">/),
    });
    const card = (await rpc(tokens.access_token, 'tools/call', {
      name: 'show_presentation',
      arguments: { presentation: deck.deckId },
    })) as unknown as {
      body: {
        result: {
          content: { type: string; text?: string; resource?: { mimeType: string; text: string } }[];
        };
      };
    };
    // For the model a line and what view_slide gives (its picture too, where the slide has one –
    // these test slides have none), the card beside them.
    expect(card.body.result.content.map((part) => part.type)).toEqual(['text', 'text', 'resource']);
    expect(card.body.result.content[0]!.text).toMatch(/slide 1 of 2\.$/);
    expect(card.body.result.content[1]!.text).toContain('(No picture of this slide.)');
    const a2ui = card.body.result.content.find(
      (part) => part.resource?.mimeType === 'application/a2ui+json',
    );
    expect(JSON.parse(a2ui!.resource!.text)[0]).toEqual({
      version: '1.0',
      createSurface: {
        surfaceId: 'slider-presentation',
        catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
      },
    });
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
    // Reviewing and ticking off: a comment written, marked done, open again.
    const at = { presentation: deck.deckId };
    const commented = await call(tokens.access_token, 'add_comment', {
      ...at,
      slide: 1,
      text: 'Zu viel Text',
    });
    const commentId = /^Comment (\S+) written/.exec(commented.text)![1]!;
    expect(
      (await call(tokens.access_token, 'resolve_comment', { ...at, comment: commentId })).text,
    ).toMatch(/is done/);
    expect((await call(tokens.access_token, 'list_comments', at)).text).not.toContain(
      'Zu viel Text',
    );
    expect((await call(tokens.access_token, 'list_comments', { ...at, done: true })).text).toMatch(
      /\(done\): Zu viel Text/,
    );
    await call(tokens.access_token, 'resolve_comment', { ...at, comment: commentId, done: false });
    expect((await call(tokens.access_token, 'list_comments', at)).text).toContain('Zu viel Text');
    expect(await call(tokens.access_token, 'undo_edit', { ...at, edit: 'nope' })).toMatchObject({
      error: true,
      text: expect.stringMatching(/^No change "nope"/),
    });
    // Managing: renamed and archived; where it lies is said by moving it (below), not here.
    expect(
      (
        await call(tokens.access_token, 'update_presentation', {
          ...at,
          title: 'Quartal',
          archived: true,
        })
      ).text,
    ).toMatch(/^„Quartal“: renamed „Quartal“, archived\./);
    expect(await call(tokens.access_token, 'update_presentation', at)).toMatchObject({
      error: true,
      text: expect.stringMatching(/^Say what to change: `title` or `archived`\./),
    });
    await call(tokens.access_token, 'update_presentation', { ...at, archived: false });
    // The files beside it (Cloud), with the same tools as the AI there: looked around, a text
    // file written, a folder made – and the presentation put into it by its own id.
    expect(names).toEqual(expect.arrayContaining(['list_folder', 'move_files', 'write_file']));
    const top = (await call(tokens.access_token, 'list_folder')).text;
    expect(top).toMatch(/^Meine Dateien:/);
    expect(top).toContain('Areas:');
    const wrote = await call(tokens.access_token, 'write_file', {
      name: 'Notiz.md',
      content: '# Notiz',
      own: true,
    });
    expect(wrote.text).toMatch(/^Wrote „Notiz\.md“ \(file id \S+\): http/);
    expect(
      await call(tokens.access_token, 'write_file', { name: 'a.exe', content: 'x', own: true }),
    ).toMatchObject({ error: true, text: expect.stringMatching(/^Only text files/) });
    const folderId = /folder id (\S+)|folder (\S+) /.exec(
      (await call(tokens.access_token, 'create_folder', { name: 'Ablage', own: true })).text,
    );
    const ablage = (await call(tokens.access_token, 'list_folder')).text;
    expect(ablage).toContain('Notiz.md');
    const ablageId = /folder (\S+) „Ablage“/.exec(ablage)?.[1] ?? folderId?.[1] ?? '';
    // One whose file is missing says so; a new one lies in „Meine Dateien“ and moves from there.
    expect(
      await call(tokens.access_token, 'move_files', { items: [deck.deckId], folder: ablageId }),
    ).toEqual({ text: 'Die Datei der Präsentation fehlt.', error: true });
    const newDeck = /\(id ([^)\s]+)\)/.exec(
      (await call(tokens.access_token, 'create_presentation', { title: 'Neu aus der App' })).text,
    )?.[1];
    expect(
      await call(tokens.access_token, 'move_files', { items: [newDeck], folder: ablageId }),
    ).toEqual({ text: 'Moved: 1.', error: false });
    expect((await call(tokens.access_token, 'list_folder', { folder: ablageId })).text).toContain(
      `presentation ${newDeck}`,
    );
    // A whole new order in one call: folders in each other by their keys, moves into them, a
    // name – and what is refused is left out and named while the rest is done.
    expect(names).toEqual(expect.arrayContaining(['list_tree', 'reorganize_files']));
    const noteId = /file id (\S+)\)/.exec(wrote.text)?.[1] ?? '';
    expect(
      await call(tokens.access_token, 'reorganize_files', {
        folders: [{ key: 'n', name: 'Notizen', new: 'y' }],
      }),
    ).toMatchObject({ error: true, text: expect.stringMatching(/"y".*Nothing was done\.$/) });
    const plan = await call(tokens.access_token, 'reorganize_files', {
      folders: [
        { key: 'y', name: '2026', own: true },
        { key: 'n', name: 'Notizen', new: 'y' },
      ],
      moves: [
        { items: [noteId], new: 'n' },
        { items: ['nope'], folder: ablageId },
      ],
      renames: [{ item: ablageId, name: 'Archiv' }],
    });
    expect(plan.error).toBe(false);
    expect(plan.text).toMatch(
      /^Plan carried out: 2 folders made, 1 moved, 1 renamed\.\nNew folder "y": id \S+\nNew folder "n": id \S+\nLeft out – everything else is done:\nNot done – the move of 1 into /,
    );
    const tree = (await call(tokens.access_token, 'list_tree')).text;
    expect(tree).toMatch(/^Meine Dateien, everything below \(5 folders and files\):\n/);
    expect(tree).toMatch(
      /\nfolder \S+ „2026“\n {2}folder \S+ „Notizen“\n {4}file \S+ „Notiz\.md“\n/,
    );
    expect(tree).toContain(`„Archiv“\n  file `);
    expect(tree).toContain(`, presentation ${newDeck}`);
    expect((await call(tokens.access_token, 'list_tree', { files: false })).text).toMatch(
      /everything below \(3 folders, 0 files at its top\):\nfolder \S+ „2026“ \(0 files\)\n {2}folder \S+ „Notizen“ \(1 files\)\n/,
    );
    expect(await call(tokens.access_token, 'list_folder', { workspace: 'nope' })).toMatchObject({
      error: true,
      text: expect.stringMatching(/^No workspace "nope"/),
    });
    // Areas and their people: one made for a team alone, then opened and renamed.
    expect(names).toEqual(
      expect.arrayContaining(['create_area', 'share_file', 'restore_files', 'edit_document']),
    );
    await member('Mona', 'reviewer');
    // The workspace's own area, no „Entwürfe“ besides it.
    expect((await call(tokens.access_token, 'list_areas')).text).toMatch(
      /^(?![\s\S]*Entwürfe)area \S+ „[^“]+“ – /,
    );
    const team = { name: 'Vertrieb', people_only: true };
    expect(
      await call(tokens.access_token, 'create_area', { ...team, members: ['Niemand'] }),
    ).toMatchObject({ error: true, text: expect.stringMatching(/^Nobody "Niemand" in the/) });
    const areaMade = await call(tokens.access_token, 'create_area', { ...team, members: ['Mona'] });
    expect(areaMade.text).toMatch(
      /^Made: area \S+ „Vertrieb“ – only its people see it; people: [^;]*Mona[^;]*; 0 files; /,
    );
    const teamId = /^Made: area (\S+) /.exec(areaMade.text)?.[1] ?? '';
    expect(
      (
        await call(tokens.access_token, 'update_area', {
          area: teamId,
          name: 'Sales',
          people_only: false,
        })
      ).text,
    ).toMatch(/^Now: area \S+ „Sales“ – everyone in the workspace sees it; people: [^;]*Mona/);
    expect(await call(tokens.access_token, 'update_area', { area: teamId })).toMatchObject({
      error: true,
      text: expect.stringMatching(/^Say what to change/),
    });
    // A text document (Writer): made with its text in that area, read, changed by paragraph.
    const docMade = await call(tokens.access_token, 'create_document', {
      title: 'Protokoll',
      text: '# Kickoff\nErster Absatz\n- Ein Punkt',
      area: teamId,
    });
    expect(docMade.text).toMatch(
      /^Created „Protokoll“ \(document id \S+\): http\S+\/t\/\S+\nText written: \d+ paragraphs\.\nIt lies where it was to go\.$/,
    );
    const docId = /document id (\S+)\)/.exec(docMade.text)?.[1] ?? '';
    const docText = (await call(tokens.access_token, 'read_document', { document: docId })).text;
    expect(docText).toMatch(
      /^„Protokoll“ \(document id \S+\) in Sales: http\S+\n\n<p id="[^"]+" kind="heading" level="1">Kickoff<\/p>\n<p id="[^"]+">Erster Absatz<\/p>\n<p id="[^"]+" list="bullet">Ein Punkt<\/p>$/,
    );
    const paragraphId = /<p id="([^"]+)">Erster Absatz/.exec(docText)?.[1] ?? '';
    expect(
      await call(tokens.access_token, 'edit_document', {
        document: docId,
        changes: [{ action: 'replace', id: 'nope', text: 'x' }],
      }),
    ).toEqual({ text: 'There is no paragraph "nope".', error: true });
    expect(
      (
        await call(tokens.access_token, 'edit_document', {
          document: docId,
          changes: [
            { action: 'replace', id: paragraphId, text: 'Zweiter **Anlauf**' },
            { action: 'insert', id: paragraphId, text: 'Danach' },
          ],
        })
      ).text,
    ).toMatch(/^Written into „Protokoll“: http/);
    expect((await call(tokens.access_token, 'read_document', { document: docId })).text).toContain(
      '>Zweiter **Anlauf**</p>\n<p id="',
    );
    expect((await call(tokens.access_token, 'list_documents', { query: 'proto' })).text).toMatch(
      new RegExp(`^document ${docId} „Protokoll“ in Sales – changed \\S+: http\\S+$`),
    );
    // Its versions, and the one before brought back; shared with one person, and no longer.
    const details = (await call(tokens.access_token, 'file_details', { item: docId })).text;
    expect(details).toMatch(
      /^file \S+ „Protokoll\.odt“ in area „Sales“ – [^\n]+\nReached there by everyone in the workspace \(\d+\)\.\nShared with: nobody besides\.\nVersions:\n- version \S+: no\. \d+, [^\n]+ \(current\)\n- version /,
    );
    const before = /\(current\)\n- version (\S+): /.exec(details)?.[1];
    expect(
      await call(tokens.access_token, 'restore_version', { item: ablageId, version: before }),
    ).toMatchObject({ error: true });
    expect(
      (await call(tokens.access_token, 'restore_version', { item: docId, version: before })).text,
    ).toBe('„Protokoll.odt“: that version is its newest again.');
    expect((await call(tokens.access_token, 'read_document', { document: docId })).text).toContain(
      '>Erster Absatz</p>',
    );
    const shareWith = { item: docId, person: 'Mona' };
    expect(await call(tokens.access_token, 'share_file', { ...shareWith, role: 'edit' })).toEqual({
      text: 'Shared „Protokoll.odt“ with Mona (edit).',
      error: false,
    });
    expect((await call(tokens.access_token, 'file_details', { item: docId })).text).toContain(
      'Shared with: Mona (edit).',
    );
    expect((await call(tokens.access_token, 'unshare_file', shareWith)).text).toBe(
      '„Protokoll.odt“ is no longer shared with Mona.',
    );
    expect((await call(tokens.access_token, 'unshare_file', shareWith)).text).toBe(
      '„Protokoll.odt“ is not shared with Mona.',
    );
    // Copied, coloured, pinned; a version named and one deleted; no link where links are off.
    expect((await call(tokens.access_token, 'copy_files', { items: [docId], own: true })).text).toMatch(
      /^Copied: 1 \(\S+ „Protokoll\.odt“\)\.$/,
    );
    expect((await call(tokens.access_token, 'set_color', { item: ablageId, color: 'green' })).text).toMatch(
      / is green now\.$/,
    );
    expect((await call(tokens.access_token, 'pin_folder', { item: ablageId, pinned: true })).text).toMatch(
      / is pinned\.$/,
    );
    expect(
      (await call(tokens.access_token, 'label_version', { item: docId, version: before, label: 'Für Kunde' }))
        .text,
    ).toMatch(/^Version \d+ is „Für Kunde“ now\.$/);
    expect((await call(tokens.access_token, 'delete_version', { item: docId, version: before })).text).toBe(
      'That version is deleted.',
    );
    expect(await call(tokens.access_token, 'share_link', { item: docId })).toEqual({
      text: expect.stringContaining('Links nach außen gibt es hier nicht'),
      error: true,
    });
    expect(await call(tokens.access_token, 'delete_area', { area: 'nope' })).toMatchObject({
      error: true,
    });
    // Deleted is not gone: it lies in „Gelöscht“ and comes back from there.
    await call(tokens.access_token, 'delete_files', { items: [docId] });
    expect((await call(tokens.access_token, 'list_deleted')).text).toMatch(
      new RegExp(`file ${docId} „Protokoll\\.odt“ – deleted \\S+ by [^,]+, \\d+ days left`),
    );
    expect(await call(tokens.access_token, 'restore_files', { items: [docId] })).toEqual({
      text: 'Back: 1 („Protokoll.odt“).',
      error: false,
    });
    expect(
      await call(tokens.access_token, 'set_access', {
        ...at,
        restricted: true,
        people: ['Niemand'],
      }),
    ).toMatchObject({ error: true, text: expect.stringMatching(/is not in the workspace/) });
    expect(
      (await call(tokens.access_token, 'set_access', { ...at, restricted: true, people: [] })).text,
    ).toMatch(/^Only nobody else open „Quartal“/);
    expect(
      (await call(tokens.access_token, 'set_access', { ...at, restricted: false })).text,
    ).toMatch(/^Everyone in the workspace opens/);
    expect(
      await call(tokens.access_token, 'download_presentation', { ...at, format: 'png' }),
    ).toMatchObject({ error: true, text: 'A picture is of one slide – give `slide`.' });
    // Only what Slider can export – a deck it does not edit says why, as the page does.
    expect(
      await call(tokens.access_token, 'download_presentation', { ...at, format: 'odp' }),
    ).toMatchObject({ error: true, text: expect.stringMatching(/nur bei ODP/) });
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
    for (const [tool, args] of [
      ['read_document', { document: docId }],
      ['file_details', { item: docId }],
      ['share_file', { item: docId, person: 'Mona' }],
      ['restore_files', { items: [docId] }],
      ['update_area', { area: teamId, name: 'Fremd' }],
    ] as const)
      expect(await call(held, tool, args), tool).toMatchObject({ error: true });
    expect((await call(held, 'list_documents')).text).toBe('No documents.');
    // … whatever is asked of it: where it lies is looked at before what the person may do.
    expect(await call(held, 'delete_presentation', { presentation: deck.deckId })).toEqual({
      text: `No presentation "${deck.deckId}" – list_presentations finds it.`,
      error: true,
    });
    // … nor shows it as a card: no picture, no slide count, no card.
    expect(await call(held, 'show_presentation', { presentation: deck.deckId })).toEqual({
      text: `No presentation "${deck.deckId}" – list_presentations finds it.`,
      error: true,
    });
    // Nor that the workspace it lies in is blocked: the same answer as for none at all.
    await ctx.deps.db
      .update(workspaces)
      .set({ blockedAt: new Date() })
      .where(eq(workspaces.id, ctx.workspaceId));
    expect(await call(held, 'get_presentation', { presentation: deck.deckId })).toEqual({
      text: `No presentation "${deck.deckId}" – list_presentations finds it.`,
      error: true,
    });
    await ctx.deps.db
      .update(workspaces)
      .set({ blockedAt: null })
      .where(eq(workspaces.id, ctx.workspaceId));
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
