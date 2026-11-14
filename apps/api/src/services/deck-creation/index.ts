import type Anthropic from '@anthropic-ai/sdk';
import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  DECK_KINDS,
  MAX_CREATED_SLIDES,
  MIN_CREATED_SLIDES,
  outlineSlideSchema,
  type DeckCreation,
  type OutlineSlide,
  type StartDeckCreationInput,
  type Viewer,
} from '@slider/shared';
import {
  deckCreations,
  deckMaterials,
  decks,
  slideVersions,
  workspaceMasters,
  type DeckCreationRow,
} from '../../db/schema';
import type { Executor } from '../../db/client';
import type { AppDeps } from '../../deps';
import { ApiError, badRequest } from '../../http/errors';
import { requireDeckAccess } from '../../auth/access';
import { editFile, editTarget, openFile, type EditTarget } from '../edits';
import { currentRevision } from '../edits/target';
import {
  DeckCopy,
  GENERATE_SYSTEM,
  GENERATE_TOOLS,
  Remarks,
  STOCK_SYSTEM,
  STOCK_TOOLS,
  TOOLS,
  UNREADABLE_CALL,
  callGroups,
  runTool,
  stepOf,
  writeChanges,
} from '../ai-proposals';
import {
  effortMessage,
  failureMessage,
  isProviderError,
  keyProblem,
  refusesKey,
  runTurn,
  type AiConnection,
} from '../ai-providers';
import { aiConnectionFor, markKeyRefused, workspaceImageConnection } from '../integration-keys';
import { MATERIAL_TOOLS } from '../material-tools';
import { materialsBrief } from '../ai-context';
import { photoSource } from '../stock-photos';
import { deckBytesFromMaster } from '../workspace-masters';
import { touchDeck } from '../decks';
import { kindBrief } from './kinds';

/** How many slides the outline gets: as asked, or („KI wählt“) as many as the content needs. */
const slidesWanted = (input: StartDeckCreationInput) =>
  input.pages
    ? `${input.pages} slides`
    : `as many slides as the content needs (${MIN_CREATED_SLIDES}–${MAX_CREATED_SLIDES})`;

/** The slide count for the brief. */
const slidesBrief = (input: StartDeckCreationInput) =>
  input.pages
    ? `It has ${input.pages} slides (the title slide included).`
    : `Choose how many slides it has, the title slide included: as many as the content and the material need – ${MIN_CREATED_SLIDES} to ${MAX_CREATED_SLIDES}, for this kind usually about ${DECK_KINDS.find((each) => each.id === input.kind)?.pages ?? 10}. Fewer strong slides beat padding.`;

/*
 * A new deck built by the AI from the prompt on Folie 1 (see docs/do-not-break.md, „A new deck is
 * built from the prompt“). The run works like a comment request – the same deck copy,
 * tools and writes (`ai-proposals.ts`) – only longer: it reads the material page through
 * the material tools, writes an outline (shown at once), then builds the slides one after
 * another; each one goes in as a step of the AI when it is done, so the people see the deck grow
 * through the live stream. Stopped, failed or past its limit, the slides built stay.
 */

/** Turns to read the material and write the outline. */
const MAX_OUTLINE_TURNS = 14;
/** Turns per slide: build, look, correct. */
const MAX_SLIDE_TURNS = 8;
/** A whole run at most: 30 slides take long. */
export const CREATION_LIMIT_MS = 45 * 60_000;
/** Tokens the whole run may take (Anthropic's task budget). */
const TASK_BUDGET_TOKENS = 3_000_000;
/** Old tool results go once the conversation grows (each slide's drawings). */
const CLEAR_TOOL_RESULTS = {
  trigger: 120_000,
  keep: 6,
  clearAtLeast: 30_000,
  exclude: ['write_outline'],
};
const EFFORT = 'high' as const;
/** How long it waits for material files still being read, and how often it looks. */
const MATERIAL_WAIT_MS = 3 * 60_000;
const MATERIAL_POLL_MS = 2_000;
const BUILD_EFFORT = 'medium' as const;

