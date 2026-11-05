import Anthropic from '@anthropic-ai/sdk';
import { createCanvas } from '@napi-rs/canvas';
import { eq } from 'drizzle-orm';
import { imageSize } from '@slider/odp';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aiProposalSchema,
  deckEditStateSchema,
  deckSchema,
  slideSchema,
  type AiProposal,
  type Author,
  type DeckEditState,
  type EditableElement,
  type LiveEvent,
} from '@slider/shared';
import { media, integrationKeys } from '../src/db/schema';
import { asksForVariant, callGroups } from '../src/services/ai-proposals';
import { effortMessage, runTurn } from '../src/services/ai-providers';
import type { CutOutSource } from '../src/services/cut-outs';
import { aboutSeveralSlides } from '../src/services/quick-requests';
import { ApiError } from '../src/http/errors';
import { LiveHub } from '../src/realtime/live-hub';
import { blobKeys } from '../src/storage/blob-storage';
import { createTestContext, pinComment, type TestContext } from './helpers';
import { DEMO_ODP, fakeOdpPdf, odpForm } from './odp-helpers';

/* The AI proposes changes to a slide (BER-183). */

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

/** A turn cut short at a tool call whose JSON came broken: its answer up to that call. */
class BrokenCall {
  constructor(readonly content: Anthropic.Beta.BetaContentBlock[]) {}
}

const unreadableJson = () =>
  new Anthropic.AnthropicError(
    'Unable to parse tool parameter JSON from model. Please retry your request or adjust your prompt. Error: SyntaxError: JSON Parse error',
  );

