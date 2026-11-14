import type Anthropic from '@anthropic-ai/sdk';
import { and, asc, eq, ne } from 'drizzle-orm';
import type {
  AskMaterialInput,
  MaterialAnswerEvent,
  MaterialQuestion,
  Viewer,
} from '@slider/shared';
import { deckAccess, requireDeckAccess } from '../auth/access';
import {
  deckBoardItems,
  materialQuestions,
  type DeckRow,
  type MaterialQuestionRow,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, forbidden, notFound } from '../http/errors';
import { materialsBrief } from './ai-context';
import { failureMessage, keyProblem, refusesKey, runTurn, type AiConnection } from './ai-providers';
import { markKeyRefused, workspaceAiConnection } from './integration-keys';
import { MATERIAL_TOOLS, materialsOf, runMaterialTool } from './material-tools';

/*
 * „Fragen“ on the material page (`material-questions.ts` in shared): a note on the board handed
 * to the AI with ⌘↵ – its text the question – answered by the workspace's AI from the deck's
 * material alone: it reads the files with the material tools, as for a request in a comment,
 * and cites where each part comes from. The answer streams to the asker while it is written,
 * then it is kept under the note – for everyone who sees the board, told live (`material`).
 */

type Message = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

/** Turns of reading before it must answer. */
const MAX_TURNS = 14;
/** Tokens one answer may take, reading included. */
const TASK_BUDGET_TOKENS = 300_000;
/** Questions one person may have answered at once. */
const MAX_RUNNING_PER_USER = 3;

const SYSTEM = `You answer questions about the material of a presentation in Slider: the files, notes and links people collected on its own page „Material“ beside the slides (research, reports, spreadsheets, pictures, earlier presentations). Someone wrote a note on that board and handed it to you: its text is the question, and your answer stands right under the note, for everyone working on the presentation.

How to answer:
- Answer from the material only. Read what the question needs with the tools – search_materials to find places, read_material for the text around them (page by page), read_sheet for exact cells, view_material for charts, pictures or layouts – before you answer. Do not answer from general knowledge; where the material does not say, tell so plainly in one sentence and, if it helps, what it does hold.
- Figures, names, dates and quotes exactly as the material has them – never estimated or rounded unless asked. Where files contradict each other, say so and which says what.
- Cite every statement taken from a file right after it: [[<file id>#<page>]] with the page (or part of a spreadsheet or text file) you read it on, or [[<file id>]] when no page applies – the ids are the ones the tools name. Several sources: [[id#3]][[id2#1]]. Cite only files you read in this conversation; notes and links people put on the board are named in words (a link as a Markdown link).
- Write in the language of the question (usually German), plainly and to the point: start with the answer itself, no preamble, no repeating the question, no closing offers. Short paragraphs; lists where there are several points; **bold** for the key figures. No tables – a list instead. Headings (##) only for long answers with several parts.
- Do not say what you are about to do before calling tools – just call them, then write the answer.
- A note beside a file or round several things asks about those first: the message names them.
- The note may be an instruction rather than a question („Fasse zusammen …“): do it, from the material.
- Under the note people reply, as in a comment's thread – each reply named with who wrote it. When the last message is a reply, answer that reply with the note and the thread so far in mind: a follow-up builds on your earlier answers instead of repeating them.`;

/** Answers being written, by question id: stopped when their asker goes. */
const running = new Map<string, { userId: string; controller: AbortController }>();

export const toQuestionDto = (row: MaterialQuestionRow): MaterialQuestion => ({
  id: row.id,
  deckId: row.deckId,
  noteId: row.noteId,
  kind: row.kind,
  author: row.author ?? null,
  question: row.question,
  answer: row.answer,
  state: row.state,
  error: row.error,
  createdAt: row.createdAt.toISOString(),
});

