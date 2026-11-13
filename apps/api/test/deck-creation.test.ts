import { fileUrlAt } from '../src/storage/file-urls';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deckCreationSchema,
  deckEditStateSchema,
  deckSchema,
  type DeckCreation,
} from '@slider/shared';
import { LiveHub } from '../src/realtime/live-hub';
import { creationAtWork } from '../src/services/deck-creation';
import { createTestContext, type TestContext } from './helpers';
import { DEMO_ODP, fakeOdpPdf } from './odp-helpers';

/* A new deck built by the AI from the prompt on Folie 1, its material read first. */

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

type Step =
  | Anthropic.Beta.BetaMessage
  | ((body: Anthropic.Beta.MessageCreateParams) => Promise<Anthropic.Beta.BetaMessage>);

/** Anthropic as the run uses it: scripted answers, the requests recorded. */
class FakeAnthropic {
  requests: Anthropic.Beta.MessageCreateParams[] = [];
  steps: Step[] = [];
  readonly client = (): Anthropic =>
    ({
      models: {
        retrieve: async (model: string) => ({ id: model, max_tokens: 64_000 }),
        list: () =>
          (async function* () {
            await Promise.resolve();
            yield { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' };
          })(),
      },
      beta: {
        messages: {
          stream: (body: Anthropic.Beta.MessageCreateParams) => {
            this.requests.push(structuredClone(body));
            const next = this.steps.shift();
            return {
              finalMessage: async () => {
                if (!next) throw new Error('no scripted answer left');
                return typeof next === 'function' ? next(body) : next;
              },
              currentMessage: undefined,
              abort: () => undefined,
            };
          },
        },
      },
    }) as unknown as Anthropic;
}

const message = (
  content: unknown[],
  stop: Anthropic.Beta.BetaStopReason,
): Anthropic.Beta.BetaMessage =>
  ({
    id: `msg_${Math.random()}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  }) as unknown as Anthropic.Beta.BetaMessage;
const call = (name: string, input: unknown) => ({
  type: 'tool_use',
  id: `toolu_${Math.random()}`,
  name,
  input,
});
const said = (text: string) => message([{ type: 'text', text, citations: null }], 'end_turn');

/** The results of the last tool calls, as the AI got them, as text. */
const lastResults = (body: Anthropic.Beta.MessageCreateParams) =>
  JSON.stringify(body.messages.findLast((m) => m.role === 'user')!.content);

const b64 = (text: string) => Buffer.from(text).toString('base64');

describe('deck creation', { timeout: 120_000 }, () => {
  it('reads the material, outlines, builds slide after slide – stopped, the slides built stay; dismissed, the prompt is gone', async () => {
    const anthropic = new FakeAnthropic();
    const live = new LiveHub();
    ctx = await createTestContext({
      libreOfficePdf: fakeOdpPdf(),
      anthropic: anthropic.client,
      live,
      config: { dataDir: await mkdtemp(path.join(tmpdir(), 'slider-creation-')) },
    });
    const context = ctx;
    await context.request(`/api/workspaces/${context.workspaceId}/integrations/keys`, {
      method: 'POST',
      json: { kind: 'ai', provider: 'anthropic', apiKey: 'sk-ant-api03-good-AbCdEfGhIjKlMnOpQrSt' },
    });
    const blank = async () => {
      const res = await context.request('/api/decks/blank', { method: 'POST', json: {} });
      expect(res.status).toBe(201);
      const deck = deckSchema.parse(await res.json());
      await context.deps.queue.idle();
      return deck.id;
    };
    const creation = async (deckId: string): Promise<DeckCreation | null> => {
      const res = await context.request(`/api/decks/${deckId}/creation`);
      expect(res.status).toBe(200);
      return deckCreationSchema.nullable().parse(await res.json());
    };
    const editState = async (deckId: string) =>
      deckEditStateSchema.parse(await (await context.request(`/api/decks/${deckId}/edit`)).json());

    const deckId = await blank();
    expect(await creation(deckId)).toMatchObject({ status: 'offered', prompt: true, built: 0 });

    // A spreadsheet in the material, over tus as the board takes files.
    const csv = new TextEncoder().encode('Quartal,Umsatz\nQ1,1200\nQ2,1850\n');
    const tus = (url: string, init: RequestInit) =>
      context.request(url, {
        ...init,
        headers: { 'Tus-Resumable': '1.0.0', ...(init.headers as Record<string, string>) },
      });
    const created = await tus('/api/decks/tus', {
      method: 'POST',
      headers: {
        'Upload-Length': String(csv.length),
        'Upload-Metadata': `filename ${b64('zahlen.csv')},purpose ${b64('material')},deckId ${b64(deckId)}`,
      },
    });
    const upload = created.headers.get('location') ?? '';
    await tus(upload, {
      method: 'PATCH',
      body: csv,
      headers: { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' },
    });
    expect(
      (
        await context.request(`/api/decks/${deckId}/materials`, {
          method: 'POST',
          json: {
            id: crypto.randomUUID(),
            upload: upload.split('/').pop(),
            x: 0,
            y: 0,
            w: 220,
            h: 200,
          },
        })
      ).status,
    ).toBe(201);
    await context.deps.queue.idle();
    await vi.waitFor(async () => {
      const board = (await (await context.request(`/api/decks/${deckId}/board`)).json()) as {
        materials: { readState: string }[];
      };
      expect(board.materials[0]?.readState).toBe('done');
    });

    const creationChanged = vi.spyOn(live, 'creationChanged');
    const slidesChanged = vi.spyOn(live, 'slidesChanged');
    let outlineSeen: DeckCreation | null = null;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let asked: () => void = () => undefined;
    const atSlide2 = new Promise<void>((resolve) => (asked = resolve));
    anthropic.steps = [
      message(
        [call('list_materials', {}), call('read_sheet', { material: 'zahlen.csv' })],
        'tool_use',
      ),
      async (body) => {
        // The material tools answered with the cells.
        expect(lastResults(body)).toContain('1850');
        return message(
          [
            call('write_outline', {
              slides: [
                { title: 'Umsatz 2026', message: 'Wir wachsen.', layout: 'Titelfolie' },
                { title: 'Q2: 1850', message: 'Q2 schlägt Q1.', layout: 'Zahlen' },
              ],
            }),
          ],
          'tool_use',
        );
      },
      async (body) => {
        outlineSeen = await creation(deckId);
        expect(lastResults(body)).toContain('Build slide 1 of 2');
        return message([call('insert_slide', { after: 1, master: 'Default' })], 'tool_use');
      },
      message(
        [
          call('change_elements', {
            slide: 2,
            changes: [
              { add: 'text', text: ['Umsatz 2026'], box: { x: 2, y: 2, width: 20, height: 3 } },
            ],
          }),
        ],
        'tool_use',
      ),
      said('Titelfolie steht.'),
      async () => {
        // Slide 2 at work: „Abbrechen“ – slide 1 stays, nothing more is asked.
        asked();
        await held;
        return message([call('insert_slide', { after: 1, master: 'Default' })], 'tool_use');
      },
    ];

    const started = await context.request(`/api/decks/${deckId}/creation`, {
      method: 'POST',
      json: {
        description: 'Umsatz 2026 für den Vorstand',
        kind: 'status',
        pages: 5,
        templateId: null,
      },
    });
    expect(started.status).toBe(202);
    // Asked again while it runs: refused.
    expect(
      (
        await context.request(`/api/decks/${deckId}/creation`, {
          method: 'POST',
          json: { description: 'Nochmal', kind: 'status', pages: 5, templateId: null },
        })
      ).status,
    ).toBe(409);
    await vi.waitFor(async () => expect((await creation(deckId))?.built).toBe(1), {
      timeout: 30_000,
    });
    // The outline was shown before any slide.
    expect(outlineSeen).toMatchObject({
      status: 'running',
      built: 0,
      step: 'Folie 1 von 2',
      outline: [{ title: 'Umsatz 2026' }, { title: 'Q2: 1850' }],
    });
    // The first request: the description, the kind's guide, the material listed; the tools.
    const first = anthropic.requests[0]!;
    const opening = JSON.stringify(first.messages[0]);
    expect(opening).toContain('Umsatz 2026 für den Vorstand');
    expect(opening).toContain('project status report');
    expect(opening).toContain('zahlen.csv');
    const names = first.tools?.map((tool) => ('name' in tool ? tool.name : ''));
    expect(names).toEqual(
      expect.arrayContaining(['write_outline', 'read_sheet', 'change_elements']),
    );
    expect(names).not.toContain('add_comment');

    // Slide 1 is in the deck, the empty start slide gone.
    const state = await editState(deckId);
    expect(state.slides).toHaveLength(1);
    expect(JSON.stringify(state.slides[0]!.elements)).toContain('Umsatz 2026');
    expect(creationChanged).toHaveBeenCalledWith(deckId);
    expect(slidesChanged).toHaveBeenCalledWith(deckId, expect.anything());

    await atSlide2;
    expect(
      (await context.request(`/api/decks/${deckId}/creation/cancel`, { method: 'POST' })).status,
    ).toBe(204);
    const requests = anthropic.requests.length;
    release();
    await vi.waitFor(async () =>
      expect(await creation(deckId)).toMatchObject({
        status: 'cancelled',
        built: 1,
        prompt: false,
      }),
    );
    // The run settles: its last answer is not written, the AI not asked again.
    await vi.waitFor(() => expect(creationAtWork(deckId)).toBe(false), { timeout: 30_000 });
    expect((await editState(deckId)).slides).toHaveLength(1);
    expect(anthropic.requests).toHaveLength(requests);

    // „Leer anfangen“ on another new deck: the prompt goes for good, nothing starts there.
    const other = await blank();
    expect(
      (await context.request(`/api/decks/${other}/creation/dismiss`, { method: 'POST' })).status,
    ).toBe(204);
    expect(await creation(other)).toMatchObject({ status: 'dismissed', prompt: false });
    expect(
      (
        await context.request(`/api/decks/${other}/creation`, {
          method: 'POST',
          json: { description: 'Doch', kind: 'pitch', pages: 12, templateId: null },
        })
      ).status,
    ).toBe(409);

    // A template asked for: the deck takes its look first, the AI builds on its layouts.
    const zip = await JSZip.loadAsync(DEMO_ODP);
    const templateType = 'application/vnd.oasis.opendocument.presentation-template';
    zip.file('mimetype', templateType, { compression: 'STORE' });
    const manifest = await zip.file('META-INF/manifest.xml')!.async('string');
    zip.file(
      'META-INF/manifest.xml',
      manifest.replace(
        'manifest:media-type="application/vnd.oasis.opendocument.presentation"/>',
        `manifest:media-type="${templateType}"/>`,
      ),
    );
    const otp = await zip.generateAsync({ type: 'uint8array' });
    const form = new FormData();
    form.append('file', new File([otp as Uint8Array<ArrayBuffer>], 'Firmendesign.otp'));
    const uploaded = await context.request(`/api/workspaces/${context.workspaceId}/masters`, {
      method: 'POST',
      body: form,
    });
    expect(uploaded.status).toBe(200);
    const [template] = (await uploaded.json()) as { id: string }[];
    await context.deps.queue.idle();
    const third = await blank();
    const before = anthropic.requests.length;
    anthropic.steps = [
      message(
        [
          call('write_outline', {
            slides: [{ title: 'Hallo', message: 'Hallo.', layout: 'Titel' }],
          }),
        ],
        'tool_use',
      ),
      said('Nichts zu tun.'),
    ];
    expect(
      (
        await context.request(`/api/decks/${third}/creation`, {
          method: 'POST',
          json: { description: 'Mit Vorlage', kind: 'keynote', pages: 5, templateId: template!.id },
        })
      ).status,
    ).toBe(202);
    await vi.waitFor(async () => expect((await creation(third))?.status).toBe('done'), {
      timeout: 30_000,
    });
    expect(JSON.stringify(anthropic.requests[before]!.messages[0])).toContain(
      'The deck has taken the chosen template',
    );
    const { layouts } = (await (await context.request(`/api/decks/${third}/layouts`)).json()) as {
      layouts: unknown[];
    };
    expect(layouts.length).toBeGreaterThan(1);

    // Completed presentations survive a different browser; retention removes the oldest file.
    const thumbnail = `decks/${deckId}/summary-thumbnail.png`;
    await context.deps.storage.put(thumbnail, new Uint8Array([1, 2, 3]));
    const run = {
      at: new Date().toISOString(),
      total: 1200,
      rows: [
        {
          slideId: 'slide-1',
          number: 1,
          title: 'Slide 1',
          aspectRatio: 16 / 9,
          ms: 1200,
          skipped: false,
          thumbnailUrl: fileUrlAt(thumbnail, Math.floor(Date.now() / 1000) - 86400),
        },
      ],
    };
    const duplicateId = crypto.randomUUID();
    const duplicate = await Promise.all(
      Array.from({ length: 3 }, () =>
        context.request(`/api/decks/${third}/runs`, {
          method: 'POST',
          json: { id: duplicateId, run },
        }),
      ),
    );
    expect(duplicate.map((each) => each.status).sort()).toEqual([200, 200, 201]);
    const runIds: string[] = [];
    let firstRecording = '';
    for (let i = 0; i < 6; i++) {
      const id = crypto.randomUUID();
      runIds.push(id);
      const video = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109]);
      const created = await tus('/api/decks/tus', {
        method: 'POST',
        headers: {
          'Upload-Length': String(video.length),
          'Upload-Metadata': `filename ${b64('show.mp4')},purpose ${b64('recording')},deckId ${b64(deckId)}`,
        },
      });
      const location = created.headers.get('location')!;
      expect(created.status).toBe(201);
      await tus(location, {
        method: 'PATCH',
        body: video,
        headers: { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' },
      });
      const result = await context.request(`/api/decks/${deckId}/runs`, {
        method: 'POST',
        json: { id, run, upload: location.split('/').pop() },
      });
      expect(result.status).toBe(201);
      const saved = (await result.json()) as { recordingUrl: string };
      if (i === 0) firstRecording = saved.recordingUrl;
      const played = await context.request(saved.recordingUrl, { headers: { Range: 'bytes=4-7' } });
      expect(played.status).toBe(206);
      expect(await played.text()).toBe('ftyp');
      const streamSpy = vi.spyOn(context.deps.storage, 'stream');
      const head = await context.request(saved.recordingUrl, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(streamSpy).not.toHaveBeenCalled();
      streamSpy.mockRestore();
      // Same completion retried, no second row or upload needed.
      expect(
        (await context.request(`/api/decks/${deckId}/runs`, { method: 'POST', json: { id, run } }))
          .status,
      ).toBe(200);
    }
    const runs = (await (await context.request(`/api/decks/${deckId}/runs`)).json()) as {
      id: string;
      rows: { thumbnailUrl: string }[];
    }[];
    expect(runs).toHaveLength(5);
    const freshThumbnail = runs[0]!.rows[0]!.thumbnailUrl;
    expect(freshThumbnail).not.toBe(run.rows[0]!.thumbnailUrl);
    expect((await context.request(freshThumbnail)).status).toBe(200);
    expect(runs.map((each) => each.id)).not.toContain(runIds[0]);
    expect((await context.request(firstRecording)).status).toBe(404);
    const keys = await context.deps.storage.list(`decks/${deckId}/runs/`);
    expect(keys).toHaveLength(5);
    await context.deps.background?.idle();
    const usage = await context.deps.db.query.aiUsage.findMany();
    expect(usage.some((each) => each.feature === 'create' && each.inputTokens > 0)).toBe(true);
  });
});