type Answer = Anthropic.Beta.BetaMessage | Error | BrokenCall;
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
  /** Answers of the fast model to quick requests (forced tool call): no edits unless scripted. */
  quick: unknown[] = [];
  quickRequests: Anthropic.Beta.MessageCreateParams[] = [];
  /** The thread summaries asked for (forced `thread_summary`), each answered „Stand n“. */
  summaryRequests: Anthropic.Beta.MessageCreateParams[] = [];
  aborted = 0;

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
            if (body.tool_choice?.type === 'tool' && body.tool_choice.name === 'thread_summary') {
              this.summaryRequests.push(structuredClone(body));
              const input = { text: `Stand ${this.summaryRequests.length}` };
              return {
                finalMessage: async () => message([toolUse('thread_summary', input)], 'tool_use'),
              };
            }
            if (body.tool_choice?.type === 'tool') {
              this.quickRequests.push(structuredClone(body));
              const input = this.quick.shift() ?? { edits: [] };
              return {
                finalMessage: async () => message([toolUse('edit', input)], 'tool_use'),
              };
            }
            this.requests.push(structuredClone(body));
            const next = this.steps.shift();
            const pending = typeof next === 'function' ? next(body, options?.signal) : next;
            let current: Anthropic.Beta.BetaMessage | undefined;
            return {
              finalMessage: async () => {
                const step = await pending;
                if (!step) throw new Error('no scripted answer left');
                if (step instanceof BrokenCall) {
                  current = message(step.content, 'tool_use');
                  throw unreadableJson();
                }
                if (step instanceof Error) throw step;
                return step;
              },
              get currentMessage() {
                return current;
              },
              abort: () => {
                this.aborted += 1;
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
  (
    body.messages.findLast((m) => m.role === 'user')!
      .content as Anthropic.Beta.BetaContentBlockParam[]
  ).filter(
    (block): block is Anthropic.Beta.BetaToolResultBlockParam => block.type === 'tool_result',
  );

const text = (value: string): Anthropic.Beta.BetaContentBlock =>
  ({ type: 'text', text: value, citations: null }) as Anthropic.Beta.BetaContentBlock;

async function setup(
  withKey = true,
  options: {
    cutOuts?: CutOutSource;
    aiFetch?: (input: string, init?: RequestInit) => Promise<Response>;
    live?: LiveHub;
  } = {},
) {
  const anthropic = new FakeAnthropic();
  // A test may set up several times: the one before goes first.
  await ctx?.cleanup();
  ctx = await createTestContext({
    libreOfficePdf: fakeOdpPdf(),
    anthropic: anthropic.client,
    ...options,
  });
  const deck = deckSchema.parse(
    await (
      await ctx.request('/api/decks/upload', { method: 'POST', body: odpForm(DEMO_ODP) })
    ).json(),
  );
  await ctx.deps.queue.idle();
  if (withKey) {
    await ctx.request(`/api/workspaces/${ctx.workspaceId}/integrations/keys`, {
      method: 'POST',
      json: { kind: 'ai', provider: 'anthropic', apiKey: 'sk-ant-api03-good-AbCdEfGhIjKlMnOpQrSt' },
    });
  }
  const state = deckEditStateSchema.parse(
    await (await ctx.request(`/api/decks/${deck.id}/edit`)).json(),
  );
  return { ctx, anthropic, deckId: deck.id, state };
}

/** A PNG as far as Slider reads it: its header. */
function pngOf(width: number, height: number): Uint8Array {
  const png = new Uint8Array(64);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 0);
  png.set(Buffer.from('IHDR'), 12);
  new DataView(png.buffer).setUint32(16, width);
  new DataView(png.buffer).setUint32(20, height);
  return png;
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

// Each case runs whole AI requests on fresh test servers: slow when the machine is busy.
describe('AI proposals', { timeout: 60_000 }, () => {
  it('rewrites the slide, looks at it drawn, applies it right away – taken back and applied again, its own change only, pictures from the thread too', async () => {
    {
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
        async () => {
          // While it checks its write, the thread shows what it does and the slide it drew.
          progress = (await proposals(ctx, deckId))[0]!.progress;
          return message([text('Ich habe den Titel zur Kernaussage gemacht.')], 'end_turn');
        },
      ];
      let progress: AiProposal['progress'] = null;

      const res = await ask(ctx, deckId, slide.slideId, 'Mach den Titel zu einer Aussage');
      expect(res.status).toBe(202);
      const done = await settled(ctx, deckId);
      expect(done).toMatchObject({
        status: 'applied',
        commentId: expect.any(String),
        summary: 'Ich habe den Titel zur Kernaussage gemacht.',
        error: null,
      });
      expect(progress).toMatchObject({
        step: 'Prüft das Ergebnis',
        previewUrl: expect.stringMatching(/^\/files\/.+\?exp=/),
      });
      expect(done.progress).toBeNull();
      // Its small drawing goes when the run ends.
      const previewKey = decodeURIComponent(
        progress!.previewUrl!.slice('/files/'.length).split('?')[0]!,
      );
      await vi.waitFor(async () => expect(await ctx.deps.storage.get(previewKey)).toBeNull());

      // The first request shows the slide drawn, its XML and styles; the second the result drawn.
      const first = anthropic.requests[0]!;
      expect(first.model).toBe('claude-sonnet-5-5');
      expect(first.tools?.map((tool) => ('name' in tool ? tool.name : ''))).toEqual([
        'view_slide',
        'search_deck',
        'deck_overview',
        'read_text',
        'inspect_slide',
        'zoom_slide',
        'view_layout',
        'list_comments',
        'list_pictures',
        'view_picture',
        'add_picture',
        'insert_slide',
        'add_variant',
        'list_layouts',
        'tilt_element',
        'delete_slide',
        'move_slide',
        'read_styles',
        'write_slide',
        'edit_slide',
        'change_elements',
        'add_comment',
        'ask_back',
        // The deck's board (Folie 0): read through tools only.
        'list_materials',
        'read_material',
        'read_sheet',
        'search_materials',
        'view_material',
      ]);
      expect(first.max_tokens).toBe(128_000);
      expect(first.output_config?.task_budget).toMatchObject({ type: 'tokens' });
      expect(first.betas).toContain('task-budgets-2026-03-13');
      // It thinks hard, and old tool results leave a long conversation.
      expect(first.output_config?.effort).toBe('high');
      expect(first.betas).toContain('context-management-2025-06-27');
      expect(first.context_management?.edits?.[0]).toMatchObject({
        type: 'clear_tool_uses_20250919',
        exclude_tools: expect.arrayContaining(['add_photo']),
      });
      const firstContent = first.messages[0]!.content as Anthropic.Beta.BetaContentBlockParam[];
      expect(firstContent.some((block) => block.type === 'image')).toBe(true);
      const shown = JSON.stringify(firstContent);
      expect(shown).toContain('Mach den Titel zu einer Aussage');
      expect(shown).toContain('The comment is on slide 3');
      expect(shown).toContain('<style:style style:name=\\"pr4\\"');
      // The design in words, the deck at a glance, the slide measured and checked, its neighbours.
      expect(shown).toContain('The design of the deck');
      expect(shown).toMatch(/Fonts in use, most first: \w/);
      expect(JSON.stringify(first.system)).toContain('never Microsoft');
      expect(shown).toContain('The deck at a glance');
      expect(shown).toContain('Layout check of slide 3');
      expect(shown).toContain('Slide 2, before');
      expect(shown).toContain('Slide 4, after');
      const result = toolResults(anthropic.requests[1]!)[0]!;
      expect(result.is_error).toBeUndefined();
      expect(JSON.stringify(result.content)).toContain('image/webp');
      expect(JSON.stringify(result.content)).toContain('Layout check of slide 3');
      // Once it has written it checks with less thought – the cache kept, Sonnet without fast mode.
      expect(anthropic.requests[1]!.messages.at(-1)).toEqual({
        role: 'system',
        content: [],
        output_config: { effort: 'medium' },
      });
      expect(anthropic.requests[1]!.betas).toContain('mid-conversation-output-config-2026-07-01');
      expect(first.betas).not.toContain('mid-conversation-output-config-2026-07-01');
      expect(anthropic.requests[1]!.speed).toBeUndefined();

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
      expect(await ok('revert')).toMatchObject({ seq: 0 });
      expect((await slides())[2]!.title).toBe('Umsatz nach Region');
      expect((await proposals(ctx, deckId))[0]!.status).toBe('reverted');
      expect(await ok('reapply')).toMatchObject({ seq: 1 });
      expect((await slides())[2]!.title).toBe('Umsatz 2026: +10 %');

      // With a step on another slide on top, it is taken back by writing the slide as it was.
      const edit = async (slideIndex: number, paragraphs: string[]) => {
        const current = deckEditStateSchema.parse(
          await (await ctx.request(`/api/decks/${deckId}/edit`)).json(),
        );
        const res = await ctx.request(`/api/decks/${deckId}/edit/operations`, {
          method: 'POST',
          json: {
            operations: [
              { type: 'setText', elementId: titleOf(current, slideIndex).id, paragraphs },
            ],
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
    }
    {
      const { ctx, anthropic, deckId, state } = await setup();
      const slide = state.slides[2]!;
      const retitle = async (title: string) => {
        anthropic.steps = [
          writeShown(3, (xml) => xml.replace('>Umsatz nach Region<', `>${title}<`)),
          message([text(`Titel: ${title}`)], 'end_turn'),
        ];
        expect((await ask(ctx, deckId, slide.slideId, `Titel ${title}`)).status).toBe(202);
        return settled(ctx, deckId);
      };
      const act = async (id: string, action: 'revert' | 'reapply') => {
        const res = await ctx.request(`/api/decks/${deckId}/ai/proposals/${id}/${action}`, {
          method: 'POST',
        });
        expect(res.status).toBe(200);
        return deckEditStateSchema.parse(await res.json());
      };

      // A goes in as step 1 and is taken back (undo); B then goes in as step 1 in its place, and
      // is taken back too: the step to redo now is B's.
      const a = await retitle('Titel A');
      expect(await act(a.id, 'revert')).toMatchObject({ seq: 0 });
      const b = await retitle('Titel B');
      expect(b.id).not.toBe(a.id);
      expect(await act(b.id, 'revert')).toMatchObject({ seq: 0 });

      // A again is A's change, written anew – B stays taken back.
      const again = await act(a.id, 'reapply');
      expect(again.seq).toBe(1);
      expect(titleOf(again, 2).paragraphs).toEqual(['Titel A']);
      const byId = new Map((await proposals(ctx, deckId)).map((item) => [item.id, item.status]));
      expect(byId.get(a.id)).toBe('applied');
      expect(byId.get(b.id)).toBe('reverted');
    }
    {
      // A voice memo sent to the AI: the AI reads it whole, the people see it in short.
      const { ctx, anthropic, deckId, state } = await setup();
      const commentId = await comment(ctx, deckId, state.slides[0]!.slideId, 'Siehe Memo');
      const said = 'Also der Titel hier, der sollte bitte deutlich kürzer werden. '.repeat(4);
      await ctx.deps.db.insert(media).values({
        id: crypto.randomUUID(),
        deckId,
        commentId,
        ownerId: ctx.ownerId,
        uploaderId: ctx.ownerId,
        kind: 'audio',
        mimeType: 'audio/webm',
        sizeBytes: 1,
        durationMs: 9000,
        storageKey: 'memo',
        sha256: 'x',
        transcript: said,
        transcriptStatus: 'done',
      });
      // Both run at once: each answers by what it was asked.
      const reply = (body: Anthropic.Beta.MessageCreateParams) =>
        message(
          [text(JSON.stringify(body.system).includes('voice memo') ? 'Titel kürzen.' : 'Nichts.')],
          'end_turn',
        );
      anthropic.steps = [reply, reply];
      const res = await ctx.request(`/api/decks/${deckId}/ai/proposals`, {
        method: 'POST',
        json: { commentId },
      });
      expect(res.status).toBe(202);
      await settled(ctx, deckId);
      const main = anthropic.requests.find(
        (body) => !JSON.stringify(body.system).includes('voice memo'),
      );
      expect(JSON.stringify(main!.messages)).toContain(`(said in a recording) ${said.trim()}`);
      await vi.waitFor(async () => {
        const list = (await (await ctx.request(`/api/decks/${deckId}/comments`)).json()) as {
          id: string;
          media: { transcript: string; transcriptSummary: string | null } | null;
        }[];
        expect(list.find((item) => item.id === commentId)?.media).toMatchObject({
          transcript: said,
          transcriptSummary: 'Titel kürzen.',
        });
      });
    }
    {
      const { ctx, anthropic, deckId, state } = await setup();
      const slide = state.slides[3]!;
      const commentId = await comment(
        ctx,
        deckId,
        slide.slideId,
        'Nimm dieses Bild statt der Roadmap',
      );
      // Larger than the AI may see (3000 px with many pictures): it sees it shrunk, the deck
      // gets it whole.
      const png = new Uint8Array(await createCanvas(3200, 1800).encode('png'));
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
      expect(shown).toContain('3200 × 1800 px');
      const sent = anthropic.requests[0]!.messages[0]!
        .content as Anthropic.Beta.BetaContentBlockParam[];
      const seen = sent.flatMap((block) =>
        block.type === 'image' && block.source.type === 'base64'
          ? [
              {
                type: block.source.media_type,
                ...imageSize(Buffer.from(block.source.data, 'base64')),
              },
            ]
          : [],
      );
      expect(seen).toContainEqual({
        type: 'image/png',
        mediaType: 'image/png',
        width: 2560,
        height: 1440,
      });
      expect(seen.every((picture) => Math.max(picture.width!, picture.height!) <= 2560)).toBe(true);
      const [missing, added] = toolResults(anthropic.requests[1]!);
      expect(missing).toMatchObject({ is_error: true, content: expect.stringContaining('has 1') });
      expect(added!.content).toContain('3200 × 1800 px');

      const file = async () =>
        JSZip.loadAsync(await (await ctx.request(`/api/decks/${deckId}/edit/file`)).arrayBuffer());
      const zip = await file();
      expect(zip.file(path)).not.toBeNull();
      expect(imageSize(await zip.file(path)!.async('uint8array'))).toMatchObject({ width: 3200 });
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
    }
  });

  it('reads the thread and the place of its comment – between two slides too – and needs a comment with words', async () => {
    {
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
    }
    {
      const { ctx, anthropic, deckId, state } = await setup();
      const [first, second] = [state.slides[0]!, state.slides[1]!];
      anthropic.steps = [
        message(
          [
            toolUse('list_layouts', {}),
            toolUse('insert_slide', { after: 1, template: 'nope', layout: 1 }),
            toolUse('insert_slide', { after: 1, master: 'nope' }),
            toolUse('insert_slide', { after: 1, copy_of: 2, master: 'nope' }),
            toolUse('tilt_element', { slide: 1, element: 'nope', x: 20, y: 0 }),
          ],
          'tool_use',
        ),
        // The default path: an empty slide of a layout, its placeholders filled as the editor does.
        message(
          [toolUse('insert_slide', { after: 1, master: 'Title_20_and_20_Content' })],
          'tool_use',
        ),
        (body) => {
          const shown = JSON.stringify(toolResults(body)[0]!.content);
          const id = (role: string) =>
            new RegExp(`presentation:class=\\\\"${role}\\\\"[^>]*xml:id=\\\\"([^\\\\]+)`).exec(
              shown,
            )![1]!;
          return message(
            [
              toolUse('change_elements', {
                slide: 2,
                changes: [
                  { element: id('title'), text: ['Agenda'] },
                  { element: id('outline'), text: ['Umsatz', 'Roadmap', 'Nächste Schritte'] },
                ],
              }),
            ],
            'tool_use',
          );
        },
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
      // Layouts listed; a template, master or element that is not there refused, nothing added.
      const [layouts, template, master, both, tilt] = toolResults(anthropic.requests[1]!);
      expect(JSON.stringify(layouts!.content)).toContain("The deck's master pages");
      expect(layouts!.is_error).toBeUndefined();
      expect(template).toMatchObject({
        is_error: true,
        content: expect.stringContaining('no template nope'),
      });
      expect(master).toMatchObject({ is_error: true });
      expect(both).toMatchObject({
        is_error: true,
        content: expect.stringContaining('Give one of'),
      });
      expect(tilt).toMatchObject({
        is_error: true,
        content: expect.stringContaining('no element nope'),
      });
      expect(JSON.stringify(anthropic.requests[0]!.messages).match(/<draw:page /g)).toHaveLength(2);
      const after = deckEditStateSchema.parse(
        await (await ctx.request(`/api/decks/${deckId}/edit`)).json(),
      );
      expect(after.slides).toHaveLength(state.slides.length + 1);
      // Its list placeholder filled: one point per paragraph, bullets shown.
      const points = after.slides[1]!.elements.find((element) => element.role === 'outline')!;
      expect(points.paragraphs).toEqual(['Umsatz', 'Roadmap', 'Nächste Schritte']);
      expect(
        points.live!.paragraphs.every((paragraph) => paragraph.bullet && paragraph.level === 1),
      ).toBe(true);

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
    }
    {
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
    }
  });

  it('looks at slides and styles, changes parts of them, and corrects itself when a call is refused or broken – nothing changed when it only looks', async () => {
    // Looks of one answer run side by side, writes alone and in order.
    expect(
      callGroups(
        [
          'view_slide',
          'read_styles',
          'edit_slide',
          'inspect_slide',
          'zoom_slide',
          'write_slide',
        ].map((name) => ({ name })),
      ).map((group) => group.map((call) => call.name)),
    ).toEqual([
      ['view_slide', 'read_styles'],
      ['edit_slide'],
      ['inspect_slide', 'zoom_slide'],
      ['write_slide'],
    ]);
    {
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
    }
    {
      const { ctx, anthropic, deckId, state } = await setup();
      const broken = toolUse('write_slide', {});
      anthropic.steps = [
        new BrokenCall([
          text('Ich baue den Hintergrund.'),
          toolUse('view_slide', { slide: 4 }),
          broken,
        ]),
        writeShown(3, (xml) => xml.replace('>Umsatz nach Region<', '>Umsatz<')),
        message([text('Erledigt.')], 'end_turn'),
      ];
      await ask(ctx, deckId, state.slides[2]!.slideId, 'Hintergrund als Formen');
      const done = await settled(ctx, deckId);
      expect(done.status).toBe('applied');
      expect(anthropic.aborted).toBe(1);

      const [view, refused] = toolResults(anthropic.requests[1]!);
      expect(JSON.stringify(view!.content)).toContain('Slide 4');
      expect(refused).toMatchObject({
        tool_use_id: (broken as Anthropic.Beta.BetaToolUseBlock).id,
        is_error: true,
        content: expect.stringContaining('not valid JSON'),
      });

      // Broken where nothing of the answer is left: the person is told what went wrong.
      anthropic.steps = [unreadableJson()];
      await ask(ctx, deckId, state.slides[2]!.slideId, 'Nochmal');
      const failed = await settled(ctx, deckId);
      expect(failed).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('kaputtem Format'),
      });
    }
    {
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
    }
    {
      const { ctx, anthropic, deckId, state } = await setup();
      // It looks around – the deck side by side, texts, a slide measured, close up, a layout,
      // the other comments – and changes nothing.
      anthropic.steps = [
        message(
          [
            toolUse('deck_overview', {}),
            toolUse('read_text', { slides: [3] }),
            toolUse('inspect_slide', { slide: 3 }),
            toolUse('zoom_slide', { slide: 3, area: { x: 1, y: 1, width: 10, height: 4 } }),
            toolUse('view_layout', { master: 'nope' }),
            toolUse('list_comments', {}),
          ],
          'tool_use',
        ),
        message([text('Die Folie passt schon.')], 'end_turn'),
      ];
      await comment(ctx, deckId, state.slides[0]!.slideId, 'Logo größer');
      await ask(ctx, deckId, state.slides[2]!.slideId, 'Passt das?');
      expect(await settled(ctx, deckId)).toMatchObject({
        status: 'ready',
        summary: 'Die Folie passt schon.',
      });
      const [overview, texts, inspected, zoomed, layout, open] = toolResults(
        anthropic.requests[1]!,
      ).map((result) => ({ ...result, shown: JSON.stringify(result.content) }));
      expect(overview!.shown).toContain('image/webp');
      expect(overview!.shown).toMatch(/Slides 1–\d+ of \d+/);
      expect(texts!.shown).toContain('Slide 3');
      expect(texts!.shown).toContain('Umsatz nach Region');
      expect(inspected!.shown).toContain('Layout check of slide 3');
      expect(inspected!.shown).toMatch(/title .*x [\d.]+, y [\d.]+, w [\d.]+, h [\d.]+/);
      expect(zoomed!.is_error).toBeUndefined();
      expect(zoomed!.shown).toContain('image/webp');
      expect(layout).toMatchObject({ is_error: true });
      expect(layout!.shown).toContain('list_layouts');
      expect(open!.shown).toContain('Logo größer');
      expect(open!.shown).not.toContain('Passt das?');
    }
    {
      // Element changes without XML, as the editor makes them – refused all when one cannot be.
      const { ctx, anthropic, deckId, state } = await setup();
      const title = titleOf(state, 2);
      anthropic.steps = [
        message(
          [
            toolUse('change_elements', {
              slide: 3,
              changes: [
                { element: title.id, text: ['Kurz'] },
                { element: 'nope', bold: true },
              ],
            }),
          ],
          'tool_use',
        ),
        message(
          [
            toolUse('change_elements', {
              slide: 3,
              changes: [
                {
                  element: title.id,
                  text: ['Kurz'],
                  bold: true,
                  font: 'Calibri',
                  box: { x: 1, y: 1, width: 20, height: 3 },
                },
                // New ones as the editor adds them, referred to by name within the call.
                {
                  add: 'ellipse',
                  name: 'a',
                  box: { x: 2, y: 15, width: 2, height: 2 },
                  fill: '#2563EB',
                },
                { copy_of: 'a', name: 'b', next_to: { element: 'a', side: 'right', gap: 4 } },
                { add: 'arrow', from: { element: 'a' }, to: { element: 'b' } },
                { add: 'text', next_to: { element: 'b', side: 'right' }, text: ['Ziel'], width: 5 },
                { element: 'b', text: ['B'], text_color: '#ffffff' },
                // The slide's own settings in the same call.
                { slide: 3, transition: 'fade' },
              ],
            }),
          ],
          'tool_use',
        ),
        message([text('Titel gekürzt.')], 'end_turn'),
      ];
      await ask(ctx, deckId, state.slides[2]!.slideId, 'Titel kürzer');
      expect(await settled(ctx, deckId)).toMatchObject({ status: 'applied' });
      expect(toolResults(anthropic.requests[1]!)[0]).toMatchObject({ is_error: true });
      expect(JSON.stringify(toolResults(anthropic.requests[1]!)[0]!.content)).toContain(
        'has no element nope',
      );
      const drawn = JSON.stringify(toolResults(anthropic.requests[2]!)[0]!.content);
      expect(drawn).toMatch(/New elements \(xml:id\): a: sl[\w-]+, b: sl[\w-]+, sl[\w-]+, sl/);
      expect(drawn).toContain('image/webp');
      expect(drawn).toContain('Layout check of slide 3');
      const after = deckEditStateSchema.parse(
        await (await ctx.request(`/api/decks/${deckId}/edit`)).json(),
      );
      const changed = titleOf(after, 2);
      expect(changed.paragraphs).toEqual(['Kurz']);
      expect(JSON.stringify(changed)).toMatch(/"bold":true|"fontWeight":"bold"/);
      // A Microsoft font name is written as its free twin.
      expect(JSON.stringify(changed)).toContain('"font":"Carlito"');
      const added = after.slides[2]!.elements.filter(
        (element) => element.id.startsWith('sl') && element.id.length > 20,
      );
      expect(added.map((element) => element.kind)).toEqual(['shape', 'shape', 'line', 'text']);
      const [a, b, arrow, label] = added as [
        EditableElement,
        EditableElement,
        EditableElement,
        EditableElement,
      ];
      expect(a.look?.fill).toBe('#2563eb');
      expect(b.look?.fill).toBe('#2563eb');
      expect(b.paragraphs).toEqual(['B']);
      // 2 cm beside: the second circle 4 cm on, the arrow straight across the gap between them.
      expect((b.bbox.x - a.bbox.x - a.bbox.w) * 33.867).toBeCloseTo(4, 1);
      expect(arrow.line).toEqual({ heads: 'end' });
      expect(arrow.bbox.h).toBe(0);
      expect(arrow.bbox.x).toBeGreaterThan(a.bbox.x + a.bbox.w);
      expect(arrow.bbox.x + arrow.bbox.w).toBeLessThan(b.bbox.x);
      expect(label.paragraphs).toEqual(['Ziel']);
      expect(after.slides[2]!.transition).toBe('fade');
      // In the slide's body text, as the editor's new text box.
      const note = after.slides[2]!.elements.find((element) => element.name === 'Hinweis')!;
      expect(label.live?.paragraphs[0]?.runs[0]?.font).toBe(note.live?.paragraphs[0]?.mark.font);

      // A plain request is made with the fast model's edits, without the AI that designs.
      anthropic.requests = [];
      anthropic.quick = [{ edits: [{ element: changed.id, italic: true }] }];
      await ask(ctx, deckId, state.slides[2]!.slideId, 'Titel kursiv');
      expect(await settled(ctx, deckId)).toMatchObject({
        status: 'applied',
        summary: 'Direkt umgesetzt: Schrift angepasst.',
      });
      expect(anthropic.requests).toHaveLength(0);
      const asked = anthropic.quickRequests.at(-1)!;
      expect(JSON.stringify(asked.messages)).toContain(changed.id);
      expect(JSON.stringify(asked.messages)).toContain('Titel kursiv');
      const italic = titleOf(
        deckEditStateSchema.parse(await (await ctx.request(`/api/decks/${deckId}/edit`)).json()),
        2,
      );
      expect(JSON.stringify(italic)).toMatch(/"italic":true/);
      // Every action the editor has goes the quick way: elements grouped, a new slide with its
      // title and points (a bullet list, in a layout with a text placeholder), its background, a
      // copy of it – none of them asks the AI that designs.
      const editState = async () =>
        deckEditStateSchema.parse(await (await ctx.request(`/api/decks/${deckId}/edit`)).json());
      const quickly = async (prompt: string, edits: unknown[], summary: string) => {
        anthropic.quick = [{ edits }];
        await ask(ctx, deckId, state.slides[2]!.slideId, prompt);
        expect(await settled(ctx, deckId)).toMatchObject({ status: 'applied', summary });
        return editState();
      };
      const grouped = await quickly(
        'Gruppier die beiden Kreise',
        [{ group: [a.id, b.id] }],
        'Direkt umgesetzt: gruppiert.',
      );
      const group = grouped.slides[2]!.elements.find((element) => element.kind === 'group');
      expect(group?.children?.map((part) => part.id)).toEqual([a.id, b.id]);
      const count = grouped.slides.length;
      const inserted = await quickly(
        'Neue Folie nach Folie 1 mit Titel Agenda und den Punkten A, B, C',
        [{ new_slide: { after: 1 }, title: 'Agenda', text: ['A', 'B', 'C'] }],
        'Direkt umgesetzt: Folie eingefügt.',
      );
      expect(inserted.slides).toHaveLength(count + 1);
      const agenda = inserted.slides[1]!;
      expect(agenda.elements.find((element) => element.role === 'title')?.paragraphs).toEqual([
        'Agenda',
      ]);
      const points = agenda.elements.find((element) => element.role === 'outline')!;
      expect(points.paragraphs).toEqual(['A', 'B', 'C']);
      expect(points.live?.paragraphs.every((paragraph) => paragraph.bullet)).toBe(true);
      const coloured = await quickly(
        'Hintergrund von Folie 2 dunkelblau',
        [{ slide: 2, background: '#1E3A8A', text_color: '#ffffff' }],
        'Direkt umgesetzt: Hintergrund geändert und Schrift angepasst.',
      );
      expect(coloured.slides[1]!.background).toBe('#1e3a8a');
      // Its texts light on it, each as the editor writes it.
      expect(
        coloured.slides[1]!.elements.flatMap((element) =>
          (element.live?.paragraphs ?? []).flatMap((paragraph) =>
            paragraph.runs.map((run) => run.color),
          ),
        ),
      ).toEqual(['#ffffff', '#ffffff', '#ffffff', '#ffffff']);
      const copied = await quickly(
        'Folie 2 duplizieren',
        [{ slide: 2, duplicate: true }],
        'Direkt umgesetzt: Folie dupliziert.',
      );
      expect(copied.slides).toHaveLength(count + 2);
      expect(
        copied.slides[2]!.elements.find((element) => element.role === 'title')?.paragraphs,
      ).toEqual(['Agenda']);
      expect(copied.slides[2]!.background).toBe('#1e3a8a');
      expect(anthropic.requests).toHaveLength(0);
      // Edits that do not fit the slide: the AI that designs does the request.
      anthropic.quick = [{ edits: [{ element: 'nope', bold: true }] }];
      anthropic.steps = [message([text('Erledigt.')], 'end_turn')];
      await ask(ctx, deckId, state.slides[2]!.slideId, 'Titel fett');
      expect(await settled(ctx, deckId)).toMatchObject({ status: 'ready', summary: 'Erledigt.' });
      expect(anthropic.requests).toHaveLength(1);
      // About several slides: the fast model, seeing one, is not asked – even if it had edits.
      const askedQuick = anthropic.quickRequests.length;
      anthropic.requests = [];
      anthropic.quick = [{ edits: [{ element: changed.id, fill: '#ffffff' }] }];
      anthropic.steps = [message([text('Auf allen Folien.')], 'end_turn')];
      await ask(ctx, deckId, state.slides[2]!.slideId, 'Footer auf allen Folien transparent');
      expect(await settled(ctx, deckId)).toMatchObject({ summary: 'Auf allen Folien.' });
      expect(anthropic.quickRequests).toHaveLength(askedQuick);
      expect(anthropic.requests).toHaveLength(1);
      anthropic.quick = [];
      expect(
        ['mach auf allen slides', 'jede Folie', 'überall gleich', 'an Folien 2 und 3'].every(
          aboutSeveralSlides,
        ),
      ).toBe(true);
      expect(['Titel fett', 'Folie 2 blau', 'alle Elemente links'].some(aboutSeveralSlides)).toBe(
        false,
      );
    }
  });

  it('searches the deck, lists its pictures, cuts one out and generates one – not without rembg or a key for pictures, and going on when rembg is out of reach', async () => {
    {
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
    }
    {
      const sent: { width: number; height: number }[] = [];
      // rembg as far as Slider reads its answer: a PNG header of the size it got.
      const cutOuts: CutOutSource = {
        cutOut: async (bytes) => {
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          const size = { width: view.getUint32(16), height: view.getUint32(20) };
          sent.push(size);
          return pngOf(size.width, size.height);
        },
      };
      const { ctx, anthropic, deckId, state } = await setup(true, { cutOuts });
      let original = '';
      let copy = '';
      anthropic.steps = [
        message([toolUse('list_pictures', {})], 'tool_use'),
        (body) => {
          original = String(toolResults(body)[0]!.content).match(/Pictures\/\S+\.png/)![0];
          return message(
            [
              toolUse('cut_out', { path: original }),
              toolUse('cut_out', {
                path: original,
                area: { x: 300, y: 20, width: 100, height: 50 },
              }),
              toolUse('cut_out', {
                path: original,
                area: { x: 400, y: 20, width: 100, height: 50 },
              }),
              toolUse('cut_out', { path: 'content.xml' }),
            ],
            'tool_use',
          );
        },
        (body) => {
          copy = String((toolResults(body)[0]!.content as { text?: string }[])[0]!.text).match(
            /as (Pictures\/\S+\.png)/,
          )![1]!;
          return writeShown(4, (xml) => xml.replace(original, copy))(body);
        },
        message([text('Hintergrund entfernt.')], 'end_turn'),
      ];
      await ask(ctx, deckId, state.slides[3]!.slideId, 'Hintergrund weg');
      expect(await settled(ctx, deckId)).toMatchObject({ status: 'applied' });

      const first = anthropic.requests[0]!;
      expect(first.tools?.map((tool) => ('name' in tool ? tool.name : ''))).toContain('cut_out');
      expect(JSON.stringify(first.system)).toContain('cut_out makes a copy');
      // The whole picture, then only the part of the area within it.
      expect(sent).toEqual([
        { width: 320, height: 180 },
        { width: 20, height: 50 },
      ]);
      const [cut, part, missed, outside] = toolResults(anthropic.requests[2]!);
      expect(JSON.stringify(cut!.content)).toContain('320 × 180 px, background transparent');
      expect(JSON.stringify(cut!.content)).toContain('image/png');
      expect(JSON.stringify(part!.content)).toContain('The area x 300, y 20, 20 × 50 px of');
      expect(JSON.stringify(part!.content)).toContain('(20 × 50 px, background transparent)');
      expect(missed).toMatchObject({
        is_error: true,
        content: expect.stringContaining('The area misses'),
      });
      expect(outside).toMatchObject({
        is_error: true,
        content: expect.stringContaining('no picture'),
      });

      const zip = await JSZip.loadAsync(
        await (await ctx.request(`/api/decks/${deckId}/edit/file`)).arrayBuffer(),
      );
      expect(copy).not.toBe(original);
      expect(zip.file(copy)).not.toBeNull();
      expect(await zip.file('content.xml')!.async('string')).toContain(copy);
    }
    {
      const { ctx, anthropic, deckId, state } = await setup();
      anthropic.steps = [message([text('Nichts zu tun.')], 'end_turn')];
      await ask(ctx, deckId, state.slides[0]!.slideId, 'Hintergrund weg');
      await settled(ctx, deckId);
      const first = anthropic.requests[0]!;
      expect(first.tools?.map((tool) => ('name' in tool ? tool.name : ''))).not.toContain(
        'cut_out',
      );
      expect(JSON.stringify(first.system)).not.toContain('cut_out');
      expect(first.tools?.map((tool) => ('name' in tool ? tool.name : ''))).not.toContain(
        'generate_image',
      );

      const down = await setup(true, {
        cutOuts: {
          cutOut: () => Promise.reject(new ApiError(503, 'source_unreachable', 'nicht erreichbar')),
        },
      });
      down.anthropic.steps = [
        message([toolUse('list_pictures', {})], 'tool_use'),
        (body) =>
          message(
            [
              toolUse('cut_out', {
                path: String(toolResults(body)[0]!.content).match(/Pictures\/\S+\.png/)![0],
              }),
            ],
            'tool_use',
          ),
        message([text('Geht gerade nicht.')], 'end_turn'),
      ];
      await ask(down.ctx, down.deckId, down.state.slides[3]!.slideId, 'Hintergrund weg');
      expect(await settled(down.ctx, down.deckId)).toMatchObject({ summary: 'Geht gerade nicht.' });
      expect(toolResults(down.anthropic.requests[2]!)[0]).toMatchObject({
        is_error: true,
        content: expect.stringContaining('Cutting out is not available right now'),
      });
    }
    {
      // The workspace's key for pictures: the AI generates one, cut to its frame, and uses it.
      const asked: string[] = [];
      const { createCanvas } = await import('@napi-rs/canvas');
      const png = new Uint8Array(await createCanvas(4, 2).encode('png'));
      const aiFetch = async (url: string, init?: RequestInit) => {
        if (url.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-image-2' }] });
        if (url.endsWith('/images/generations')) {
          asked.push(String(init?.body));
          return Response.json({ data: [{ b64_json: Buffer.from(png).toString('base64') }] });
        }
        return new Response('', { status: 404 });
      };
      const { ctx, anthropic, deckId, state } = await setup(true, { aiFetch });
      await ctx.request(`/api/workspaces/${ctx.workspaceId}/integrations/keys`, {
        method: 'POST',
        json: { kind: 'images', provider: 'openai', apiKey: 'sk-proj-good-1234567' },
      });
      let original = '';
      let made = '';
      anthropic.steps = [
        message([toolUse('list_pictures', {})], 'tool_use'),
        (body) => {
          original = String(toolResults(body)[0]!.content).match(/Pictures\/\S+\.png/)![0];
          return message(
            [
              toolUse('generate_image', { prompt: 'A pumpkin field at dusk', aspect: 1 }),
              toolUse('generate_image', { prompt: 'A pumpkin', aspect: 1 }),
              toolUse('generate_image', { prompt: 'A pumpkin', aspect: 1 }),
              toolUse('generate_image', { prompt: 'A pumpkin', aspect: 1 }),
            ],
            'tool_use',
          );
        },
        (body) => {
          made = String((toolResults(body)[0]!.content as { text?: string }[])[0]!.text).match(
            /as (Pictures\/\S+\.jpg)/,
          )![1]!;
          return writeShown(4, (xml) => xml.replace(original, made))(body);
        },
        message([text('Bild generiert.')], 'end_turn'),
      ];
      await ask(ctx, deckId, state.slides[3]!.slideId, 'Generiere ein Bild von Kürbissen');
      expect(await settled(ctx, deckId)).toMatchObject({ status: 'applied' });

      const first = anthropic.requests[0]!;
      expect(first.tools?.map((tool) => ('name' in tool ? tool.name : ''))).toContain(
        'generate_image',
      );
      expect(JSON.stringify(first.system)).toContain('generate_image makes a new picture');
      expect(asked).toHaveLength(3);
      expect(asked[0]).toContain('A pumpkin field at dusk');
      const [generated, , , fourth] = toolResults(anthropic.requests[2]!);
      // Cut to the square frame: the middle of the 4 × 2 picture.
      expect(JSON.stringify(generated!.content)).toContain('(2 × 2 px)');
      expect(JSON.stringify(generated!.content)).toContain('image/');
      expect(fourth).toMatchObject({
        is_error: true,
        content: expect.stringContaining('No more pictures'),
      });
      const zip = await JSZip.loadAsync(
        await (await ctx.request(`/api/decks/${deckId}/edit/file`)).arrayBuffer(),
      );
      expect(zip.file(made)).not.toBeNull();
      expect(await zip.file('content.xml')!.async('string')).toContain(made);
    }
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

  it('makes a variant from the words of „Variante erstellen“, and one asked for in a thread – the whole thread its brief; its card done and open again for everyone', async () => {
    const hub = new LiveHub();
    const { ctx, anthropic, deckId } = await setup(true, { live: hub });
    const slides = () =>
      ctx
        .request(`/api/decks/${deckId}/slides`)
        .then(async (r) => slideSchema.array().parse(await r.json()));
    const original = await slides();

    // „Variante erstellen“ with words: the copy is made first, the AI changes it – only it.
    anthropic.steps = [
      (body) => {
        const first = JSON.stringify(body.messages[0]);
        expect(first).toContain('dunkler, mit Bild rechts');
        expect(first).toContain('Slide 4 is a new variant of slide 3');
        expect(first).toContain('4. Umsatz nach Region (variant of slide 3, hidden in the show)');
        // Written without its mark: it stays the slide's variant, hidden.
        return writeShown(4, (xml) =>
          xml
            .replace(/ slider:variant-of="[^"]*"/, '')
            .replace('>Umsatz nach Region<', '>Umsatz dunkel<'),
        )(body);
      },
      message([text('Variante dunkler gemacht.')], 'end_turn'),
    ];
    const res = await ctx.request(`/api/decks/${deckId}/ai/proposals`, {
      method: 'POST',
      json: { variantOf: original[2]!.id, prompt: 'dunkler, mit Bild rechts' },
    });
    expect(res.status).toBe(202);
    expect(await settled(ctx, deckId)).toMatchObject({
      status: 'applied',
      commentId: null,
      slideId: original[2]!.id,
      summary: 'Variante dunkler gemacht.',
    });
    let after = await slides();
    expect(after).toHaveLength(original.length + 1);
    expect(after[2]).toMatchObject({ id: original[2]!.id, title: 'Umsatz nach Region' });
    expect(after[3]).toMatchObject({
      title: 'Umsatz dunkel',
      hidden: true,
      variantOf: original[2]!.id,
    });
    expect(anthropic.quickRequests).toHaveLength(0);

    // Its card („Antwort der KI“ on the variant) is open until someone closes it – then done for
    // everyone, kept and heard by the others at once; opened again the same way (a thread's done).
    const made = (await proposals(ctx, deckId))[0]!;
    expect(made.resolvedAt).toBeNull();
    const owner: Author = { id: ctx.ownerId, name: 'Owner', type: 'owner', color: 'blue' };
    const heard: LiveEvent[] = [];
    hub.join(deckId, owner, (event) => event.type === 'proposals' && heard.push(event));
    const resolve = (status: string) =>
      ctx.request(`/api/decks/${deckId}/ai/proposals/${made.id}`, {
        method: 'PATCH',
        json: { status },
      });
    const closed = await resolve('done');
    expect(closed.status).toBe(200);
    expect(aiProposalSchema.parse(await closed.json()).resolvedAt).not.toBeNull();
    expect((await proposals(ctx, deckId))[0]!.resolvedAt).not.toBeNull();
    expect(heard).toEqual([{ type: 'proposals' }]);
    // Done again: nothing changes, nobody is told.
    expect((await resolve('done')).status).toBe(200);
    expect(heard).toHaveLength(1);
    expect((await resolve('open')).status).toBe(200);
    expect((await proposals(ctx, deckId))[0]!.resolvedAt).toBeNull();
    expect(heard).toEqual([{ type: 'proposals' }, { type: 'proposals' }]);
    expect((await resolve('weg')).status).toBe(400);
    expect(
      (
        await ctx.request(`/api/decks/${deckId}/ai/proposals/nope`, {
          method: 'PATCH',
          json: { status: 'done' },
        })
      ).status,
    ).toBe(404);
    // Words are needed.
    const empty = await ctx.request(`/api/decks/${deckId}/ai/proposals`, {
      method: 'POST',
      json: { variantOf: original[2]!.id, prompt: '  ' },
    });
    expect(empty.status).toBe(400);

    // Asked in a reply: the AI makes it with add_variant, the thread before it the brief.
    const root = await comment(ctx, deckId, original[1]!.id, 'Die Agenda wirkt zu voll.');
    const reply = await comment(
      ctx,
      deckId,
      original[1]!.id,
      'Mach mir mal ne Variante dazu, mit nur drei Punkten',
      root,
    );
    anthropic.steps = [
      (body) => {
        expect(JSON.stringify(body.system)).toContain('add_variant');
        const first = JSON.stringify(body.messages[0]);
        expect(first).toContain('Die Agenda wirkt zu voll.');
        expect(first).toContain('Mach mir mal ne Variante dazu');
        return message([toolUse('add_variant', { slide: 2 })], 'tool_use');
      },
      (body) => {
        const result = JSON.stringify(toolResults(body)[0]!.content);
        expect(result).toContain('Slide 3 added – a variant of slide 2');
        expect(result).toContain('3. Agenda (variant of slide 2, hidden in the show)');
        return message(
          [text('Ich habe eine Variante der Folie gemacht – sie steht über ihr.')],
          'end_turn',
        );
      },
    ];
    const asked = await ctx.request(`/api/decks/${deckId}/ai/proposals`, {
      method: 'POST',
      json: { commentId: reply },
    });
    expect(asked.status).toBe(202);
    expect(await settled(ctx, deckId)).toMatchObject({ status: 'applied', commentId: reply });
    // „Variante“ is never a quick request.
    expect(anthropic.quickRequests).toHaveLength(0);
    // Nor any other way of asking for one – aloud or typed, German or English: never edits of the
    // slide itself.
    for (const asking of [
      'Zeig mir eine Alternative dazu',
      'Mach eine andere Version, kürzer',
      'Version B mit Foto',
      'Eine zweite Fassung in Blau',
      'noch eine Version davon',
      'Gegenentwurf mit Bild',
      'Give me an alternative',
      'another version with a chart',
      'Make a version B',
    ])
      expect(asksForVariant(asking), asking).toBe(true);
    for (const editing of [
      'Alternativtext für das Bild',
      'alternative text for the picture',
      'Schreib Version 2.0 in den Titel',
      'Die Version von gestern war besser',
      'Den Titel blau',
    ])
      expect(asksForVariant(editing), editing).toBe(false);
    after = await slides();
    expect(after[1]).toMatchObject({ id: original[1]!.id, hidden: false });
    expect(after[2]).toMatchObject({ title: 'Agenda', hidden: true, variantOf: original[1]!.id });
  });

  it('leaves a comment of its own, asks back in the thread, and stops when asked', async () => {
    {
      const { ctx, anthropic, deckId, state } = await setup();
      anthropic.steps = [
        (body) =>
          message(
            [
              toolUse('write_slide', {
                slide: 3,
                xml: shownXml(body).replace('>Umsatz nach Region<', '>Umsatz<'),
              }),
              toolUse('add_comment', {
                slide: 2,
                text: 'Der Text unten wirkt abgeschnitten.',
                area: { x: 1, y: 2, width: 4, height: 3 },
              }),
              toolUse('add_comment', { slide: 99, text: 'Gibt es nicht.' }),
              toolUse('add_comment', {
                slide: 3,
                text: 'Zahl für 2026 fehlt noch?',
                area: { x: 20, y: 1, width: 1, height: 0.5 },
                sticker: true,
              }),
              toolUse('add_comment', { slide: 3, text: 'Ohne Ort', sticker: true }),
              toolUse('ask_back', {}),
            ],
            'tool_use',
          ),
        (body) => {
          const results = toolResults(body);
          expect(results[2]).toMatchObject({ is_error: true });
          expect(results[3]).not.toHaveProperty('is_error');
          // A sticker needs its place.
          expect(results[4]).toMatchObject({ is_error: true });
          return message(
            [text('Titel gekürzt. Auf Folie 2 habe ich einen Kommentar hinterlassen. Mit Jahr?')],
            'end_turn',
          );
        },
      ];
      await ask(ctx, deckId, state.slides[2]!.slideId, 'Kürzer bitte');
      const proposal = await settled(ctx, deckId);
      expect(proposal).toMatchObject({ status: 'applied', asks: true });

      const list = (await (await ctx.request(`/api/decks/${deckId}/comments`)).json()) as {
        slideId: string;
        body: string;
        status: string;
        strokes: { text: string; x: number; y: number; w: number; h: number }[];
        author: { type: string; name: string };
        anchor: {
          type: string;
          rect?: { x: number; y: number; w: number; h: number };
          shapeRef?: { shapeId: string } | null;
        };
      }[];
      const own = list.filter((item) => item.author.type === 'ai');
      expect(own).toHaveLength(2);
      // Its sticker: written on the commented slide, at least a few words wide, its box the anchor.
      const sticker = own.find((item) => item.strokes.length > 0)!;
      expect(sticker).toMatchObject({
        slideId: state.slides[2]!.slideId,
        body: 'Zahl für 2026 fehlt noch?',
        strokes: [{ tool: 'text', text: 'Zahl für 2026 fehlt noch?' }],
        anchor: { type: 'rect', shapeRef: null },
      });
      const box = sticker.strokes[0]!;
      expect(sticker.anchor.rect).toEqual({ x: box.x, y: box.y, w: box.w, h: box.h });
      expect(box.w).toBeGreaterThan(0.1);
      expect(box.x + box.w).toBeLessThanOrEqual(1);
      own.splice(own.indexOf(sticker), 1);
      expect(own[0]).toMatchObject({
        slideId: state.slides[1]!.slideId,
        body: 'Der Text unten wirkt abgeschnitten.',
        status: 'open',
        author: { name: 'KI' },
        anchor: { type: 'rect' },
      });
      const rect = own[0]!.anchor.rect!;
      // Bound to the element it is about, so it follows when that element is moved.
      expect(own[0]!.anchor.shapeRef).toMatchObject({ shapeId: expect.any(String) });
      expect(rect.x).toBeGreaterThan(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(1);
      expect(rect.y + rect.h).toBeLessThanOrEqual(1);

      // A sticker someone wrote, sent without a comment of its own, asks the AI as a comment: it
      // reads the sticker's words and that its box is the place meant.
      const area = { x: 0.6, y: 0.5, w: 0.2, h: 0.08 };
      const posted = await ctx.request(`/api/decks/${deckId}/comments`, {
        method: 'POST',
        json: {
          slideId: state.slides[2]!.slideId,
          body: '',
          anchor: { type: 'rect', rect: area, shapeRef: null },
          strokes: [
            {
              tool: 'text',
              color: 'yellow',
              ...area,
              text: 'Mach hier mal 2 Kreise hin',
              fontSize: 0.03,
            },
          ],
        },
      });
      const stickerId = ((await posted.json()) as { id: string }).id;
      let first = '';
      anthropic.steps = [
        (body) => {
          first = JSON.stringify(body.messages[0]);
          return message([text('Zwei Kreise gesetzt.')], 'end_turn');
        },
      ];
      const asked = await ctx.request(`/api/decks/${deckId}/ai/proposals`, {
        method: 'POST',
        json: { commentId: stickerId },
      });
      expect(asked.status).toBe(202);
      await vi.waitFor(() => expect(first).not.toBe(''), { timeout: 10_000 });
      expect(first).toContain('Mach hier mal 2 Kreise hin');
      expect(first).toContain('a sticker');
      expect(first).toContain('over the area x 60%, y 50%, w 20%, h 8%');
      expect(await settled(ctx, deckId)).toMatchObject({ status: 'ready' });
    }
    {
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

      // More than three requests in a thread (the stopped one not counted): a summary at its
      // top, written anew after each further one settles – the root's, sent with the comments.
      const rootId = running!.commentId!;
      const rootOf = async () =>
        (
          (await (await ctx.request(`/api/decks/${deckId}/comments`)).json()) as {
            id: string;
            aiSummary?: { text: string; at: string } | null;
          }[]
        ).find((each) => each.id === rootId)!;
      const askAgain = async (body: string) => {
        anthropic.steps = [message([text(`${body} erledigt.`)], 'end_turn')];
        const replyId = await comment(ctx, deckId, slide.slideId, body, rootId);
        const res = await ctx.request(`/api/decks/${deckId}/ai/proposals`, {
          method: 'POST',
          json: { commentId: replyId },
        });
        expect(res.status).toBe(202);
        await settled(ctx, deckId);
      };
      await askAgain('Und kürzer');
      await askAgain('Jetzt fett');
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(anthropic.summaryRequests).toHaveLength(0);
      expect((await rootOf()).aiSummary).toBeNull();
      await askAgain('Und blau');
      await vi.waitFor(async () => expect((await rootOf()).aiSummary?.text).toBe('Stand 1'), {
        timeout: 5000,
      });
      const summaryAsk = JSON.stringify(anthropic.summaryRequests[0]);
      expect(summaryAsk).toContain('Und blau');
      expect(summaryAsk).toContain('Und blau erledigt.');
      expect(summaryAsk).toContain('language of the');
      await askAgain('Etwas größer');
      await vi.waitFor(async () => expect((await rootOf()).aiSummary?.text).toBe('Stand 2'), {
        timeout: 5000,
      });
      expect(anthropic.summaryRequests[0]!.model).toBe('claude-haiku-5-5');
    }
  });

  it('runs on an OpenAI key too, needs the workspace key, and stops when Anthropic refuses it', async () => {
    {
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
      await ctx?.cleanup();
      ctx = await createTestContext({ libreOfficePdf: fakeOdpPdf(), aiFetch });
      const deck = deckSchema.parse(
        await (
          await ctx.request('/api/decks/upload', { method: 'POST', body: odpForm(DEMO_ODP) })
        ).json(),
      );
      await ctx.deps.queue.idle();
      const added = await ctx.request(`/api/workspaces/${ctx.workspaceId}/integrations/keys`, {
        method: 'POST',
        json: { kind: 'ai', provider: 'openai', apiKey: 'sk-proj-good-AbCdEfGhIjKlMnOp' },
      });
      expect(await added.json()).toMatchObject({
        areas: {
          ai: { keys: [{ provider: 'openai', model: 'gpt-5.5', active: true, hint: 'sk-…MnOp' }] },
        },
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

      const [first, second] = requests.filter((request) =>
        request.url.endsWith('/chat/completions'),
      );
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
      expect(JSON.stringify(messages(first!.body)[1]!.content)).toContain(
        'data:image/webp;base64,',
      );
      // Its tool call answered right after it, the slide it looked at as a picture after that.
      const asked = messages(second!.body);
      const call = asked.findIndex((message) => message.role === 'assistant');
      expect(asked[call + 1]).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
      expect(asked[call + 2]!.role).toBe('user');
      expect(JSON.stringify(asked[call + 2]!.content)).toContain('data:image/webp;base64,');
    }
    {
      const first = await setup(false);
      const res = await ask(first.ctx, first.deckId, first.state.slides[0]!.slideId, 'Kürzer');
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: { code: 'ai_not_configured' } });
      expect(first.state.aiAvailable).toBe(false);

      const { ctx: context, anthropic, deckId, state } = await setup();
      expect(state.aiAvailable).toBe(true);
      anthropic.steps = [
        new Anthropic.AuthenticationError(401, undefined, 'invalid x-api-key', new Headers()),
      ];
      await ask(context, deckId, state.slides[0]!.slideId, 'Kürzer');
      const failed = await settled(context, deckId);
      expect(failed).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('abgelehnt'),
      });
      const [row] = await context.deps.db
        .select()
        .from(integrationKeys)
        .where(eq(integrationKeys.workspaceId, context.workspaceId));
      expect(row!.error).toContain('abgelehnt');

      // Opus runs in fast mode when someone waits; out of fast quota, the turn runs at standard
      // speed. A model without effort per turn never gets the message changing it.
      const turn = (model: string) =>
        runTurn(
          context.deps,
          { provider: 'anthropic', apiKey: 'sk-ant-x', baseUrl: null, model },
          {
            system: 's',
            tools: [],
            messages: [{ role: 'user', content: 'Hallo' }, effortMessage('medium')],
            taskBudgetTokens: 20_000,
            fast: true,
            signal: new AbortController().signal,
          },
        );
      anthropic.requests = [];
      anthropic.steps = [
        new Anthropic.RateLimitError(429, undefined, 'fast mode rate limited', new Headers()),
        message([text('Hallo.')], 'end_turn'),
      ];
      expect((await turn('claude-opus-5-5')).stop).toBe('end_turn');
      expect(anthropic.requests.map((request) => request.speed)).toEqual(['fast', undefined]);
      expect(anthropic.requests[0]!.betas).toContain('fast-mode-2026-02-01');
      expect(anthropic.requests[0]!.messages).toHaveLength(2);
      anthropic.requests = [];
      anthropic.steps = [message([text('Hallo.')], 'end_turn')];
      await turn('claude-sonnet-5');
      expect(anthropic.requests[0]!.speed).toBeUndefined();
      expect(anthropic.requests[0]!.messages).toHaveLength(1);
    }
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

    it('merges with what others change meanwhile, keeps both looks of two requests at once and gives what it adds ids of its own', async () => {
      {
        const { ctx, anthropic, deckId, state } = await setup();
        anthropic.steps = [
          writeShown(2, (xml) => xml.replace('>Agenda<', '>Heute<')),
          async () => {
            await handEdit(ctx, deckId, 1, 'Content 2', ['Von Hand']);
            return message([toolUse('read_text', { slides: [2] })], 'tool_use');
          },
          message([text('Titel geändert.')], 'end_turn'),
        ];
        await ask(ctx, deckId, state.slides[1]!.slideId, 'Anderer Titel');
        const done = await settled(ctx, deckId);
        expect(done).toMatchObject({ status: 'applied', error: null, summary: 'Titel geändert.' });
        // Between its turns it heard what was changed meanwhile – at the end of its next input.
        const content2 = state.slides[1]!.elements.find((element) => element.name === 'Content 2')!;
        expect(JSON.stringify(anthropic.requests[1]!.messages)).not.toContain('Meanwhile');
        const heard = anthropic.requests[2]!.messages.findLast((m) => m.role === 'user')!;
        expect(JSON.stringify((heard.content as { type: string }[]).at(-1))).toContain(
          `Meanwhile on the deck`,
        );
        expect(JSON.stringify(heard)).toContain(
          `slide 2, element ${content2.id} (Content 2): text changed (Robert Hofmann)`,
        );
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
      }
      {
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
        expect(done).toMatchObject({
          status: 'applied',
          error: null,
          summary: 'Titel neu gesetzt.',
        });

        const note = JSON.stringify(anthropic.requests[2]!.messages.at(-1));
        expect(note).toContain('While you worked, others changed the deck too');
        expect(note).toContain('Slide 2: Someone changed the same things');
        expect(note).toContain('sl3 (Title 1)');
        expect(note).toContain('>Plan<');

        const now = await editState(ctx, deckId);
        expect(paragraphsOf(now, 1, 'Title 1')).toEqual(['Heute und morgen']);
        expect(paragraphsOf(now, 1, 'Content 2')).toEqual(['Von Hand']);
      }
      {
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
            return message([toolUse('read_text', { slides: [2] })], 'tool_use');
          },
          writeShown(3, restyle, style('#0000ff')),
          message([text('Blau.')], 'end_turn'),
          message([text('Rot.')], 'end_turn'),
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
        // … and the first, in its next turn, what the second did meanwhile.
        expect(JSON.stringify(anthropic.requests[4]!.messages.at(-1))).toContain(
          'slide 3: changed (request „Titel blau“ by Robert Hofmann)',
        );

        // The second went in first with its name; the first's style got a name of its own.
        const content = await contentXml(ctx, deckId);
        // (pr4, an automatic parent LibreOffice would ignore, taken into each.)
        const stored = (name: string) =>
          new RegExp(`<style:style style:name="${name}" [^>]*>.*?</style:style>`).exec(
            content,
          )?.[0];
        expect(stored('aiBig')).toContain('draw:fill-color="#0000ff"');
        expect(stored('aiBig-2')).toContain('draw:fill-color="#ff0000"');
        expect(stored('aiBig-2')).not.toContain('"pr4"');
        const pages = content.match(/<draw:page .*?<\/draw:page>/g)!;
        expect(pages[1]).toContain('presentation:style-name="aiBig-2"');
        expect(pages[2]).toContain('presentation:style-name="aiBig"');
      }
      {
        const { ctx, anthropic, deckId, state } = await setup();
        anthropic.steps = [
          message([toolUse('insert_slide', { after: 2, copy_of: 2 })], 'tool_use'),
          message([text('Kopiert.')], 'end_turn'),
        ];
        await ask(ctx, deckId, state.slides[1]!.slideId, 'Kopie');
        const done = await settled(ctx, deckId);
        expect(done.status).toBe('applied');
        const pages = (await contentXml(ctx, deckId)).match(/<draw:page .*?<\/draw:page>/g)!;
        expect(pages[2]).toMatch(new RegExp(`xml:id="ai${done.id.slice(0, 8)}-[0-9a-f]{12}"`));
        expect(pages[2]).not.toMatch(/xml:id="sl\d+"/);
      }
    });
  });
});