/** Tools of a comment request the creation does without: nobody asked in a thread. */
const LEFT_OUT = new Set([
  'list_comments',
  'add_picture',
  'add_variant',
  'tilt_element',
  'add_comment',
  'ask_back',
]);

const OUTLINE_TOOL: Anthropic.Beta.BetaTool = {
  name: 'write_outline',
  description:
    'Saves the outline of the deck – one entry per slide, in order – and shows it to the people at once. Call it once, after reading what you need, before building any slide.',
  input_schema: {
    type: 'object',
    properties: {
      slides: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'The slide’s title as it will stand on it.' },
            message: {
              type: 'string',
              description: 'The one thing the slide says, in a sentence.',
            },
            layout: {
              type: 'string',
              description:
                'What kind of slide, in two or three words („Titelfolie“, „Aufzählung“, „Zahlen und Diagramm“, „Bild und Text“, „Zitat“ …).',
            },
          },
          required: ['title', 'message', 'layout'],
        },
      },
    },
    required: ['slides'],
  },
};

const outlineInput = z.object({ slides: z.array(outlineSlideSchema).min(1).max(40) });

const CREATE_SYSTEM = `You build a new presentation in Slider from what the people asked for on its first slide: a description, the kind of deck, the number of slides – and the material they put on its own page „Material“ beside the slides (never part of the deck). The deck is an OpenDocument presentation (ODP); you work on it with the same tools as when people ask you to change a slide.

How the run goes:
1. Read the material that matters for the deck – list_materials, read_material, read_sheet, search_materials, view_material – and look at the layouts the deck offers (your first message shows them). Ask for several looks in one answer: they run at the same time.
2. Call write_outline with exactly as many slides as asked (or, left to you, as many as the content needs): title, key message and kind of slide for each. It is shown to the people at once.
3. Then you are asked for the slides one after another. Build only the slide asked for, then stop with one short sentence; the next is asked for after that. Each slide is shown to the people as soon as you stop.

Building a slide:
- A new slide: insert_slide after the last slide, with a layout (\`master\`) of the deck whose placeholders fit what goes on it; then fill its placeholders' \`text\` with change_elements (one string per paragraph – a list placeholder makes them its points) and add what more it needs with \`add\` (text boxes, shapes, lines, arrows), lined up with what is there. Delete placeholders you leave empty. change_elements is the quickest way and what it makes is editable as in the editor – use it for all it can say.
- write_slide / edit_slide (XML) only for what change_elements cannot do: tables, charts, pictures, gradients.
- The deck starts with one empty slide. Never write on it: it is removed for you once the first slide is built.
- Figures, names, dates and quotes come from the material exactly as they stand – never invented. Where the material has no figure for something, keep the text general.
- A table or chart for figures from a spreadsheet: build it on the slide (XML table, or shapes) with the exact values.
- Check each drawing: text fits its box, nothing overlaps by accident or leaves the slide, enough contrast. Correct what is off, then stop.

Design – the slides should look made by a good designer:
- Keep to the design brief: the template's palette (else a calm palette of one dark, one light and one accent colour, kept through the whole deck), its fonts and text sizes, grid, guides and margins. New text names a font by its free name (Carlito, Caladea, Liberation Sans, Liberation Serif for Calibri, Cambria, Arial, Times New Roman) – never Microsoft's names.
- One message per slide; title, key point, detail told apart by size, weight and colour. Fewer words rather than smaller text.
- Every element on the grid or lined up with others; equal things the same size with equal gaps; generous white space.
- The slides of the deck look alike: the same layout for the same kind of slide, the same positions for titles.
- Write in the language of the description (if it is empty or unclear, the language of the material).`;

