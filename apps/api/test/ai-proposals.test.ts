import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aiProposalSchema,
  deckEditStateSchema,
  deckSchema,
  slideSchema,
  type AiProposal,
  type DeckEditState,
} from '@slider/shared';
import { media, workspaceAiKeys } from '../src/db/schema';
import { blobKeys } from '../src/storage/blob-storage';
import { createTestContext, pinComment, type TestContext } from './helpers';
import { DEMO_ODP, fakeOdpPdf, odpForm } from './odp-helpers';

/* The AI proposes changes to a slide (BER-183). */

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

type Answer = Anthropic.Beta.BetaMessage | Error;
/**
 * A scripted answer, or one made from the request (e.g. writing back the XML it was shown) –
 * maybe after doing something else meanwhile.
 */
type Step =
  | Answer
  | ((body: Anthropic.Beta.MessageCreateParams, signal?: AbortSignal) => Answer | Promise<Answer>);

/** Anthropic as far as the AI uses it: scripted answers, the requests recorded. */
class FakeAnthropic {
  requests: Anthropic.Beta.MessageCreateParams[] = [];
  steps: Step[] = [];

  readonly client = (apiKey: string): Anthropic =>
    ({
      models: {
        retrieve: async (model: string) => ({ id: model, apiKey, max_tokens: 128_000 }),
        list: () =>
          (async function* () {
            await Promise.resolve();
            yield { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', apiKey };
            yield { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', apiKey };
          })(),
      },
      beta: {
        messages: {
          stream: (
            body: Anthropic.Beta.MessageCreateParams,
            options?: { signal?: AbortSignal },
          ) => {
            this.requests.push(structuredClone(body));
            const next = this.steps.shift();
            const pending = typeof next === 'function' ? next(body, options?.signal) : next;
            return {
              finalMessage: async () => {
                const step = await pending;
                if (!step) throw new Error('no scripted answer left');
                if (step instanceof Error) throw step;
                return step;
              },
            };
          },
        },
      },
    }) as unknown as Anthropic;
}

const message = (
  content: Anthropic.Beta.BetaContentBlock[],
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

const toolUse = (name: string, input: unknown): Anthropic.Beta.BetaContentBlock =>
  ({
    type: 'tool_use',
    id: `toolu_${Math.random()}`,
    name,
    input,
  }) as Anthropic.Beta.BetaContentBlock;

/** The slide XML the AI was shown first (the commented slide) – or, with `latest`, last. */
function shownXml(body: Anthropic.Beta.MessageCreateParams, latest = false): string {
  const pages = JSON.stringify(body.messages).match(/<draw:page .*?<\/draw:page>/g) ?? [];
  const page = latest ? pages.at(-1) : pages[0];
  if (!page) throw new Error('no slide XML shown');
  return JSON.parse(`"${page}"`) as string;
}

/** The AI writes the commented slide, changed by `edit`. */
const writeShown =
  (slide: number, edit: (xml: string) => string, styles?: string) =>
  (body: Anthropic.Beta.MessageCreateParams) =>
    message([toolUse('write_slide', { slide, xml: edit(shownXml(body)), styles })], 'tool_use');

/** The results of the last tool calls, as the AI got them. */
const toolResults = (body: Anthropic.Beta.MessageCreateParams) =>
  body.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];

const text = (value: string): Anthropic.Beta.BetaContentBlock =>
  ({ type: 'text', text: value, citations: null }) as Anthropic.Beta.BetaContentBlock;

async function setup(withKey = true) {
  const anthropic = new FakeAnthropic();
  ctx = await createTestContext({ libreOfficePdf: fakeOdpPdf(), anthropic: anthropic.client });
  const deck = deckSchema.parse(
    await (
      await ctx.request('/api/decks/upload', { method: 'POST', body: odpForm(DEMO_ODP) })
    ).json(),
  );
  await ctx.deps.queue.idle();
  if (withKey) {
    await ctx.request(`/api/workspaces/${ctx.workspaceId}/ai/keys`, {
      method: 'POST',
      json: { provider: 'anthropic', apiKey: 'sk-ant-api03-good-AbCdEfGhIjKlMnOpQrSt' },
    });
  }
  const state = deckEditStateSchema.parse(
    await (await ctx.request(`/api/decks/${deck.id}/edit`)).json(),
  );
  return { ctx, anthropic, deckId: deck.id, state };
}

const titleOf = (state: DeckEditState, slide: number) =>
  state.slides[slide]!.elements.find((element) => element.role === 'title')!;

async function proposals(context: TestContext, deckId: string): Promise<AiProposal[]> {
  return aiProposalSchema
    .array()
    .parse(await (await context.request(`/api/decks/${deckId}/ai/proposals`)).json());
}

async function settled(context: TestContext, deckId: string): Promise<AiProposal> {
  let latest: AiProposal | undefined;
  await vi.waitFor(
    async () => {
      latest = (await proposals(context, deckId))[0];
      expect(latest?.status).not.toBe('running');
    },
    { timeout: 10_000, interval: 50 },
  );
  return latest!;
}

async function comment(
  context: TestContext,
  deckId: string,
  slideId: string,
  body: string,
  parentId: string | null = null,
): Promise<string> {
  const res = await context.request(`/api/decks/${deckId}/comments`, {
    method: 'POST',
    json: parentId
      ? { slideId, parentId, body, anchor: { type: 'slide' }, strokes: [] }
      : pinComment(slideId, body),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** ⌘↵ in a comment: the comment, then the AI asked from it. */
async function ask(context: TestContext, deckId: string, slideId: string, prompt: string) {
  const commentId = await comment(context, deckId, slideId, prompt);
  return context.request(`/api/decks/${deckId}/ai/proposals`, {
    method: 'POST',
    json: { commentId },
  });
}

describe('AI proposals', () => {
  it('rewrites the slide, looks at it drawn, applies it right away – taken back and applied again', async () => {
    const { ctx, anthropic, deckId, state } = await setup();
    const slide = state.slides[2]!;
    anthropic.steps = [
      writeShown(
        3,
        (xml) =>
          xml
            .replace('>Umsatz nach Region<', '>Umsatz 2026: +10 %<')
            .replace('draw:style-name="gr2"', 'draw:style-name="aiTable"'),
        '<style:style style:name="aiTable" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#2a6f4e"/></style:style>',
      ),
      message([text('Ich habe den Titel zur Kernaussage gemacht.')], 'end_turn'),
    ];

    const res = await ask(ctx, deckId, slide.slideId, 'Mach den Titel zu einer Aussage');
    expect(res.status).toBe(202);
    const done = await settled(ctx, deckId);
    expect(done).toMatchObject({
      status: 'applied',
      commentId: expect.any(String),
      summary: 'Ich habe den Titel zur Kernaussage gemacht.',
      error: null,
    });

    // The first request shows the slide drawn, its XML and styles; the second the result drawn.
    const first = anthropic.requests[0]!;
    expect(first.model).toBe('claude-sonnet-5-5');
    expect(first.tools?.map((tool) => ('name' in tool ? tool.name : ''))).toEqual([
      'view_slide',
      'search_deck',
      'list_pictures',
      'view_picture',
      'add_picture',
      'insert_slide',
      'delete_slide',
      'move_slide',
      'read_styles',
      'write_slide',
      'edit_slide',
    ]);
    expect(first.max_tokens).toBe(128_000);
    expect(first.output_config?.task_budget).toMatchObject({ type: 'tokens' });
    expect(first.betas).toContain('task-budgets-2026-03-13');
    const firstContent = first.messages[0]!.content as Anthropic.Beta.BetaContentBlockParam[];
    expect(firstContent.some((block) => block.type === 'image')).toBe(true);
    const shown = JSON.stringify(firstContent);
    expect(shown).toContain('Mach den Titel zu einer Aussage');
    expect(shown).toContain('The comment is on slide 3');
    expect(shown).toContain('<style:style style:name=\\"pr4\\"');
    const result = toolResults(anthropic.requests[1]!)[0]!;
    expect(result.is_error).toBeUndefined();
    expect(JSON.stringify(result.content)).toContain('image/webp');

    // Applied as the AI's step.
    const slides = () =>
      ctx
        .request(`/api/decks/${deckId}/slides`)
        .then(async (r) => slideSchema.array().parse(await r.json()));
    expect((await slides())[2]!.title).toBe('Umsatz 2026: +10 %');
    const act = async (action: 'revert' | 'reapply') =>
      ctx.request(`/api/decks/${deckId}/ai/proposals/${done.id}/${action}`, { method: 'POST' });
    const ok = async (action: 'revert' | 'reapply') => {
      const res = await act(action);
      expect(res.status).toBe(200);
      return deckEditStateSchema.parse(await res.json());
    };

    // The last step: taking it back is undo, applying again is redo.
    expect(await ok('revert')).toMatchObject({ seq: 0, canRedo: true });
    expect((await slides())[2]!.title).toBe('Umsatz nach Region');
    expect((await proposals(ctx, deckId))[0]!.status).toBe('reverted');
    expect(await ok('reapply')).toMatchObject({ seq: 1, canRedo: false });
    expect((await slides())[2]!.title).toBe('Umsatz 2026: +10 %');

    // With a step on another slide on top, it is taken back by writing the slide as it was.
    const edit = async (slideIndex: number, paragraphs: string[]) => {
      const current = deckEditStateSchema.parse(
        await (await ctx.request(`/api/decks/${deckId}/edit`)).json(),
      );
      const res = await ctx.request(`/api/decks/${deckId}/edit/operations`, {
        method: 'POST',
        json: {
          operations: [{ type: 'setText', elementId: titleOf(current, slideIndex).id, paragraphs }],
        },
      });
      expect(res.status).toBe(200);
    };
    await edit(0, ['Neu']);
    expect(await ok('revert')).toMatchObject({ seq: 3 });
    expect((await slides())[2]!.title).toBe('Umsatz nach Region');
    expect((await slides())[0]!.title).toBe('Neu');
    expect(await ok('reapply')).toMatchObject({ seq: 4 });
    expect((await slides())[2]!.title).toBe('Umsatz 2026: +10 %');

    // Changed since on its own slide: only undo in the edit panel takes it back.
    await edit(2, ['Von Hand']);
    const refused = await act('revert');
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('Rückgängig');
  });

  it('reads the thread – earlier messages and its own earlier proposal – and answers in it', async () => {
    const { ctx, anthropic, deckId, state } = await setup();
    const slide = state.slides[2]!;
    anthropic.steps = [
      writeShown(3, (xml) => xml.replace('>Umsatz nach Region<', '>A<')),
      message([text('Titel gekürzt.')], 'end_turn'),
      writeShown(3, (xml) => xml.replace('>A<', '>B<')),
      message([text('Jetzt mit Zahl.')], 'end_turn'),
    ];
    const root = await comment(ctx, deckId, slide.slideId, 'Der Titel ist zu lang');
    const first = await ctx.request(`/api/decks/${deckId}/ai/proposals`, {
      method: 'POST',
      json: { commentId: root },
    });
    expect(first.status).toBe(202);
    await settled(ctx, deckId);

    const reply = await comment(ctx, deckId, slide.slideId, 'Bitte mit Zahl', root);
    await ctx.request(`/api/decks/${deckId}/ai/proposals`, {
      method: 'POST',
      json: { commentId: reply },
    });
    const second = await settled(ctx, deckId);
    expect(second).toMatchObject({
      commentId: reply,
      slideId: slide.slideId,
      summary: 'Jetzt mit Zahl.',
    });
    const thread = JSON.stringify(anthropic.requests[2]!.messages[0]!.content);
    expect(thread).toContain('Der Titel ist zu lang');
    expect(thread).toContain('Titel gekürzt.');
    expect(thread).toContain('Bitte mit Zahl');
    expect(thread).toContain('points at x 50%, y 50%');
  });

  it('works on a comment between two slides: knows the place, sees both around it', async () => {
    const { ctx, anthropic, deckId, state } = await setup();
    const [first, second] = [state.slides[0]!, state.slides[1]!];
    anthropic.steps = [
      message([toolUse('insert_slide', { after: 1, copy_of: 2 })], 'tool_use'),
      message([text('Agenda eingefügt.')], 'end_turn'),
    ];
    const gap = await ctx.request(`/api/decks/${deckId}/comments`, {
      method: 'POST',
      json: {
        slideId: null,
        body: 'Mach hier noch eine Agenda rein',
        anchor: { type: 'gap', afterSlideId: first.slideId, beforeSlideId: second.slideId },
      },
    });
    const gapId = ((await gap.json()) as { id: string }).id;
    const res = await ctx.request(`/api/decks/${deckId}/ai/proposals`, {
      method: 'POST',
      json: { commentId: gapId },
    });
    expect(res.status).toBe(202);
    const done = await settled(ctx, deckId);
    expect(done).toMatchObject({
      status: 'applied',
      slideId: first.slideId,
      summary: 'Agenda eingefügt.',
    });
    const asked = JSON.stringify(anthropic.requests[0]!.messages[0]!.content);
    expect(asked).toContain('The comment is between slide 1 and slide 2.');
    expect(JSON.stringify(anthropic.requests[0]!.messages).match(/<draw:page /g)).toHaveLength(2);
    const after = deckEditStateSchema.parse(
      await (await ctx.request(`/api/decks/${deckId}/edit`)).json(),
    );
    expect(after.slides).toHaveLength(state.slides.length + 1);

    // The thread is the new slide's now – and between the two again once that is taken back.
    const placed = async () => {
      const list = (await (await ctx.request(`/api/decks/${deckId}/comments`)).json()) as {
        id: string;
        slideId: string | null;
        anchor: unknown;
      }[];
      return list.find((item) => item.id === gapId)!;
    };
    const added = after.slides[1]!.slideId;
    expect(await placed()).toMatchObject({ slideId: added, anchor: { type: 'slide' } });
    const act = async (action: 'revert' | 'reapply') => {
      const res = await ctx.request(`/api/decks/${deckId}/ai/proposals/${done.id}/${action}`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
    };
    await act('revert');
    expect(await placed()).toMatchObject({
      slideId: null,
      anchor: { type: 'gap', afterSlideId: first.slideId, beforeSlideId: second.slideId },
    });
    await act('reapply');
    expect(await placed()).toMatchObject({ slideId: added, anchor: { type: 'slide' } });
  });

  it('needs a comment with words, near slides still there', async () => {
    const { ctx, deckId } = await setup();
    const gap = await ctx.request(`/api/decks/${deckId}/comments`, {
      method: 'POST',
      json: {
        slideId: null,
        body: 'Hier fehlt was',
        anchor: { type: 'gap', afterSlideId: null, beforeSlideId: null },
      },
    });
    const gapId = ((await gap.json()) as { id: string }).id;
    const res = await ctx.request(`/api/decks/${deckId}/ai/proposals`, {
      method: 'POST',
      json: { commentId: gapId },
    });
    expect(res.status).toBe(400);
    const unknown = await ctx.request(`/api/decks/${deckId}/ai/proposals`, {
      method: 'POST',
      json: { commentId: 'nope' },
    });
    expect(unknown.status).toBe(404);
  });

  it('looks at other slides and styles, and corrects itself when a write is refused', async () => {
    const { ctx, anthropic, deckId, state } = await setup();
    anthropic.steps = [
      message(
        [toolUse('view_slide', { slide: 4 }), toolUse('read_styles', { names: ['pr4', 'nope'] })],
        'tool_use',
      ),
      message([toolUse('read_styles', {}), toolUse('view_slide', { slide: 9 })], 'tool_use'),
      // Unknown style, then a script and a link out – cleaned – with the style fixed.
      writeShown(3, (xml) =>
        xml.replace('presentation:style-name="pr4"', 'presentation:style-name="nope"'),
      ),
      writeShown(3, (xml) =>
        xml
          .replace(
            '>Umsatz nach Region<',
            '><text:a xlink:href="javascript:alert(1)">Umsatz</text:a><',
          )
          .replace(
            '</draw:page>',
            '<office:event-listeners><presentation:event-listener script:event-name="dom:click" xlink:href="vnd.sun.star.script:x"/></office:event-listeners></draw:page>',
          ),
      ),
      message([text('Erledigt.')], 'end_turn'),
    ];
    await ask(ctx, deckId, state.slides[2]!.slideId, 'Wie Folie 4');
    const done = await settled(ctx, deckId);
    expect(done.status).toBe('applied');

    const [view, styles] = toolResults(anthropic.requests[1]!);
    expect(JSON.stringify(view!.content)).toContain('Slide 4');
    expect(JSON.stringify(view!.content)).toContain('<draw:page');
    expect(styles!.content).toContain('style:name="pr4"');
    expect(styles!.content).toContain('Not found: nope');
    const [catalog, missing] = toolResults(anthropic.requests[2]!);
    expect(catalog!.content).toContain('style:master-page');
    expect(missing).toMatchObject({
      is_error: true,
      content: expect.stringContaining('no slide 9'),
    });
    const refusal = toolResults(anthropic.requests[3]!)[0]!;
    expect(refusal).toMatchObject({ is_error: true, content: expect.stringContaining('nope') });

    const file = await ctx.request(`/api/decks/${deckId}/edit/file`);
    const content = await (
      await JSZip.loadAsync(await file.arrayBuffer())
    )
      .file('content.xml')!
      .async('string');
    expect(content).toContain('>Umsatz</text:a>');
    expect(content).not.toContain('javascript:');
    expect(content).not.toContain('vnd.sun.star.script');
  });

  it('changes parts of a slide – a find not there or there twice is refused, nothing changed', async () => {
    const { ctx, anthropic, deckId, state } = await setup();
    anthropic.steps = [
      message(
        [
          toolUse('edit_slide', {
            slide: 3,
            edits: [
              { find: '>Umsatz nach Region<', replace: '>Umsatz 2026<' },
              { find: '>Gibt es nicht<', replace: '>x<' },
            ],
          }),
        ],
        'tool_use',
      ),
      message(
        [toolUse('edit_slide', { slide: 3, edits: [{ find: '<', replace: '' }] })],
        'tool_use',
      ),
      message(
        [
          toolUse('edit_slide', {
            slide: 3,
            edits: [
              { find: '>Umsatz nach Region<', replace: '>Umsatz 2026<' },
              { find: '>Umsatz 2026<', replace: '>Umsatz 2026: +10 %<' },
            ],
          }),
        ],
        'tool_use',
      ),
      message([text('Titel geändert.')], 'end_turn'),
    ];
    await ask(ctx, deckId, state.slides[2]!.slideId, 'Mach den Titel zu einer Aussage');
    expect(await settled(ctx, deckId)).toMatchObject({ status: 'applied' });

    expect(toolResults(anthropic.requests[1]!)[0]).toMatchObject({
      is_error: true,
      content: expect.stringContaining('Edit 2: its find is not in slide 3'),
    });
    expect(toolResults(anthropic.requests[2]!)[0]).toMatchObject({
      is_error: true,
      content: expect.stringContaining('more than once'),
    });
    const drawn = toolResults(anthropic.requests[3]!)[0]!;
    expect(drawn.is_error).toBeUndefined();
    expect(JSON.stringify(drawn.content)).toContain('image/webp');

    const slides = slideSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${deckId}/slides`)).json());
    expect(slides[2]!.title).toBe('Umsatz 2026: +10 %');
  });

  it('searches the deck, lists its pictures and looks at one', async () => {
    const { ctx, anthropic, deckId, state } = await setup();
    anthropic.steps = [
      message(
        [
          toolUse('search_deck', { query: 'umsatz nach region' }),
          toolUse('search_deck', { query: 'gibt es nicht' }),
          toolUse('list_pictures', {}),
        ],
        'tool_use',
      ),
      (body) => {
        const listed = String(toolResults(body)[2]!.content);
        const path = listed.match(/Pictures\/\S+\.png/)![0];
        return message(
          [
            toolUse('view_picture', { path }),
            toolUse('view_picture', { path: 'Pictures/TablePreview1.svm' }),
            toolUse('view_picture', { path: 'content.xml' }),
          ],
          'tool_use',
        );
      },
      message([text('Gefunden.')], 'end_turn'),
    ];
    await ask(ctx, deckId, state.slides[0]!.slideId, 'Wo steht der Umsatz?');
    expect(await settled(ctx, deckId)).toMatchObject({ status: 'ready', summary: 'Gefunden.' });

    const [found, nothing, listed] = toolResults(anthropic.requests[1]!);
    expect(found!.content).toMatch(/^slide \d+: .*Umsatz nach Region/);
    expect(found!.content).toContain('slide 3:');
    expect(nothing!.content).toContain('Nothing found');
    expect(listed!.content).toMatch(
      /Pictures\/\S+\.png \| image\/png \| 320 × 180 px \| \d+ KB \| shown by slide 4/,
    );
    const [picture, svm, outside] = toolResults(anthropic.requests[2]!);
    expect(JSON.stringify(picture!.content)).toContain('image/png');
    expect(JSON.stringify(picture!.content)).toContain('320 × 180 px');
    expect(svm).toMatchObject({
      is_error: true,
      content: expect.stringContaining('cannot be shown'),
    });
    expect(outside).toMatchObject({
      is_error: true,
      content: expect.stringContaining('no picture'),
    });
  });

  it('puts a picture from the thread on a slide – applied again after it was taken back', async () => {
    const { ctx, anthropic, deckId, state } = await setup();
    const slide = state.slides[3]!;
    const commentId = await comment(
      ctx,
      deckId,
      slide.slideId,
      'Nimm dieses Bild statt der Roadmap',
    );
    // A PNG as far as Slider reads it: its header, 640 × 360.
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 0);
    png.set(Buffer.from('IHDR'), 12);
    new DataView(png.buffer).setUint32(16, 640);
    new DataView(png.buffer).setUint32(20, 360);
    const mediaId = crypto.randomUUID();
    const storageKey = blobKeys.media(deckId, mediaId, 'png');
    await ctx.deps.media.put(storageKey, png);
    await ctx.deps.db.insert(media).values({
      id: mediaId,
      deckId,
      commentId,
      ownerId: ctx.ownerId,
      uploaderId: ctx.ownerId,
      kind: 'image',
      mimeType: 'image/png',
      sizeBytes: png.length,
      durationMs: 0,
      storageKey,
      sha256: 'x',
    });

    let path = '';
    anthropic.steps = [
      message(
        [toolUse('add_picture', { picture: 2 }), toolUse('add_picture', { picture: 1 })],
        'tool_use',
      ),
      (body) => {
        path = String(toolResults(body)[1]!.content).match(/Pictures\/[0-9a-f]+\.png/)![0];
        return writeShown(4, (xml) => xml.replace(/Pictures\/[^"]+\.png/, path))(body);
      },
      message([text('Bild getauscht.')], 'end_turn'),
    ];
    const res = await ctx.request(`/api/decks/${deckId}/ai/proposals`, {
      method: 'POST',
      json: { commentId },
    });
    expect(res.status).toBe(202);
    const done = await settled(ctx, deckId);
    expect(done).toMatchObject({ status: 'applied', summary: 'Bild getauscht.' });

    const shown = JSON.stringify(anthropic.requests[0]!.messages[0]!.content);
    expect(shown).toContain('Picture 1, from');
    expect(shown).toContain('640 × 360 px');
    expect(shown).toContain('image/png');
    const [missing, added] = toolResults(anthropic.requests[1]!);
    expect(missing).toMatchObject({ is_error: true, content: expect.stringContaining('has 1') });
    expect(added!.content).toContain('640 × 360 px');

    const file = async () =>
      JSZip.loadAsync(await (await ctx.request(`/api/decks/${deckId}/edit/file`)).arrayBuffer());
    const zip = await file();
    expect(zip.file(path)).not.toBeNull();
    expect(await zip.file('META-INF/manifest.xml')!.async('string')).toContain(path);
    expect(await zip.file('content.xml')!.async('string')).toContain(path);

    // With a step on another slide on top: taken back by writing the slide as it was – the
    // picture goes – and applied again by putting the thread's picture in once more.
    const current = deckEditStateSchema.parse(
      await (await ctx.request(`/api/decks/${deckId}/edit`)).json(),
    );
    await ctx.request(`/api/decks/${deckId}/edit/operations`, {
      method: 'POST',
      json: {
        operations: [{ type: 'setText', elementId: titleOf(current, 0).id, paragraphs: ['Neu'] }],
      },
    });
    const act = (action: 'revert' | 'reapply') =>
      ctx.request(`/api/decks/${deckId}/ai/proposals/${done.id}/${action}`, { method: 'POST' });
    expect((await act('revert')).status).toBe(200);
    expect((await file()).file(path)).toBeNull();
    expect((await act('reapply')).status).toBe(200);
    const again = await file();
    expect(again.file(path)).not.toBeNull();
    expect(await again.file('content.xml')!.async('string')).toContain(path);
  });

  it('adds, removes and moves slides – comments stay with their slides, through undo and redo', async () => {
    const { ctx, anthropic, deckId } = await setup();
    const slides = () =>
      ctx
        .request(`/api/decks/${deckId}/slides`)
        .then(async (r) => slideSchema.array().parse(await r.json()));
    const original = await slides();
    // A comment on the slide the AI removes, one on the slide it moves.
    await comment(ctx, deckId, original[4]!.id, 'Backup raus?');
    const asking = await comment(
      ctx,
      deckId,
      original[2]!.id,
      'Mach eine Variante, Backup raus, Titel ans Ende',
    );

    anthropic.steps = [
      message([toolUse('insert_slide', { after: 3, copy_of: 3 })], 'tool_use'),
      (body) => {
        const copy = String(JSON.stringify(toolResults(body)[0]!.content));
        expect(copy).toContain('Slide 4 added');
        expect(copy).toContain('4. Umsatz nach Region');
        return message([toolUse('view_slide', { slide: 4 })], 'tool_use');
      },
      (body) => {
        const shown = JSON.stringify(toolResults(body)[0]!.content);
        const xml = JSON.parse(`"${shown.match(/<draw:page .*?<\/draw:page>/)![0]}"`) as string;
        return message(
          [
            toolUse('write_slide', {
              slide: 4,
              xml: xml.replace('>Umsatz nach Region<', '>Variante<'),
            }),
          ],
          'tool_use',
        );
      },
      message(
        [toolUse('delete_slide', { slide: 6 }), toolUse('move_slide', { slide: 1, to: 6 })],
        'tool_use',
      ),
      message([text('Variante angelegt, Backup entfernt, Titel ans Ende.')], 'end_turn'),
    ];
    const res = await ctx.request(`/api/decks/${deckId}/ai/proposals`, {
      method: 'POST',
      json: { commentId: asking },
    });
    expect(res.status).toBe(202);
    const done = await settled(ctx, deckId);
    expect(done).toMatchObject({ status: 'applied' });
    const [removed, moved] = toolResults(anthropic.requests[4]!);
    expect(removed!.content).toContain('Slide 6 removed');
    expect(moved!.content).toContain('Slide 1 is now slide 6');

    const titles = (list: Awaited<ReturnType<typeof slides>>) => list.map((slide) => slide.title);
    const after = await slides();
    expect(titles(after)).toEqual([
      'Agenda',
      'Umsatz nach Region',
      'Variante',
      'Produkt-Roadmap',
      'Vielen Dank',
      'Q4 Strategie 2026',
    ]);
    // Kept slides are the same slides (ids, comments), the copy is a new one.
    expect(after[1]!.id).toBe(original[2]!.id);
    expect(after[5]!.id).toBe(original[0]!.id);
    expect(original.map((slide) => slide.id)).not.toContain(after[2]!.id);
    expect(after[1]!.openCommentCount).toBe(1);

    const act = async (action: 'revert' | 'reapply') => {
      const res = await ctx.request(`/api/decks/${deckId}/ai/proposals/${done.id}/${action}`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
    };
    // Undo: the deck as it was, the removed slide back with its comment.
    await act('revert');
    const back = await slides();
    expect(back.map((slide) => slide.id)).toEqual(original.map((slide) => slide.id));
    expect(back[4]!.openCommentCount).toBe(1);
    // Redo: the copy is the same slide again.
    await act('reapply');
    expect((await slides()).map((slide) => slide.id)).toEqual(after.map((slide) => slide.id));

    // With a step on top: taken back and applied again from the stored slides.
    const current = deckEditStateSchema.parse(
      await (await ctx.request(`/api/decks/${deckId}/edit`)).json(),
    );
    await ctx.request(`/api/decks/${deckId}/edit/operations`, {
      method: 'POST',
      json: {
        operations: [
          { type: 'setText', elementId: titleOf(current, 3).id, paragraphs: ['Roadmap neu'] },
        ],
      },
    });
    await act('revert');
    const reverted = await slides();
    expect(titles(reverted)).toEqual([
      'Q4 Strategie 2026',
      'Agenda',
      'Umsatz nach Region',
      'Roadmap neu',
      'Backup: Detailzahlen pro Land',
      'Vielen Dank',
    ]);
    expect(reverted.map((slide) => slide.id)).toEqual(original.map((slide) => slide.id));
    await act('reapply');
    const reapplied = await slides();
    expect(titles(reapplied)).toEqual([
      'Agenda',
      'Umsatz nach Region',
      'Variante',
      'Roadmap neu',
      'Vielen Dank',
      'Q4 Strategie 2026',
    ]);
    expect(reapplied[2]!.id).toBe(after[2]!.id);
  });

  it('changes nothing when the AI only looks', async () => {
    const { ctx, anthropic, deckId, state } = await setup();
    anthropic.steps = [message([text('Die Folie passt schon.')], 'end_turn')];
    await ask(ctx, deckId, state.slides[2]!.slideId, 'Passt das?');
    expect(await settled(ctx, deckId)).toMatchObject({
      status: 'ready',
      summary: 'Die Folie passt schon.',
    });
  });

  it('stops when asked: nothing it did reaches the slide, and it can be asked again', async () => {
    const { ctx, anthropic, deckId, state } = await setup();
    const slide = state.slides[2]!;
    let thinking!: () => void;
    const working = new Promise<void>((resolve) => (thinking = resolve));
    anthropic.steps = [
      writeShown(3, (xml) => xml.replace('>Umsatz nach Region<', '>Abgebrochen<')),
      // Still at it, until stopped.
      (_, signal) =>
        new Promise<Answer>((_resolve, reject) => {
          thinking();
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ];
    await ask(ctx, deckId, slide.slideId, 'Mach den Titel zu einer Aussage');
    await working;
    const [running] = await proposals(ctx, deckId);
    expect(running!.status).toBe('running');

    const cancel = () =>
      ctx.request(`/api/decks/${deckId}/ai/proposals/${running!.id}/cancel`, { method: 'POST' });
    expect((await cancel()).status).toBe(204);
    expect(await settled(ctx, deckId)).toMatchObject({ status: 'cancelled', error: null });
    expect((await cancel()).status).toBe(400);
    await ctx.deps.queue.idle();
    const after = deckEditStateSchema.parse(
      await (await ctx.request(`/api/decks/${deckId}/edit`)).json(),
    );
    expect(after.seq).toBe(state.seq);
    expect(titleOf(after, 2).paragraphs).toEqual(titleOf(state, 2).paragraphs);

    anthropic.steps = [message([text('Die Folie passt schon.')], 'end_turn')];
    const again = await ctx.request(`/api/decks/${deckId}/ai/proposals`, {
      method: 'POST',
      json: { commentId: running!.commentId },
    });
    expect(again.status).toBe(202);
    expect(await settled(ctx, deckId)).toMatchObject({ status: 'ready' });
    expect(JSON.stringify(anthropic.requests.at(-1)!.messages)).toContain(
      'stopped by the people before you finished',
    );
  });

  it('runs on an OpenAI key too: tools as functions, pictures as image parts, results as tool messages', async () => {
    const requests: { url: string; auth: string | null; body: Record<string, unknown> | null }[] =
      [];
    const answers = [
      {
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'view_slide', arguments: '{"slide":3}' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          { finish_reason: 'stop', message: { content: 'Da passt alles, nichts zu ändern.' } },
        ],
      },
    ];
    const aiFetch = async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      requests.push({ url, auth: new Headers(init?.headers).get('authorization'), body });
      if (url.endsWith('/models')) {
        return Response.json({
          data: [
            { id: 'text-embedding-3-large', created: 3 },
            { id: 'gpt-5.5', created: 2 },
            { id: 'gpt-4o', created: 1 },
          ],
        });
      }
      return Response.json(answers.shift());
    };
    ctx = await createTestContext({ libreOfficePdf: fakeOdpPdf(), aiFetch });
    const deck = deckSchema.parse(
      await (
        await ctx.request('/api/decks/upload', { method: 'POST', body: odpForm(DEMO_ODP) })
      ).json(),
    );
    await ctx.deps.queue.idle();
    const added = await ctx.request(`/api/workspaces/${ctx.workspaceId}/ai/keys`, {
      method: 'POST',
      json: { provider: 'openai', apiKey: 'sk-proj-good-AbCdEfGhIjKlMnOp' },
    });
    expect(await added.json()).toMatchObject({
      keys: [{ provider: 'openai', model: 'gpt-5.5', active: true, hint: 'sk-…MnOp' }],
    });
    const state = deckEditStateSchema.parse(
      await (await ctx.request(`/api/decks/${deck.id}/edit`)).json(),
    );
    expect(state.aiAvailable).toBe(true);

    await ask(ctx, deck.id, state.slides[2]!.slideId, 'Passt die Folie?');
    expect(await settled(ctx, deck.id)).toMatchObject({
      status: 'ready',
      summary: 'Da passt alles, nichts zu ändern.',
    });

    const [first, second] = requests.filter((request) => request.url.endsWith('/chat/completions'));
    expect(first!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(first!.auth).toBe('Bearer sk-proj-good-AbCdEfGhIjKlMnOp');
    expect(first!.body).toMatchObject({ model: 'gpt-5.5' });
    const messages = (body: Record<string, unknown> | null) =>
      body!.messages as { role: string; content: unknown; tool_call_id?: string }[];
    expect(messages(first!.body)[0]!.role).toBe('system');
    const tools = first!.body!.tools as { type: string; function: { name: string } }[];
    expect(tools.every((tool) => tool.type === 'function')).toBe(true);
    expect(tools.map((tool) => tool.function.name)).toContain('write_slide');
    // The commented slide shown drawn: a picture part in the first user message.
    expect(JSON.stringify(messages(first!.body)[1]!.content)).toContain('data:image/webp;base64,');
    // Its tool call answered right after it, the slide it looked at as a picture after that.
    const asked = messages(second!.body);
    const call = asked.findIndex((message) => message.role === 'assistant');
    expect(asked[call + 1]).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
    expect(asked[call + 2]!.role).toBe('user');
    expect(JSON.stringify(asked[call + 2]!.content)).toContain('data:image/webp;base64,');
  });

  it('needs the workspace key, and stops when Anthropic refuses it', async () => {
    const first = await setup(false);
    const res = await ask(first.ctx, first.deckId, first.state.slides[0]!.slideId, 'Kürzer');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'ai_not_configured' } });
    expect(first.state.aiAvailable).toBe(false);
    await first.ctx.cleanup();
    ctx = undefined;

    const { ctx: context, anthropic, deckId, state } = await setup();
    expect(state.aiAvailable).toBe(true);
    anthropic.steps = [
      new Anthropic.AuthenticationError(401, undefined, 'invalid x-api-key', new Headers()),
    ];
    await ask(context, deckId, state.slides[0]!.slideId, 'Kürzer');
    const failed = await settled(context, deckId);
    expect(failed).toMatchObject({ status: 'failed', error: expect.stringContaining('abgelehnt') });
    const [row] = await context.deps.db
      .select()
      .from(workspaceAiKeys)
      .where(eq(workspaceAiKeys.workspaceId, context.workspaceId));
    expect(row!.error).toContain('abgelehnt');
  });
  describe('beside others', () => {
    const editState = async (context: TestContext, deckId: string) =>
      deckEditStateSchema.parse(await (await context.request(`/api/decks/${deckId}/edit`)).json());

    const paragraphsOf = (state: DeckEditState, slide: number, name: string) =>
      state.slides[slide]!.elements.find((element) => element.name === name)!.paragraphs;

    /** Someone changes the text of an element by hand. */
    async function handEdit(
      context: TestContext,
      deckId: string,
      slide: number,
      name: string,
      paragraphs: string[],
    ) {
      const state = await editState(context, deckId);
      const element = state.slides[slide]!.elements.find((item) => item.name === name)!;
      const res = await context.request(`/api/decks/${deckId}/edit/operations`, {
        method: 'POST',
        json: { operations: [{ type: 'setText', elementId: element.id, paragraphs }] },
      });
      expect(res.status).toBe(200);
    }

    const contentXml = async (context: TestContext, deckId: string) => {
      const file = await context.request(`/api/decks/${deckId}/edit/file`);
      return (await JSZip.loadAsync(await file.arrayBuffer())).file('content.xml')!.async('string');
    };

    it('merges its change with what someone changed on the slide meanwhile – and takes back only its own', async () => {
      const { ctx, anthropic, deckId, state } = await setup();
      anthropic.steps = [
        writeShown(2, (xml) => xml.replace('>Agenda<', '>Heute<')),
        async () => {
          await handEdit(ctx, deckId, 1, 'Content 2', ['Von Hand']);
          return message([text('Titel geändert.')], 'end_turn');
        },
      ];
      await ask(ctx, deckId, state.slides[1]!.slideId, 'Anderer Titel');
      const done = await settled(ctx, deckId);
      expect(done).toMatchObject({ status: 'applied', error: null, summary: 'Titel geändert.' });
      const merged = await editState(ctx, deckId);
      expect(paragraphsOf(merged, 1, 'Title 1')).toEqual(['Heute']);
      expect(paragraphsOf(merged, 1, 'Content 2')).toEqual(['Von Hand']);

      // Changed again by hand on the same slide, then taken back: only its title goes.
      await handEdit(ctx, deckId, 1, 'Content 2', ['Noch mal von Hand']);
      const res = await ctx.request(`/api/decks/${deckId}/ai/proposals/${done.id}/revert`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const reverted = await editState(ctx, deckId);
      expect(paragraphsOf(reverted, 1, 'Title 1')).toEqual(['Agenda']);
      expect(paragraphsOf(reverted, 1, 'Content 2')).toEqual(['Noch mal von Hand']);
      // … and applied again on top of that.
      expect(
        (
          await ctx.request(`/api/decks/${deckId}/ai/proposals/${done.id}/reapply`, {
            method: 'POST',
          })
        ).status,
      ).toBe(200);
      const reapplied = await editState(ctx, deckId);
      expect(paragraphsOf(reapplied, 1, 'Title 1')).toEqual(['Heute']);
      expect(paragraphsOf(reapplied, 1, 'Content 2')).toEqual(['Noch mal von Hand']);
    });

    it('does its part again when someone changed the same thing meanwhile', async () => {
      const { ctx, anthropic, deckId, state } = await setup();
      anthropic.steps = [
        writeShown(2, (xml) => xml.replace('>Agenda<', '>Heute<')),
        async () => {
          await handEdit(ctx, deckId, 1, 'Title 1', ['Plan']);
          await handEdit(ctx, deckId, 1, 'Content 2', ['Von Hand']);
          return message([text('Titel geändert.')], 'end_turn');
        },
        // Told where its change met the other, it writes the slide again as it is now.
        (body) =>
          message(
            [
              toolUse('write_slide', {
                slide: 2,
                xml: shownXml(body, true).replace('>Plan<', '>Heute und morgen<'),
              }),
            ],
            'tool_use',
          ),
        message([text('Titel neu gesetzt.')], 'end_turn'),
      ];
      await ask(ctx, deckId, state.slides[1]!.slideId, 'Anderer Titel');
      const done = await settled(ctx, deckId);
      expect(done).toMatchObject({ status: 'applied', error: null, summary: 'Titel neu gesetzt.' });

      const note = JSON.stringify(anthropic.requests[2]!.messages.at(-1));
      expect(note).toContain('While you worked, others changed the deck too');
      expect(note).toContain('Slide 2: Someone changed the same things');
      expect(note).toContain('sl3 (Title 1)');
      expect(note).toContain('>Plan<');

      const now = await editState(ctx, deckId);
      expect(paragraphsOf(now, 1, 'Title 1')).toEqual(['Heute und morgen']);
      expect(paragraphsOf(now, 1, 'Content 2')).toEqual(['Von Hand']);
    });

    it('two requests at once: each hears of the other, styles of the same name both keep their look', async () => {
      const { ctx, anthropic, deckId, state } = await setup();
      const style = (fill: string) =>
        `<style:style style:name="aiBig" style:family="presentation" style:parent-style-name="pr4"><style:graphic-properties draw:fill="solid" draw:fill-color="${fill}"/></style:style>`;
      const restyle = (xml: string) =>
        xml.replace('presentation:style-name="pr4"', 'presentation:style-name="aiBig"');
      let second = '';
      anthropic.steps = [
        writeShown(2, restyle, style('#ff0000')),
        async () => {
          // A second request starts and is done while the first is still at work.
          const res = await ask(ctx, deckId, state.slides[2]!.slideId, 'Titel blau');
          second = ((await res.json()) as AiProposal).id;
          await vi.waitFor(
            async () => {
              const found = (await proposals(ctx, deckId)).find((item) => item.id === second);
              expect(found?.status).toBe('applied');
            },
            { timeout: 10_000, interval: 50 },
          );
          return message([text('Rot.')], 'end_turn');
        },
        writeShown(3, restyle, style('#0000ff')),
        message([text('Blau.')], 'end_turn'),
      ];
      await ask(ctx, deckId, state.slides[1]!.slideId, 'Titel rot');
      await vi.waitFor(
        async () => {
          const all = await proposals(ctx, deckId);
          expect(all.map((item) => item.status)).toEqual(['applied', 'applied']);
        },
        { timeout: 10_000, interval: 50 },
      );
      // The second heard what the first is at.
      expect(JSON.stringify(anthropic.requests[2]!.messages[0])).toContain(
        'Other requests at work on the deck right now',
      );
      expect(JSON.stringify(anthropic.requests[2]!.messages[0])).toContain('slide 2: ');
      expect(JSON.stringify(anthropic.requests[2]!.messages[0])).toContain('Titel rot');

      // The second went in first with its name; the first's style got a name of its own.
      const content = await contentXml(ctx, deckId);
      expect(content).toContain(style('#0000ff'));
      expect(content).toContain(style('#ff0000').replace('"aiBig"', '"aiBig-2"'));
      const pages = content.match(/<draw:page .*?<\/draw:page>/g)!;
      expect(pages[1]).toContain('presentation:style-name="aiBig-2"');
      expect(pages[2]).toContain('presentation:style-name="aiBig"');
    });

    it('gives what it adds ids of its own', async () => {
      const { ctx, anthropic, deckId, state } = await setup();
      anthropic.steps = [
        message([toolUse('insert_slide', { after: 2, copy_of: 2 })], 'tool_use'),
        message([text('Kopiert.')], 'end_turn'),
      ];
      await ask(ctx, deckId, state.slides[1]!.slideId, 'Kopie');
      const done = await settled(ctx, deckId);
      expect(done.status).toBe('applied');
      const pages = (await contentXml(ctx, deckId)).match(/<draw:page .*?<\/draw:page>/g)!;
      expect(pages[2]).toMatch(new RegExp(`xml:id="ai${done.id.slice(0, 8)}-\\d+"`));
      expect(pages[2]).not.toMatch(/xml:id="sl\d+"/);
    });
  });
});
