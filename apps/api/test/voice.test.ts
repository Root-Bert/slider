import type Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aiProposalSchema,
  commentSchema,
  deckEditStateSchema,
  deckSchema,
  instanceAiUsageSchema,
  slideSchema,
  voiceLiveSchema,
  voiceSessionSchema,
  type VoiceSegmentMeta,
  type VoiceSession,
} from '@slider/shared';
import { comments, workspaceMembers } from '../src/db/schema';
import { workspaceSpeechConnection } from '../src/services/integration-keys';
import { clearOf, placesAgree } from '../src/services/voice/quick-edits';
import { readActions } from '../src/services/voice/router';
import { endAllVoiceSessions } from '../src/services/voice/session';
import { createTestContext, signedInUser, type TestContext } from './helpers';
import { DEMO_ODP, fakeOdpPdf, odpForm } from './odp-helpers';

/* Speaking to the AI: pieces of speech become comments, finished ones go to the AI. */

let ctx: TestContext | undefined;
afterEach(async () => {
  endAllVoiceSessions();
  await ctx?.cleanup();
  ctx = undefined;
});

type Act = { actions: Record<string, unknown>[] };

/** Anthropic: the router's answers in turn (`act`), the editing AI changes nothing. */
function fakeAnthropic(router: Act[]) {
  const seen: Anthropic.Beta.MessageCreateParams[] = [];
  const reply = (content: unknown[], stop: string) => ({
    id: `msg_${Math.random()}`,
    type: 'message',
    role: 'assistant',
    model: 'x',
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const client = () =>
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
            seen.push(structuredClone(body));
            const isRouter = body.tools?.some((tool) => 'name' in tool && tool.name === 'act');
            const answer = isRouter
              ? reply(
                  [
                    {
                      type: 'tool_use',
                      id: 'toolu_1',
                      name: 'act',
                      input: router.shift() ?? { actions: [] },
                    },
                  ],
                  'tool_use',
                )
              : reply([{ type: 'text', text: 'Verstanden.', citations: null }], 'end_turn');
            return {
              finalMessage: async () => answer,
              currentMessage: undefined,
              abort: () => undefined,
            };
          },
        },
      },
    }) as unknown as Anthropic;
  return { client, seen };
}

/** A short WAV as the browser sends it: 16 kHz, 16-bit, mono, silence. */
function wav(): Blob {
  const bytes = new Uint8Array(44 + 3200);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) =>
    bytes.set(
      [...text].map((char) => char.charCodeAt(0)),
      offset,
    );
  write(0, 'RIFF');
  view.setUint32(4, 36 + 3200, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, 3200, true);
  return new Blob([bytes], { type: 'audio/wav' });
}