/** What a run does right now, by deck – in this process only. */
const steps = new Map<string, string>();
/** Runs at work here, by deck: stopped through „Abbrechen“. */
const stoppers = new Map<string, AbortController>();

/** Whether a run for the deck is still at work in this process (until it has settled). */
export const creationAtWork = (deckId: string): boolean => stoppers.has(deckId);

// ── Reading ─────────────────────────────────────────────────────────────

/** Slides of the deck's current revision and its edit step, to tell whether it is still blank. */
async function deckState(
  db: Executor,
  deck: Parameters<typeof currentRevision>[1],
): Promise<{ slides: number; seq: number } | null> {
  const revision = await currentRevision(db, deck);
  if (!revision) return null;
  const [row] = await db
    .select({ n: count() })
    .from(slideVersions)
    .where(eq(slideVersions.revisionId, revision.id));
  return { slides: row?.n ?? 0, seq: revision.editSeq };
}

/** The prompt shows: nothing built yet and the deck still its blank start. */
function showsPrompt(row: DeckCreationRow, state: { slides: number; seq: number } | null): boolean {
  const idle =
    row.status === 'offered' ||
    ((row.status === 'failed' || row.status === 'cancelled') && row.built === 0);
  return idle && state !== null && state.slides === 1 && state.seq === row.idleSeq;
}