/** The threads under a deck's notes, oldest first – everyone's, like the notes. */
export async function listMaterialQuestions(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
): Promise<MaterialQuestion[]> {
  await requireDeckAccess(deps, viewer, deckId, 'view');
  const rows = await deps.db
    .select()
    .from(materialQuestions)
    .where(eq(materialQuestions.deckId, deckId))
    .orderBy(asc(materialQuestions.createdAt), asc(materialQuestions.id));
  return rows.map(toQuestionDto);
}

/**
 * „Antwort löschen“ under a note – by whoever may ask: the AI's answer goes (a reply stays,
 * not asked any more; the note asked goes with it); `part` `all`: a reply with its answer, by
 * whoever wrote it, as a comment's reply. An answer being written stops. `false` when there is
 * none under that id.
 */
export async function deleteMaterialQuestion(
  deps: AppDeps,
  viewer: Viewer,
  questionId: string,
  part: 'answer' | 'all' = 'answer',
): Promise<boolean> {
  const [row] = await deps.db
    .select({
      deckId: materialQuestions.deckId,
      kind: materialQuestions.kind,
      userId: materialQuestions.userId,
    })
    .from(materialQuestions)
    .where(eq(materialQuestions.id, questionId));
  if (!row) return false;
  const { permissions } = await deckAccess(deps, viewer, row.deckId, 'view');
  if (!permissions.canComment) throw forbidden(VIEWER_REFUSAL);
  if (part === 'all' && row.kind === 'reply' && row.userId !== viewer.author.id)
    throw forbidden('Nur wer die Antwort geschrieben hat, kann sie löschen.');
  running.get(questionId)?.controller.abort();
  const gone =
    row.kind === 'reply' && part === 'answer'
      ? await deps.db
          .update(materialQuestions)
          .set({ answer: '', state: null, error: null, updatedAt: deps.clock.now() })
          .where(eq(materialQuestions.id, questionId))
          .returning({ id: materialQuestions.id })
      : await deps.db
          .delete(materialQuestions)
          .where(eq(materialQuestions.id, questionId))
          .returning({ id: materialQuestions.id });
  if (gone.length > 0) deps.live?.boardChanged(row.deckId);
  return gone.length > 0;
}

const VIEWER_REFUSAL =
  'Als Betrachter kannst du nur ansehen. Für Fragen an das Material braucht es eine andere Rolle im Workspace.';

/** What an answer runs with, checked before it starts streaming. */
export interface MaterialAsk {
  deck: DeckRow;
  /** `null`: a reply the AI is not asked about – kept, nothing to write. */
  ai: { connection: AiConnection; keyId: string } | null;
  row: MaterialQuestionRow;
  /** Its place among the person's answers being written, taken when it was asked. */
  controller: AbortController;
}

/**
 * Checks a question can be answered – the deck commented on (like every AI request: not for
 * Betrachter), a key for the AI, not too many at once – and keeps it as `answering` (a reply not
 * asked about only needs the comment rights). Throws (a status the page shows) when it cannot.
 * Its place among the running ones is taken here, before anything is awaited after the count, so
 * questions sent at once cannot all slip past it.
 */