describe('speaking to the AI', () => {
  it('turns pieces of speech into comments at the place pointed at, finishes them, adds to them, drops them, obeys commands – and asks the AI for each finished one', async () => {
    const heard: string[] = [
      'Den Titel hier bitte',
      'deutlich größer und fett.',
      'Untertitel im Auftrag des ZDF, 2020',
      'Nächste Folie.',
      'Hier fehlt eine Quelle',
      'Und beim Titel noch in Rot.',
      'Ach nee, vergiss das mit der Quelle.',
      'Eins.',
      'Zwei. Drei.',
    ];
    const transcribed: FormData[] = [];
    const transcribedAt: string[] = [];
    const liveAsked: { model: string }[] = [];
    let hold: Promise<void> | null = null;
    const router: Act[] = [];
    const anthropic = fakeAnthropic(router);
    ctx = await createTestContext({
      libreOfficePdf: fakeOdpPdf(),
      anthropic: anthropic.client,
      instanceAdmin: true,
      config: { speech: { url: 'http://stt:8000/v1', model: 'whisper-large-v3-turbo' } },
      aiFetch: async (url, init) => {
        if (url.endsWith('/audio/transcriptions')) {
          transcribed.push(init?.body as FormData);
          transcribedAt.push(url);
          await hold;
          return Response.json({ text: heard.shift() ?? '' });
        }
        if (url.endsWith('/client/sessions')) {
          liveAsked.push(JSON.parse(String(init?.body)) as { model: string });
          return Response.json({
            object: 'client.session',
            client_secret: { value: 'rt_test', expires_at: '2026-10-31T12:15:00Z' },
          });
        }
        return Response.json({ data: [{ id: 'whisper-large-v3-turbo' }] });
      },
    });
    const context = ctx;
    const deck = deckSchema.parse(
      await (
        await context.request('/api/decks/upload', { method: 'POST', body: odpForm(DEMO_ODP) })
      ).json(),
    );
    await context.deps.queue.idle();
    const slides = slideSchema
      .array()
      .parse(await (await context.request(`/api/decks/${deck.id}/slides`)).json());
    const [first, second] = slides as [(typeof slides)[0], (typeof slides)[0]];
    const title = first.shapes.find((shape) => shape.text.trim())!;
    const other = first.shapes.find((shape) => shape.id !== title.id)!;

    // Without an AI it does not start: it decides what the speech is.
    const refused = await context.request(`/api/decks/${deck.id}/voice`, { method: 'POST' });
    expect(refused.status).toBe(409);
    await context.request(`/api/workspaces/${context.workspaceId}/integrations/keys`, {
      method: 'POST',
      json: { kind: 'ai', provider: 'anthropic', apiKey: 'sk-ant-api03-good-AbCdEfGhIjKlMnOpQrSt' },
    });
    // Recordings stay on the self-hosted Whisper; speaking to the AI has a kind of its own, here the
    // instance's Mistral key – a service is faster.
    await context.request('/api/instance/integrations/keys', {
      method: 'POST',
      json: { kind: 'voice', provider: 'mistral', apiKey: 'mistral-good-12345678' },
    });
    expect(
      (await workspaceSpeechConnection(context.deps, context.workspaceId)).connection?.provider,
    ).toBe('self-hosted');
    // The integrations page shows it as a section of its own, taken over from the instance.
    const integrations = (await (
      await context.request(`/api/workspaces/${context.workspaceId}/integrations`)
    ).json()) as { areas: { voice: { inherited: unknown }; live: { inherited: unknown } } };
    expect(integrations.areas.voice.inherited).toMatchObject({ provider: 'mistral' });
    // The Mistral key is taken over once for the words live, on the realtime model.
    expect(integrations.areas.live.inherited).toMatchObject({
      provider: 'mistral',
      model: 'voxtral-mini-transcribe-realtime-3',
    });
    const started = await context.request(`/api/decks/${deck.id}/voice`, { method: 'POST' });
    expect(started.status).toBe(201);
    const session = voiceSessionSchema.parse(await started.json());
    expect(session).toMatchObject({
      aiEdits: true,
      speechService: 'Mistral AI',
      items: [],
      ended: false,
    });
    // The browser streams to Mistral itself, with a token for the model – never the key.
    const live = voiceLiveSchema.parse(
      await (await context.request(`/api/voice/${session.id}/live`, { method: 'POST' })).json(),
    );
    expect(live).toMatchObject({
      provider: 'mistral',
      token: 'rt_test',
      url: 'wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=voxtral-mini-transcribe-realtime-3',
    });
    expect(live!.terms).toEqual(expect.arrayContaining(['Slider', deck.title]));
    expect(liveAsked).toEqual([
      expect.objectContaining({
        purpose: 'realtime',
        model: 'voxtral-mini-transcribe-realtime-3',
      }),
    ]);

    let seq = 0;
    const say = async (
      activeSlideId: string,
      pointerOn: string | null = null,
      liveText?: string,
    ) => {
      const meta: VoiceSegmentMeta = {
        seq,
        startMs: seq * 3000,
        endMs: seq * 3000 + 2000,
        context: {
          slides: [{ slideId: activeSlideId, ms: 2000 }],
          pointer: pointerOn
            ? [{ slideId: activeSlideId, shapeId: pointerOn, point: { x: 0.3, y: 0.2 }, ms: 1500 }]
            : [],
          selection: null,
          activeSlideId,
        },
        ...(liveText ? { liveText } : {}),
      };
      seq += 1;
      const form = new FormData();
      form.set('meta', JSON.stringify(meta));
      form.set('audio', wav(), 'speech.wav');
      const res = await context.request(`/api/voice/${session.id}/segments`, {
        method: 'POST',
        body: form,
      });
      expect(res.status).toBe(200);
      return voiceSessionSchema.parse(await res.json());
    };
    const current = async (): Promise<VoiceSession> =>
      voiceSessionSchema.parse(await (await context.request(`/api/voice/${session.id}`)).json());
    const deckComments = async () =>
      commentSchema
        .array()
        .parse(await (await context.request(`/api/decks/${deck.id}/comments`)).json());

    // A remark on the title and another element: a box around both, still being said.
    router.push({
      actions: [
        {
          type: 'new',
          slide: 1,
          elements: [title.id, other.id],
          text: 'Den Titel bitte',
          finished: false,
        },
      ],
    });
    let state = await say(first.id, title.id);
    expect(state.items).toMatchObject([
      { state: 'draft', slideId: first.id, text: 'Den Titel bitte' },
    ]);
    const [root] = await deckComments();
    expect(root!.anchor.type).toBe('rect');
    const box = root!.anchor.type === 'rect' ? root!.anchor.rect : null;
    for (const { bbox } of [title, other]) {
      expect(box!.x).toBeLessThanOrEqual(bbox.x);
      expect(box!.y).toBeLessThanOrEqual(bbox.y);
      expect(box!.x + box!.w).toBeGreaterThanOrEqual(bbox.x + bbox.w - 1e-9);
      expect(box!.y + box!.h).toBeGreaterThanOrEqual(bbox.y + bbox.h - 1e-9);
    }
    // Speech recognition hears the deck's words and the piece before.
    expect(String((transcribed[0]!.get('file') as File).name)).toBe('speech-0.wav');
    expect(transcribedAt[0]).toBe('https://api.mistral.ai/v1/audio/transcriptions');
    // Mistral listens for terms (`context_bias`) instead of a prompt.
    expect(transcribed[0]!.getAll('context_bias')).toEqual(
      expect.arrayContaining(['Slider', 'alignen', deck.title]),
    );
    expect(transcribed[0]!.get('prompt')).toBeNull();
    // The router saw the slide's elements and where the pointer rested.
    const routed = JSON.stringify(anthropic.seen[0]!.messages);
    expect(anthropic.seen[0]!.model).toBe('claude-haiku-5-5');
    expect(routed).toContain(`The pointer rested 1.5 s on element ${title.id} of slide 1`);

    // It goes on and is finished: the comment says it all, and goes to the AI.
    router.push({
      actions: [
        {
          type: 'continue',
          item: 'K1',
          text: 'Den Titel „Agenda“ deutlich größer und fett.',
          finished: true,
        },
      ],
    });
    state = await say(first.id, title.id);
    expect(state.items[0]!.text).toBe('Den Titel „Agenda“ deutlich größer und fett.');
    await vi.waitFor(async () => expect((await current()).items[0]!.state).toBe('answered'), {
      timeout: 10_000,
      interval: 50,
    });
    expect(transcribed[1]!.getAll('context_bias')).toContain('Shapes');
    const asked = anthropic.seen.find(
      (body) => !body.tools?.some((tool) => 'name' in tool && tool.name === 'act'),
    );
    expect(JSON.stringify(asked!.messages)).toContain('deutlich größer und fett');
    // …next to what speech recognition heard, raw – a misheard word stays recoverable.
    expect(JSON.stringify(asked!.messages)).toContain('(said aloud');

    // An artefact of speech recognition costs no decision.
    const routerCalls = anthropic.seen.filter((body) => body.tool_choice).length;
    state = await say(first.id);
    expect(state.segments.at(-1)).toMatchObject({ status: 'empty' });
    expect(anthropic.seen.filter((body) => body.tool_choice).length).toBe(routerCalls);

    // „Nächste Folie“: a command for the browser.
    router.push({ actions: [{ type: 'go_to_slide', slide: 2 }] });
    state = await say(first.id);
    expect(state.commands.map((entry) => entry.command)).toEqual([
      { type: 'goToSlide', slideId: second.id },
    ]);

    // A remark on the slide as a whole, finished by a pause.
    router.push({
      actions: [{ type: 'new', slide: 2, text: 'Hier fehlt eine Quelle.', finished: false }],
    });
    state = await say(second.id);
    expect(state.items[1]).toMatchObject({ state: 'draft', slideId: second.id });
    const flushed = voiceSessionSchema.parse(
      await (await context.request(`/api/voice/${session.id}/flush`, { method: 'POST' })).json(),
    );
    expect(flushed.items[1]!.state).not.toBe('draft');

    // An addition to the first comment: a reply in its thread, asked about with it.
    router.push({ actions: [{ type: 'add_to', item: 'K1', text: 'Und den Titel in Rot.' }] });
    state = await say(second.id);
    expect(state.items[2]).toMatchObject({ threadId: state.items[0]!.commentId });
    const reply = (await deckComments()).find((comment) => comment.parentId === root!.id);
    expect(reply?.body).toBe('Und den Titel in Rot.');

    // Taken back: the comment goes.
    router.push({ actions: [{ type: 'drop', item: 'K2' }] });
    await vi.waitFor(async () => expect((await current()).items[1]!.state).toBe('answered'), {
      timeout: 10_000,
      interval: 50,
    });
    state = await say(second.id);
    const dropped = state.items[1]!.commentId;
    expect(state.items[1]!.state).toBe('dropped');
    // Taken back in the background: the next pieces need not wait for it.
    await vi.waitFor(
      async () =>
        expect(
          await context.deps.db.select().from(comments).where(eq(comments.id, dropped)),
        ).toEqual([]),
      { timeout: 10_000, interval: 50 },
    );

    // Plain changes are made at once – the editor's own operations, no AI at work: „den Titel
    // nach oben links“ shows within a second, as a change of the comment like the AI's.
    const titleNow = async () =>
      deckEditStateSchema
        .parse(await (await context.request(`/api/decks/${deck.id}/edit`)).json())
        .slides[0]!.elements.find((element) => element.id === title.id)!;
    heard.unshift(
      'Den Titel nach oben links.',
      'Noch etwas weiter rechts.',
      'Mach das rückgängig.',
      'Den Titel blau.',
    );
    const placed = await titleNow();
    const aiAsked = () => anthropic.seen.filter((body) => !body.tool_choice).length;
    // (The addition before is with the AI meanwhile.)
    await vi.waitFor(async () => expect((await current()).items[2]!.state).toBe('answered'), {
      timeout: 10_000,
      interval: 50,
    });
    const asked0 = aiAsked();
    const moveTo = (x: number) => ({
      element: title.id,
      box: { x, y: 4, w: placed.bbox.w * 100, h: placed.bbox.h * 100 },
    });
    router.push({
      actions: [
        {
          type: 'new',
          slide: 1,
          elements: [title.id],
          text: 'Den Titel nach oben links.',
          finished: true,
          edits: [moveTo(5)],
        },
      ],
    });
    await say(first.id, title.id);
    await vi.waitFor(async () => expect((await current()).items[3]!.state).toBe('applied'), {
      timeout: 10_000,
      interval: 20,
    });
    expect((await titleNow()).bbox).toMatchObject({ x: expect.closeTo(0.05, 3) });
    expect(aiAsked()).toBe(asked0);
    const quickId = (await current()).items[3]!.proposalId;
    const quickly = aiProposalSchema
      .array()
      .parse(await (await context.request(`/api/decks/${deck.id}/ai/proposals`)).json())
      .find((proposal) => proposal.id === quickId);
    expect(quickly?.summary).toBe('Direkt umgesetzt: Position und Größe angepasst.');
    // The router saw what edits need: the element's box in %, its text's look, the page.
    const told = JSON.stringify(anthropic.seen.findLast((body) => body.tool_choice)!.messages);
    expect(told).toContain(`${title.id} „`);
    expect(told).toContain('% of the slide');
    expect(told).toMatch(/The slides are [\d.]+ × [\d.]+ cm/);
    // A box put over the title „oben links“ goes below it instead – never over others.
    const titleBox = { x: 0.06, y: 0.06, w: 0.88, h: 0.12 };
    const shape = { x: 0.62, y: 0.3, w: 0.3, h: 0.4 };
    const background = { x: 0, y: 0, w: 1, h: 1 };
    expect(clearOf({ ...shape, x: 0.06, y: 0.1 }, shape, [titleBox, background])).toEqual({
      ...shape,
      x: 0.06,
      y: expect.closeTo(0.21, 6),
    });
    // Free there: where it was asked to go; nowhere free nearby: none – the AI makes room.
    expect(clearOf({ ...shape, x: 0.06, y: 0.22 }, shape, [titleBox])).toMatchObject({ y: 0.22 });
    expect(clearOf({ ...shape, x: 0.06, y: 0.1, h: 0.85 }, shape, [titleBox])).toBeNull();
    // „Links“ taken for right by the fast model: the AI does it rather than the wrong side.
    expect(placesAgree([{ element: 'x', place: 'top_right' }], 'Die Box nach oben links.')).toBe(
      false,
    );
    expect(placesAgree([{ element: 'x', place: 'top_left' }], 'Die Box nach links oben.')).toBe(
      true,
    );
    expect(placesAgree([{ element: 'x', place: 'center' }], 'In die Mitte, nicht links.')).toBe(
      true,
    );
    // The actions as a JSON string with a bracket too many at its end (the fast model, now and
    // then): read all the same.
    expect(readActions({ actions: '[{"type":"finish","item":"K1"}]}' })).toMatchObject([
      { type: 'finish', item: 'K1' },
    ]);
    // A correction is an addition, made at once on top; „rückgängig“ takes back both.
    router.push({
      actions: [
        { type: 'add_to', item: 'K4', text: 'Noch etwas weiter rechts.', edits: [moveTo(9)] },
      ],
    });
    await say(first.id, title.id);
    await vi.waitFor(async () => expect((await current()).items[4]!.state).toBe('applied'), {
      timeout: 10_000,
      interval: 20,
    });
    expect((await titleNow()).bbox.x).toBeCloseTo(0.09, 3);
    router.push({ actions: [{ type: 'undo', item: 'K4' }] });
    await say(first.id);
    await vi.waitFor(async () => expect((await titleNow()).bbox.x).toBeCloseTo(placed.bbox.x, 3), {
      timeout: 10_000,
      interval: 20,
    });
    // Edits that cannot be made so (no such element) leave the request to the AI.
    router.push({
      actions: [
        {
          type: 'new',
          slide: 1,
          elements: [title.id],
          text: 'Den Titel blau.',
          finished: true,
          edits: [{ element: 'nicht-da', fill: '#0000ff' }],
        },
      ],
    });
    await say(first.id, title.id);
    await vi.waitFor(async () => expect((await current()).items[5]!.state).toBe('answered'), {
      timeout: 10_000,
      interval: 50,
    });
    expect(aiAsked()).toBe(asked0 + 1);
    // Text and fill restyled at once: the styles the change makes come along with it.
    const runsOf = (element: Awaited<ReturnType<typeof titleNow>>) =>
      element.live!.paragraphs.flatMap((paragraph) => paragraph.runs.filter((run) => run.text));
    const sizes = runsOf(placed).map((run) => run.size);
    heard.unshift('Den Titel doppelt so groß, fett, weiß auf Rot.');
    router.push({
      actions: [
        {
          type: 'new',
          slide: 1,
          elements: [title.id],
          text: 'Den Titel doppelt so groß, fett, weiß auf Rot.',
          finished: true,
          edits: [
            {
              element: title.id,
              font_scale: 2,
              bold: true,
              text_color: '#FFFFFF',
              fill: '#d00000',
              align: 'center',
            },
          ],
        },
      ],
    });
    await say(first.id, title.id);
    await vi.waitFor(async () => expect((await current()).items[6]!.state).toBe('applied'), {
      timeout: 10_000,
      interval: 20,
    });
    const restyled = await titleNow();
    expect(runsOf(restyled).map((run) => run.size)).toEqual(sizes.map((size) => size * 2));
    expect(runsOf(restyled).every((run) => run.bold && run.color === '#ffffff')).toBe(true);
    expect(restyled.live!.paragraphs.every((paragraph) => paragraph.align === 'center')).toBe(true);
    expect(restyled.look?.fill).toBe('#d00000');
    expect(aiAsked()).toBe(asked0 + 1);
    // „Mach hier zwei Kreise hin“: added at once as the editor adds them – the second beside the
    // first by its name, both on the slide spoken about, with the editor's ids.
    heard.unshift('Mach hier zwei Kreise hin.');
    router.push({
      actions: [
        {
          type: 'new',
          slide: 1,
          text: 'Hier zwei Kreise.',
          finished: true,
          edits: [
            { add: 'ellipse', name: 'k1', box: { x: 60, y: 60, w: 10, h: 17.8 }, fill: '#2563eb' },
            {
              add: 'ellipse',
              next_to: { element: 'k1', side: 'right' },
              size_like: { element: 'k1', width: true, height: true },
            },
          ],
        },
      ],
    });
    await say(first.id);
    await vi.waitFor(async () => expect((await current()).items[7]!.state).toBe('applied'), {
      timeout: 10_000,
      interval: 20,
    });
    const circles = deckEditStateSchema
      .parse(await (await context.request(`/api/decks/${deck.id}/edit`)).json())
      .slides[0]!.elements.filter((element) => element.outline?.type === 'ellipse');
    expect(circles).toHaveLength(2);
    expect(circles.every((circle) => /^sl[a-z0-9-]{4,60}$/.test(circle.id))).toBe(true);
    expect(circles[0]!.look?.fill).toBe('#2563eb');
    expect(circles[1]!.bbox).toMatchObject({
      y: expect.closeTo(0.6, 3),
      w: expect.closeTo(0.1, 3),
    });
    expect(circles[1]!.bbox.x).toBeGreaterThan(0.7);
    expect(aiAsked()).toBe(asked0 + 1);

    // The live words there already: decided on at once – speech to text, slow here, only makes
    // them accurate afterwards (the caption keeps the live words until then).
    let freeSpeech = () => {};
    hold = new Promise<void>((resolve) => (freeSpeech = resolve));
    heard.unshift('Den Untertitel kursiv.');
    router.push({
      actions: [{ type: 'new', slide: 1, text: 'Den Untertitel kursiv.', finished: false }],
    });
    const fast = await say(first.id, null, 'den untertitel kursiv');
    expect(fast.items.at(-1)).toMatchObject({ text: 'Den Untertitel kursiv.', state: 'draft' });
    expect(fast.segments.at(-1)).toMatchObject({ text: 'den untertitel kursiv', heard: false });
    expect(JSON.stringify(anthropic.seen.findLast((body) => body.tool_choice)!.messages)).toContain(
      'den untertitel kursiv',
    );
    freeSpeech();
    hold = null;
    await vi.waitFor(async () =>
      expect((await current()).segments.at(-1)).toMatchObject({
        text: 'Den Untertitel kursiv.',
        heard: true,
      }),
    );

    // Speech to text slower than the speech: the pieces that waited are heard as one.
    let release = () => {};
    hold = new Promise<void>((resolve) => (release = resolve));
    const calls = transcribed.length;
    const three = Promise.all([say(second.id), say(second.id), say(second.id)]);
    await vi.waitFor(() => expect(transcribed.length).toBe(calls + 1));
    release();
    await three;
    expect(transcribed.length).toBe(calls + 2);
    const joined = transcribed.at(-1)!.get('file') as File;
    expect(joined.size).toBe(44 + 3200 * 2 + 9600);
    hold = null;

    // The first comment's recording, made in the browser: kept with the text it was heard as.
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
    const clip = new FormData();
    clip.set('meta', JSON.stringify({ durationMs: 4000, peaks: [0.2, 1] }));
    clip.set('audio', new Blob([webm], { type: 'audio/webm' }), 'comment.webm');
    const recorded = await context.request(`/api/voice/${session.id}/items/${root!.id}/recording`, {
      method: 'PUT',
      body: clip,
    });
    expect(recorded.status).toBe(200);
    expect(commentSchema.parse(await recorded.json()).media).toMatchObject({
      kind: 'audio',
      transcriptStatus: 'done',
      transcript: 'Den Titel hier bitte deutlich größer und fett.',
    });

    // Ended: nothing more is taken.
    const ended = await context.request(`/api/voice/${session.id}/end`, { method: 'POST' });
    expect(voiceSessionSchema.parse(await ended.json()).ended).toBe(true);
    const late = new FormData();
    late.set(
      'meta',
      JSON.stringify({
        seq: 99,
        startMs: 0,
        endMs: 1,
        context: { slides: [], pointer: [], selection: null, activeSlideId: null },
      }),
    );
    late.set('audio', wav(), 'speech.wav');
    expect(
      (await context.request(`/api/voice/${session.id}/segments`, { method: 'POST', body: late }))
        .status,
    ).toBe(400);

    // The instance dashboard counts what the AI used: speech to text by the seconds of the WAV on
    // the instance's key (the instance pays), the router and the editing AI by their tokens on the
    // workspace's own – per feature and workspace, never what was said.
    await context.deps.background?.idle();
    const answer: unknown = await (
      await context.request('/api/instance/ai-usage?interval=1d')
    ).json();
    const usage = instanceAiUsageSchema.parse(answer);
    const feature = (name: string) => usage.byFeature.find((each) => each.feature === name);
    expect(feature('voice')?.audioSeconds).toBeGreaterThan(0.09);
    expect(feature('voice')?.inputTokens).toBeGreaterThan(0);
    expect(feature('edit')?.outputTokens).toBeGreaterThan(0);
    expect(usage.instanceKeys).toMatchObject({ inputTokens: 0, requests: transcribed.length });
    expect(usage.instanceKeys.audioSeconds).toBeCloseTo(usage.total.audioSeconds);
    expect(usage.byWorkspace.map((each) => each.id)).toEqual([context.workspaceId]);
    // A model's row keeps its service and name (not „anthropicundefined“ from adding them up).
    for (const each of usage.byModel) {
      expect(each.provider).not.toMatch(/undefined/);
      expect(each.model).not.toMatch(/undefined/);
    }
    expect(usage.byModel.map((each) => each.provider)).toContain('mistral');
    expect(usage.buckets.reduce((sum, each) => sum + each.requests, 0)).toBe(usage.total.requests);
    // What the AI did: the requests from the spoken comments, how they ended – no money anywhere.
    expect(usage.work.asked).toBeGreaterThan(0);
    expect(usage.work.kept + usage.work.reverted + usage.work.unchanged).toBeLessThanOrEqual(
      usage.work.asked,
    );
    expect(JSON.stringify(answer)).not.toMatch(/cost|usd|unpriced/i);

    // Someone removed from the workspace mid-session: the session ends – no more pieces heard on
    // the workspace's keys, no live token with the slides' titles.
    const mia = await signedInUser(context, { name: 'Mia', email: 'mia@firma.de' });
    await context.deps.db
      .insert(workspaceMembers)
      .values({ workspaceId: context.workspaceId, userId: mia.user.id, role: 'member' });
    const hers = await context.request(`/api/decks/${deck.id}/voice`, {
      method: 'POST',
      cookie: mia.cookie,
    });
    expect(hers.status).toBe(201);
    const herSession = voiceSessionSchema.parse(await hers.json());
    const removed = await context.request(
      `/api/workspaces/${context.workspaceId}/members/${mia.user.id}`,
      { method: 'DELETE' },
    );
    expect(removed.status).toBe(204);
    const herLive = await context.request(`/api/voice/${herSession.id}/live`, {
      method: 'POST',
      cookie: mia.cookie,
    });
    expect([403, 404]).toContain(herLive.status);
    expect(
      (await context.request(`/api/voice/${herSession.id}`, { cookie: mia.cookie })).status,
    ).toBe(404);
  });
});