function toDto(row: DeckCreationRow, prompt: boolean, masterId: string | null): DeckCreation {
  return {
    status: row.status,
    prompt,
    kind: row.kind ?? null,
    pages: row.pages ?? null,
    // Not asked yet: the template the deck is made from (picked in the prompt to begin with).
    templateId: row.templateId ?? masterId,
    outline: row.outline ?? null,
    built: row.built,
    step: row.status === 'running' ? (steps.get(row.deckId) ?? null) : null,
    error: row.error ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function rowOf(db: Executor, deckId: string): Promise<DeckCreationRow | undefined> {
  const [row] = await db.select().from(deckCreations).where(eq(deckCreations.deckId, deckId));
  return row;
}

/** `GET /decks/:id/creation`: for everyone who sees the deck; `null` when none was offered. */
export async function getCreation(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
): Promise<DeckCreation | null> {
  const deck = await requireDeckAccess(deps, viewer, deckId, 'view');
  const row = await rowOf(deps.db, deck.id);
  if (!row) return null;
  return toDto(
    row,
    !deck.isTemplate && showsPrompt(row, await deckState(deps.db, deck)),
    deck.masterId,
  );
}

/** A deck made blank offers the prompt on Folie 1 (`POST /decks/blank`). */
export async function offerCreation(db: Executor, deckId: string): Promise<void> {
  await db.insert(deckCreations).values({ deckId, status: 'offered' }).onConflictDoNothing();
}

// ── Changing ────────────────────────────────────────────────────────────

async function update(
  deps: AppDeps,
  deckId: string,
  values: Partial<DeckCreationRow>,
  onlyRunning = false,
): Promise<boolean> {
  const where = onlyRunning
    ? and(eq(deckCreations.deckId, deckId), eq(deckCreations.status, 'running'))
    : eq(deckCreations.deckId, deckId);
  const rows = await deps.db
    .update(deckCreations)
    .set({ ...values, updatedAt: deps.clock.now() })
    .where(where)
    .returning({ deckId: deckCreations.deckId });
  deps.live?.creationChanged(deckId);
  return rows.length > 0;
}

/** The prompt as it stands – it must still show for anything to start or close it. */
async function openPrompt(deps: AppDeps, target: EditTarget): Promise<DeckCreationRow> {
  const row = await rowOf(deps.db, target.deck.id);
  if (!row || target.deck.isTemplate || !showsPrompt(row, await deckState(deps.db, target.deck))) {
    throw new ApiError(
      409,
      'bad_request',
      row?.status === 'running'
        ? 'Die KI erstellt die Präsentation schon.'
        : 'Die Präsentation ist schon begonnen.',
    );
  }
  return row;
}

/** `POST /decks/:id/creation/dismiss` – „Leer anfangen“: the prompt never shows again. */
export async function dismissCreation(deps: AppDeps, viewer: Viewer, deckId: string) {
  const target = await editTarget(deps, viewer, deckId);
  const row = await rowOf(deps.db, target.deck.id);
  if (!row || row.status === 'running') return;
  await update(deps, target.deck.id, { status: 'dismissed' });
}

/** `POST /decks/:id/creation/cancel` – „Abbrechen“: the slides built stay. */
export async function cancelCreation(deps: AppDeps, viewer: Viewer, deckId: string) {
  const target = await editTarget(deps, viewer, deckId);
  await stopRun(deps, target.deck.id, 'cancelled', null);
}

async function stopRun(
  deps: AppDeps,
  deckId: string,
  status: 'cancelled' | 'failed',
  error: string | null,
) {
  const [deck] = await deps.db.select().from(decks).where(eq(decks.id, deckId));
  const state = deck ? await deckState(deps.db, deck) : null;
  const row = await rowOf(deps.db, deckId);
  await update(
    deps,
    deckId,
    {
      status,
      error,
      // Nothing built: the prompt shows again for the deck as it is now.
      ...(row?.built === 0 && state ? { idleSeq: state.seq } : {}),
    },
    true,
  );
  stoppers.get(deckId)?.abort();
}

/** `POST /decks/:id/creation`: builds the deck from the prompt, in the background. */
export async function startCreation(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  input: StartDeckCreationInput,
): Promise<DeckCreation> {
  const target = await editTarget(deps, viewer, deckId);
  const row = await openPrompt(deps, target);
  const ai = await aiConnectionFor(deps, target.deck.workspaceId, 'create');
  if (ai.connection === null) throw new ApiError(409, 'ai_not_configured', ai.error);
  if (input.templateId !== null) {
    const [template] = await deps.db
      .select({ id: workspaceMasters.id, format: workspaceMasters.format })
      .from(workspaceMasters)
      .where(
        and(
          eq(workspaceMasters.id, input.templateId),
          eq(workspaceMasters.workspaceId, target.deck.workspaceId),
        ),
      );
    if (!template) throw badRequest('Diese Vorlage gibt es nicht (mehr).');
    if (template.format !== 'odp')
      throw badRequest('Aus dieser Vorlage lässt sich noch keine Präsentation erstellen.');
  }
  const [started] = await deps.db
    .update(deckCreations)
    .set({
      status: 'running',
      kind: input.kind,
      pages: input.pages,
      templateId: input.templateId,
      description: input.description,
      outline: null,
      built: 0,
      error: null,
      updatedAt: deps.clock.now(),
    })
    .where(and(eq(deckCreations.deckId, target.deck.id), eq(deckCreations.status, row.status)))
    .returning();
  if (!started) throw new ApiError(409, 'bad_request', 'Die KI erstellt die Präsentation schon.');
  steps.set(target.deck.id, 'Bereitet die Präsentation vor');
  deps.live?.creationChanged(target.deck.id);

  const stopper = new AbortController();
  stoppers.set(target.deck.id, stopper);
  const limit = setTimeout(() => {
    void stopRun(
      deps,
      target.deck.id,
      'failed',
      'Die KI hat zu lange gebraucht. Die fertigen Folien bleiben.',
    ).catch((error: unknown) => deps.log.warn(`Deck creation ${deckId} not timed out`, error));
  }, CREATION_LIMIT_MS);
  limit.unref?.();
  void build(deps, viewer, target, input, ai.connection, ai.keyId, stopper.signal)
    .catch((error: unknown) => deps.log.error(`Deck creation ${deckId} crashed`, error))
    .finally(() => {
      clearTimeout(limit);
      if (stoppers.get(target.deck.id) === stopper) stoppers.delete(target.deck.id);
      steps.delete(target.deck.id);
      deps.live?.creationChanged(target.deck.id);
    });
  return toDto(started, false, target.deck.masterId);
}

// ── The run ─────────────────────────────────────────────────────────────

/** The deck takes the template's look: its file becomes one slide of the template's first layout. */
async function takeTemplate(
  deps: AppDeps,
  viewer: Viewer,
  target: EditTarget,
  templateId: string,
): Promise<void> {
  const bytes = await deckBytesFromMaster(deps, target.deck.workspaceId, templateId);
  await editFile(deps, viewer, target.deck.id, { source: 'ai', operations: [] }, async () => {
    const document = await openFile(bytes);
    document.ensureIds();
    return { bytes: await document.toBytes(), document };
  });
  await deps.db.update(decks).set({ masterId: templateId }).where(eq(decks.id, target.deck.id));
}

/** Whether the run was stopped – here, or through another instance of the API. */
async function stopped(deps: AppDeps, deckId: string, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return true;
  return (await rowOf(deps.db, deckId))?.status !== 'running';
}

async function build(
  deps: AppDeps,
  viewer: Viewer,
  firstTarget: EditTarget,
  input: StartDeckCreationInput,
  connection: AiConnection,
  keyId: string,
  signal: AbortSignal,
): Promise<void> {
  const deckId = firstTarget.deck.id;
  const startedAt = Date.now();
  const say = (step: string) => {
    if (steps.get(deckId) === step) return;
    steps.set(deckId, step);
    deps.live?.creationChanged(deckId);
  };
  let built = 0;
  try {
    let target = firstTarget;
    if (input.templateId && input.templateId !== target.deck.masterId) {
      say('Übernimmt die Vorlage');
      await takeTemplate(deps, viewer, target, input.templateId);
      target = await editTarget(deps, viewer, deckId);
    }
    const prefix = `cr${crypto.randomUUID().slice(0, 6)}-`;
    let deck = await DeckCopy.open(deps, target, [], prefix);
    deck.usageFeature = 'create';
    const usedPhotos = new Set<string>();
    const design = deck.design;
    const blankPage = deck.slides[0]?.pageId ?? null;
    const remarks = new Remarks();
    const stock = (await photoSource(deps, target.deck.workspaceId)) !== null;
    const generate =
      (await workspaceImageConnection(deps, target.deck.workspaceId)).connection !== null;
    const tools = [
      ...TOOLS.filter((tool) => !LEFT_OUT.has(tool.name)),
      ...MATERIAL_TOOLS,
      ...(stock ? STOCK_TOOLS : []),
      ...(generate ? GENERATE_TOOLS : []),
      OUTLINE_TOOL,
    ];
    const system = CREATE_SYSTEM + (stock ? STOCK_SYSTEM : '') + (generate ? GENERATE_SYSTEM : '');
    // Material files still being read: it waits for their text (a while at most).
    for (let waited = 0; waited < MATERIAL_WAIT_MS; waited += MATERIAL_POLL_MS) {
      const [reading] = await deps.db
        .select({ n: count() })
        .from(deckMaterials)
        .where(and(eq(deckMaterials.deckId, deckId), eq(deckMaterials.readState, 'pending')));
      if (!reading?.n) break;
      say('Wartet, bis das Material gelesen ist');
      await new Promise((resolve) => setTimeout(resolve, MATERIAL_POLL_MS));
      if (await stopped(deps, deckId, signal)) return;
    }
    const materials = await materialsBrief(deps, deckId);
    const layouts = await deck.listLayouts();
    const size = deck.base.pageSize();
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `What the deck is to be about, in the words of ${viewer.author.name}:\n${input.description}\n\n${kindBrief(input.kind)}\n\n${slidesBrief(input)} The page is ${size.width} × ${size.height} cm.`,
          },
          { type: 'text', text: `The design brief:\n${deck.brief()}` },
          ...(Array.isArray(layouts) ? layouts : [{ type: 'text' as const, text: layouts }]),
          {
            type: 'text',
            text: target.deck.masterId
              ? 'The deck has taken the chosen template: build every slide from its own master pages (insert_slide with master) – not from other templates.'
              : 'No template was chosen: build the slides on the deck’s own master page, in a calm, consistent look of your own.',
          },
          {
            type: 'text',
            text:
              materials ??
              'The presentation has no material yet: build the deck from the description alone.',
          },
          {
            type: 'text',
            text: `First read what you need, then call write_outline with ${slidesWanted(input)}.`,
          },
        ] as Anthropic.Beta.BetaContentBlockParam[],
      },
    ];
    /** Text for the AI after its last turn – in the last user message when that is one. */
    const tell = (text: string) => {
      const last = messages.at(-1);
      if (last?.role === 'user' && Array.isArray(last.content))
        last.content.push({ type: 'text', text });
      else messages.push({ role: 'user', content: [{ type: 'text', text }] });
    };
    const turn = async () => {
      const message = await runTurn(deps, connection, {
        system,
        tools,
        messages,
        taskBudgetTokens: TASK_BUDGET_TOKENS,
        effort: EFFORT,
        clearToolResults: CLEAR_TOOL_RESULTS,
        feature: 'create',
        signal,
      });
      if (message.stop === 'refusal') throw new Refused();
      messages.push({ role: 'assistant', content: message.content });
      const calls = message.content.filter(
        (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use',
      );
      return { message, calls };
    };
    /** Runs a turn's calls; the outline is handed to `onOutline`. */
    const answer = async (
      message: Awaited<ReturnType<typeof turn>>['message'],
      calls: Anthropic.Beta.BetaToolUseBlock[],
      onOutline: (slides: OutlineSlide[]) => string,
    ) => {
      if (message.stop === 'max_tokens') {
        return calls.map((call) => ({
          type: 'tool_result' as const,
          tool_use_id: call.id,
          is_error: true,
          content:
            'Your output was cut off. Write one slide per call – a table or chart in a write_slide of its own.',
        }));
      }
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const group of callGroups(calls)) {
        if (signal.aborted) return results;
        if (!steps.get(deckId)?.startsWith('Folie')) say(stepOf(group));
        results.push(
          ...(await Promise.all(
            group.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
              if (message.unreadable?.includes(call.id))
                return {
                  type: 'tool_result',
                  tool_use_id: call.id,
                  is_error: true,
                  content: UNREADABLE_CALL,
                };
              if (call.name === 'write_outline') {
                const parsed = outlineInput.safeParse(call.input);
                return parsed.success
                  ? {
                      type: 'tool_result',
                      tool_use_id: call.id,
                      content: onOutline(parsed.data.slides),
                    }
                  : {
                      type: 'tool_result',
                      tool_use_id: call.id,
                      is_error: true,
                      content: `Invalid outline: ${parsed.error.message.slice(0, 600)}`,
                    };
              }
              return runTool(deck, remarks, call);
            }),
          )),
        );
      }
      return results;
    };

    // 1. Read and outline.
    say(materials ? 'Liest das Material' : 'Schreibt die Gliederung');
    let outline: OutlineSlide[] | null = null;
    for (let i = 0; i < MAX_OUTLINE_TURNS && !outline; i += 1) {
      if (await stopped(deps, deckId, signal)) return;
      const { message, calls } = await turn();
      if (calls.length === 0) {
        tell(`Call write_outline now, with ${slidesWanted(input)}.`);
        continue;
      }
      const results = await answer(message, calls, (slides) => {
        if (outline) return 'The outline is written already.';
        if (!input.pages && slides.length < MIN_CREATED_SLIDES)
          return `Too few slides: write the outline again with ${MIN_CREATED_SLIDES} to ${MAX_CREATED_SLIDES}.`;
        outline = slides.slice(0, input.pages ? input.pages + 2 : MAX_CREATED_SLIDES);
        return 'Outline saved and shown to the people.';
      });
      messages.push({ role: 'user', content: results });
    }
    const plan = outline as OutlineSlide[] | null;
    if (!plan) throw new ApiError(500, 'internal', 'Die KI hat keine Gliederung geschrieben.');
    // „KI wählt“: its outline says how many.
    if (!(await update(deps, deckId, { outline: plan, pages: input.pages ?? plan.length }, true)))
      return;
    deps.log.info(
      `Deck creation ${deckId.slice(0, 8)}: outline of ${plan.length} slides in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`,
    );
    const ask = (index: number) => {
      if (usedPhotos.size)
        tell(
          `Photos already used on earlier slides: ${[...usedPhotos].join(', ')}. Choose a different photo for this slide; reuse only when the content deliberately refers back to that same image.`,
        );
      const slide = plan[index]!;
      tell(
        `Build slide ${index + 1} of ${plan.length}: „${slide.title}“ (${slide.layout}) – ${slide.message}\nThe deck's slides now:\n${deck.outline()}${index === 0 ? '\n(The empty start slide is removed for you once this slide is built – add the new one after it.)' : ''}`,
      );
    };
    // The first slide asked with the outline's result; from now on it thinks less hard.
    ask(0);
    messages.push(effortMessage(BUILD_EFFORT));

    // 2. Slide after slide, each written as a step of its own.
    for (const index of plan.keys()) {
      if (await stopped(deps, deckId, signal)) return;
      say(`Folie ${index + 1} von ${plan.length}`);
      if (index > 0) ask(index);
      for (let i = 0; i < MAX_SLIDE_TURNS; i += 1) {
        if (await stopped(deps, deckId, signal)) return;
        const { message, calls } = await turn();
        if (calls.length === 0) break;
        const results = await answer(message, calls, () => 'The outline is written already.');
        messages.push({ role: 'user', content: results });
      }
      if (await stopped(deps, deckId, signal)) return;
      // The empty start slide goes with the first slide built – unless the AI wrote on it.
      if (blankPage && index === 0) {
        const at = deck.slides.findIndex((each) => each.pageId === blankPage);
        const used = deck.changes().some((change) => change.pageId === blankPage);
        if (at !== -1 && !used && deck.slides.length > 1) await deck.remove(at + 1);
      }
      await deck.creditPhoto();
      const changes = deck.changes();
      for (const change of changes) if (change.stock) usedPhotos.add(change.stock.chosenId);
      if (changes.length > 0) {
        await writeChanges(deps, viewer, deckId, changes, 'apply');
        await touchDeck(deps.db, deckId, deps.clock.now());
      }
      built = index + 1;
      if (!(await update(deps, deckId, { built }, true))) return;
      target = await editTarget(deps, viewer, deckId);
      deck = await DeckCopy.open(deps, target, [], prefix, design);
      deck.usageFeature = 'create';
    }
    await update(deps, deckId, { status: 'done', error: null }, true);
    deps.log.info(
      `Deck creation ${deckId.slice(0, 8)}: ${built} slides done in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`,
    );
  } catch (error) {
    if (signal.aborted) return;
    let problem: string;
    if (error instanceof Refused) problem = 'Die KI hat diesen Auftrag abgelehnt.';
    else if (error instanceof ApiError && !isProviderError(error)) problem = error.message;
    else {
      const key = keyProblem(error, connection);
      if (key && refusesKey(error)) await markKeyRefused(deps, keyId, key);
      else if (!isProviderError(error)) deps.log.warn(`Deck creation ${deckId} failed`, error);
      problem = key ?? failureMessage(error, connection);
    }
    await stopRun(
      deps,
      deckId,
      'failed',
      built > 0 ? `${problem} Die fertigen Folien bleiben.` : problem,
    );
  }
}

/** The model refused the request. */
class Refused extends Error {}