export async function startMaterialQuestion(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  input: AskMaterialInput,
): Promise<MaterialAsk> {
  const { deck, permissions } = await deckAccess(deps, viewer, deckId, 'view');
  if (!permissions.canComment) throw forbidden(VIEWER_REFUSAL);
  const [note] = await deps.db
    .select({ kind: deckBoardItems.kind })
    .from(deckBoardItems)
    .where(and(eq(deckBoardItems.id, input.noteId), eq(deckBoardItems.deckId, deckId)));
  if (!note || (note.kind !== 'note' && note.kind !== 'box' && note.kind !== 'question'))
    throw notFound('Diese Notiz gibt es nicht (mehr).');
  const thread = await deps.db
    .select()
    .from(materialQuestions)
    .where(eq(materialQuestions.noteId, input.noteId))
    .orderBy(asc(materialQuestions.createdAt), asc(materialQuestions.id));
  // „Nochmal fragen“ writes an entry again in its place – as it was: a reply stays its writer's.
  const replaced = input.replaces ? thread.find((each) => each.id === input.replaces) : undefined;
  if (input.replaces && !replaced) throw notFound('Diese Antwort gibt es nicht (mehr).');
  // Asked from the note itself, its earlier answer goes and the new one takes its place, first.
  const earlier =
    replaced ?? (input.kind === 'note' ? thread.find((each) => each.kind === 'note') : undefined);
  const kind = replaced?.kind ?? input.kind;
  const asking = input.ask || kind === 'note';
  let ai: MaterialAsk['ai'] = null;
  if (asking) {
    const found = await workspaceAiConnection(deps, deck.workspaceId);
    if (!found.connection) throw new ApiError(409, 'ai_not_configured', found.error);
    ai = {
      connection: { ...found.connection, meter: meterAs(found.connection) },
      keyId: found.keyId,
    };
  }
  const mine = [...running.values()].filter((each) => each.userId === viewer.author.id);
  if (asking && mine.length >= MAX_RUNNING_PER_USER)
    throw new ApiError(429, 'rate_limited', 'Warte, bis die anderen Antworten fertig sind.');
  if (running.has(input.id)) throw badRequest('Diese Frage gibt es schon.');
  const controller = new AbortController();
  if (asking) running.set(input.id, { userId: viewer.author.id, controller });
  try {
    const now = deps.clock.now();
    const first = thread[0]?.createdAt;
    const createdAt =
      earlier?.createdAt ?? (kind === 'note' && first ? new Date(first.getTime() - 1) : now);
    const row = await deps.db.transaction(async (tx) => {
      if (earlier) {
        await tx.delete(materialQuestions).where(eq(materialQuestions.id, earlier.id));
        running.get(earlier.id)?.controller.abort();
      }
      const [inserted] = await tx
        .insert(materialQuestions)
        .values({
          id: input.id,
          deckId,
          noteId: input.noteId,
          userId: replaced?.userId ?? viewer.author.id,
          kind,
          author: kind === 'reply' ? (replaced?.author ?? viewer.author) : null,
          question: input.question,
          answer: '',
          state: asking ? 'answering' : null,
          createdAt,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      return inserted;
    });
    if (!row) throw badRequest('Diese Frage gibt es schon.');
    deps.live?.boardChanged(deckId);
    return { deck, ai, row, controller };
  } catch (error) {
    running.delete(input.id);
    throw error;
  }
}

/** The connection's usage written down as a question about material. */
const meterAs = (connection: AiConnection): AiConnection['meter'] => {
  const { meter } = connection;
  return meter && ((report) => meter({ ...report, feature: 'material' }));
};

/** Stops one's own answer being written; `false` when none runs under that id. */
export function stopMaterialQuestion(viewer: Viewer, questionId: string): boolean {
  const run = running.get(questionId);
  if (!run || run.userId !== viewer.author.id) return false;
  run.controller.abort();
  return true;
}

/**
 * Writes the answer, telling `send` its words as they come and what the AI reads; kept when it
 * ends – done, failed or stopped (`signal`: the asker went, or „Stoppen“).
 */
export async function answerMaterialQuestion(
  deps: AppDeps,
  ask: MaterialAsk,
  send: (event: MaterialAnswerEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const { deck, ai, row, controller } = ask;
  // A reply not asked about: kept already.
  if (!ai) return send({ type: 'done', question: toQuestionDto(row) });
  const { connection } = ai;
  const stop = () => controller.abort();
  signal.addEventListener('abort', stop, { once: true });
  let answer = '';
  let state: MaterialQuestion['state'] = 'done';
  let error: string | null = null;
  try {
    const messages = await conversation(deps, ask);
    const names = new Map((await materialsOf(deps, deck.id)).map((each) => [each.id, each.name]));
    for (let turn = 0; ; turn += 1) {
      // What this turn wrote so far, streamed; the answer before it.
      let streamed = '';
      const before = answer;
      const separate = () => (before.trim() ? '\n\n' : '');
      const result = await runTurn(deps, connection, {
        system: `${SYSTEM}\n\nThe presentation: „${deck.title}“. Today is ${deps.clock.now().toISOString().slice(0, 10)}.`,
        // The last turn may only answer.
        tools: turn < MAX_TURNS - 1 ? MATERIAL_TOOLS : [],
        messages,
        taskBudgetTokens: TASK_BUDGET_TOKENS,
        effort: 'medium',
        feature: 'material',
        fast: true,
        signal: controller.signal,
        clearToolResults: { trigger: 120_000, keep: 6, clearAtLeast: 30_000, exclude: [] },
        onText: (text) => {
          // Text after an earlier turn's reading is its own paragraph.
          if (!streamed && separate()) send({ type: 'text', text: separate() });
          streamed += text;
          send({ type: 'text', text });
        },
      });
      // Kept as the turn's message says (a retry may have streamed some twice); what did not
      // stream (no stream events, a fallback) is sent now. The answer as kept comes with `done`.
      const written = result.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
      if (written.trim()) {
        if (!streamed) send({ type: 'text', text: separate() + written });
        else if (written.startsWith(streamed) && written.length > streamed.length)
          send({ type: 'text', text: written.slice(streamed.length) });
        answer = before + separate() + written;
      }
      messages.push({ role: 'assistant', content: result.content });
      if (result.stop === 'refusal') {
        state = 'failed';
        error = 'Die KI hat diese Frage nicht beantwortet.';
        break;
      }
      if (result.stop !== 'tool_use') break;
      const results: ToolResult[] = [];
      for (const block of result.content) {
        if (block.type !== 'tool_use') continue;
        if (result.unreadable?.includes(block.id)) {
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: 'Your input was not readable JSON – send the call again.',
            is_error: true,
          });
          continue;
        }
        send({ type: 'reading', label: readingLabel(block.name, block.input, names) });
        const ran = await runMaterialTool(deps, deck.id, block.name, block.input);
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: ran?.content ?? `No tool "${block.name}".`,
          is_error: ran ? ran.isError : true,
        });
      }
      messages.push({ role: 'user', content: results });
    }
    if (state === 'done' && !answer.trim()) {
      state = 'failed';
      error = 'Die KI hat keine Antwort geschrieben. Bitte nochmal fragen.';
    }
  } catch (caught) {
    if (controller.signal.aborted) state = 'stopped';
    else {
      state = 'failed';
      error = failureMessage(caught, connection);
      const problem = keyProblem(caught, connection);
      if (problem && refusesKey(caught)) await markKeyRefused(deps, ai.keyId, problem);
      if (!(caught instanceof ApiError) && !problem)
        deps.log.warn(`Material question failed: ${String(caught)}`);
    }
  } finally {
    running.delete(row.id);
    signal.removeEventListener('abort', stop);
  }
  const [kept] = await deps.db
    .update(materialQuestions)
    .set({ answer, state, error, updatedAt: deps.clock.now() })
    .where(eq(materialQuestions.id, row.id))
    .returning();
  // Deleted meanwhile (the note, „Antwort löschen“, asked anew): nothing to keep.
  if (!kept) return;
  deps.live?.boardChanged(deck.id);
  if (error) send({ type: 'error', message: error });
  send({ type: 'done', question: toQuestionDto(kept) });
}

/**
 * The board, what the note is on (a file beside it, things round it), the note's text, then its
 * thread so far – the replies (who wrote them) and the AI's answers – up to the entry answered.
 */
async function conversation(deps: AppDeps, ask: MaterialAsk): Promise<Message[]> {
  const { row } = ask;
  const [brief, [note], names, thread] = await Promise.all([
    materialsBrief(deps, ask.deck.id),
    deps.db
      .select({
        boundIds: deckBoardItems.boundIds,
        text: deckBoardItems.text,
        author: deckBoardItems.author,
      })
      .from(deckBoardItems)
      .where(eq(deckBoardItems.id, row.noteId)),
    boardNames(deps, ask.deck.id),
    deps.db
      .select()
      .from(materialQuestions)
      .where(and(eq(materialQuestions.noteId, row.noteId), ne(materialQuestions.id, row.id)))
      .orderBy(asc(materialQuestions.createdAt), asc(materialQuestions.id)),
  ]);
  const on = (note?.boundIds ?? []).flatMap((id) => {
    const name = names.get(id);
    return name ? [`„${name}“ (${id})`] : [];
  });
  const before = thread.filter((each) => each.createdAt <= row.createdAt);
  // The note as asked (the note asked now: as typed), else as it is.
  const asked = row.kind === 'note' ? row : before.find((each) => each.kind === 'note');
  const noteText = asked?.question ?? note?.text ?? '';
  const messages: Message[] = [];
  const say = (role: 'user' | 'assistant', text: string) => {
    const last = messages.at(-1);
    if (last?.role === role && Array.isArray(last.content))
      last.content.push({ type: 'text', text });
    else messages.push({ role, content: [{ type: 'text', text }] });
  };
  say('user', brief ?? "The deck's board is empty – there is no material yet.");
  if (on.length > 0) say('user', `The note is on: ${on.join(', ')}.`);
  say(
    'user',
    before.length > 0 || row.kind === 'reply'
      ? `The note${note ? ` by ${note.author.name}` : ''}: ${noteText}`
      : noteText,
  );
  const reply = (each: MaterialQuestionRow) =>
    `Reply by ${each.author?.name ?? 'someone'}: ${each.question}`;
  for (const each of before) {
    if (each.kind === 'reply') say('user', reply(each));
    if (each.answer.trim()) say('assistant', each.answer);
  }
  if (row.kind === 'reply') say('user', reply(row));
  // Ends with the people: an answer last (asked again from the note) asks for the note's anew.
  if (messages.at(-1)?.role === 'assistant') say('user', noteText);
  return messages;
}

/** The names of a deck's files, links and folders by id – what a note can be on. */
async function boardNames(deps: AppDeps, deckId: string): Promise<Map<string, string>> {
  const [files, items] = await Promise.all([
    materialsOf(deps, deckId),
    deps.db
      .select({ id: deckBoardItems.id, text: deckBoardItems.text, kind: deckBoardItems.kind })
      .from(deckBoardItems)
      .where(eq(deckBoardItems.deckId, deckId)),
  ]);
  return new Map([
    ...files.map((each) => [each.id, each.name] as const),
    ...items
      .filter((each) => each.kind === 'link' || each.kind === 'folder')
      .map((each) => [each.id, each.text.slice(0, 120)] as const),
  ]);
}

/** What the AI looks at, for the asker: „Liest „Bericht.pdf“, Seiten 3–5“. */
export function readingLabel(
  tool: string,
  input: unknown,
  names: ReadonlyMap<string, string>,
): string {
  const given = (input ?? {}) as Record<string, unknown>;
  const material = typeof given.material === 'string' ? given.material : '';
  const name = `„${names.get(material) ?? material}“`;
  const from = typeof given.from === 'number' ? given.from : null;
  const to = typeof given.to === 'number' ? given.to : null;
  const page = typeof given.page === 'number' ? given.page : null;
  switch (tool) {
    case 'list_materials':
      return 'Sieht das Material durch';
    case 'search_materials':
      return `Sucht „${typeof given.query === 'string' ? given.query : ''}“`;
    case 'read_material':
      return from && to && to > from
        ? `Liest ${name}, Seiten ${from}–${to}`
        : from
          ? `Liest ${name} ab Seite ${from}`
          : `Liest ${name}`;
    case 'read_sheet':
      return `Liest die Tabelle ${name}`;
    case 'view_material':
      return page ? `Sieht sich ${name} an, Seite ${page}` : `Sieht sich ${name} an`;
    default:
      return 'Liest im Material';
  }
}
