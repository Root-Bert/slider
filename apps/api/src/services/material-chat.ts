import type Anthropic from '@anthropic-ai/sdk';
import type { MaterialChatEvent, MaterialChatInput, Viewer } from '@slider/shared';
import { deckAccess } from '../auth/access';
import type { DeckRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, forbidden } from '../http/errors';
import { materialsBrief } from './ai-context';
import { failureMessage, keyProblem, refusesKey, runTurn, type AiConnection } from './ai-providers';
import { markKeyRefused, workspaceAiConnection } from './integration-keys';
import { MATERIAL_TOOLS, materialsOf, runMaterialTool } from './material-tools';
import { readingLabel } from './material-questions';
import { MCP_TOOLS, runMcpTool } from './mcp';

/*
 * The AI on the material page (`material-chat.ts` in shared): one person's chat in a side panel,
 * the way Claude or ChatGPT work with Slider over MCP – the same tools, here without connecting
 * anything. It reads the deck's material (the material tools), searches the web where the
 * workspace's AI is Anthropic's (its own web search), and puts what comes out on the board with
 * the MCP board tools (notes, links, text files – everyone's, told live). The chat itself is
 * kept in the person's tab: the page sends it along each time.
 */

type Message = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

/** Turns before it must answer (reading, searching, writing to the board). */
const MAX_TURNS = 24;
/** Tokens one answer may take, all its turns. */
const TASK_BUDGET_TOKENS = 600_000;
/** Chats one person may have answered at once. */
const MAX_RUNNING_PER_USER = 2;
/** Searches one answer may run. */
const MAX_WEB_SEARCHES = 8;

/** The MCP tools that write to the board – their `presentation` is this deck. */
const BOARD_TOOL_NAMES = ['add_note', 'add_link', 'add_file', 'update_note'] as const;
const BOARD_TOOLS: Anthropic.Beta.BetaTool[] = MCP_TOOLS.filter((tool) =>
  (BOARD_TOOL_NAMES as readonly string[]).includes(tool.name),
).map((tool) => {
  const { presentation: _presentation, ...properties } = tool.inputSchema.properties;
  return {
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: 'object',
      properties,
      required: (tool.inputSchema.required ?? []).filter((each) => each !== 'presentation'),
    },
  };
});
const BOARD_TOOL_SET = new Set<string>(BOARD_TOOL_NAMES);

const WEB_SEARCH: Anthropic.Beta.BetaWebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: MAX_WEB_SEARCHES,
};

const system = (
  deck: DeckRow,
  today: string,
  web: boolean,
) => `You are the AI on the material page of a presentation in Slider: a board beside the slides, called „Material“, where the team collects what the deck is built from – files (PDFs, documents, spreadsheets, pictures, earlier presentations), links and notes (stickers with rich text). One person chats with you in a side panel next to the board, as they would with Claude or ChatGPT; you help them research and prepare the presentation „${deck.title}“. Today is ${today}.

What you can do:
- Read the material with the tools – search_materials to find places, read_material for the text (page by page), read_sheet for exact cells, view_material for charts and pictures. Read what the question needs before you answer from it.
${web ? '- Search the web with web_search for what the material does not hold: facts, figures, sources, current events. Prefer primary and reputable sources.\n' : '- You cannot search the web here; say so plainly when a question needs it, and answer from the material.\n'}- Put results on the board when the person asks for it or asks you to write something („erstelle“, „schreib ein Dokument“, „leg ab“, „sammle“): add_note for a finding, summary or a document written in Markdown (one topic per note, with its sources; up to 10 000 characters), add_link for a web page worth keeping, add_file for a longer text or Markdown document or a table as CSV, update_note to change a note. After putting something on the board, say in one short line what you put there. Do not put things on the board unasked.

How to write:
- Figures, names, dates and quotes exactly as the sources have them. Where sources contradict each other, say so.
- Cite every statement taken from a file of the board right after it: [[<file id>#<page>]], or [[<file id>]] when no page applies – the ids the tools name. Cite web sources as Markdown links. Notes and links on the board are named in words.
- Write in the person's language (usually German), plainly and to the point: start with the answer, no preamble, no closing offers. Short paragraphs, lists for several points, **bold** for key figures. No tables – a list instead.
- Do not announce tool calls – just call them, then write.`;

/** Answers being written, by person: stopped when they close the chat or the tab. */
const running = new Map<AbortController, string>();

const VIEWER_REFUSAL =
  'Als Betrachter kannst du nur ansehen. Für die KI braucht es eine andere Rolle im Workspace.';

/** What an answer runs with, checked before it starts streaming. */
export interface MaterialChat {
  deck: DeckRow;
  viewer: Viewer;
  connection: AiConnection;
  keyId: string;
  controller: AbortController;
  input: MaterialChatInput;
}

/**
 * Checks the chat can be answered – the deck commented on (no AI for Betrachter), a key for the
 * AI, not too many at once – and takes its place among the person's running answers. Throws
 * (a status the page shows) when it cannot.
 */
export async function startMaterialChat(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  input: MaterialChatInput,
): Promise<MaterialChat> {
  const { deck, permissions } = await deckAccess(deps, viewer, deckId, 'view');
  if (!permissions.canComment) throw forbidden(VIEWER_REFUSAL);
  const found = await workspaceAiConnection(deps, deck.workspaceId);
  if (!found.connection) throw new ApiError(409, 'ai_not_configured', found.error);
  const mine = [...running.values()].filter((id) => id === viewer.author.id);
  if (mine.length >= MAX_RUNNING_PER_USER)
    throw new ApiError(429, 'rate_limited', 'Warte, bis die anderen Antworten fertig sind.');
  const controller = new AbortController();
  running.set(controller, viewer.author.id);
  const { meter } = found.connection;
  return {
    deck,
    viewer,
    connection: {
      ...found.connection,
      meter: meter && ((report) => meter({ ...report, feature: 'material' })),
    },
    keyId: found.keyId,
    controller,
    input,
  };
}

/** What the AI does now, for the person: what it reads, searches or puts on the board. */
function doingLabel(
  block: Anthropic.Beta.BetaContentBlock,
  names: ReadonlyMap<string, string>,
): string | null {
  if (block.type === 'server_tool_use' && block.name === 'web_search') {
    const query = (block.input as { query?: unknown }).query;
    return typeof query === 'string' ? `Sucht im Web „${query}“` : 'Sucht im Web';
  }
  if (block.type !== 'tool_use') return null;
  switch (block.name) {
    case 'add_note':
      return 'Legt eine Notiz aufs Board';
    case 'add_link':
      return 'Legt einen Link aufs Board';
    case 'add_file':
      return 'Legt eine Datei aufs Board';
    case 'update_note':
      return 'Ändert eine Notiz';
    default:
      return readingLabel(block.name, block.input, names);
  }
}

/**
 * Writes the answer, telling `send` its words as they come and what the AI does; `signal`: the
 * person went (closed the stream) or stopped it.
 */
export async function answerMaterialChat(
  deps: AppDeps,
  chat: MaterialChat,
  send: (event: MaterialChatEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const { deck, viewer, connection, controller } = chat;
  const stop = () => controller.abort();
  signal.addEventListener('abort', stop, { once: true });
  let state: 'done' | 'failed' | 'stopped' = 'done';
  let wrote = false;
  try {
    const web = connection.provider === 'anthropic' && connection.baseUrl === null;
    const tools = [...MATERIAL_TOOLS, ...BOARD_TOOLS, ...(web ? [WEB_SEARCH] : [])];
    const [brief, files] = await Promise.all([
      materialsBrief(deps, deck.id),
      materialsOf(deps, deck.id),
    ]);
    const names = new Map(files.map((each) => [each.id, each.name]));
    const messages: Message[] = [];
    const say = (role: 'user' | 'assistant', text: string) => {
      const last = messages.at(-1);
      if (last?.role === role && Array.isArray(last.content))
        last.content.push({ type: 'text', text });
      else messages.push({ role, content: [{ type: 'text', text }] });
    };
    say('user', brief ?? "The deck's board is empty – there is no material yet.");
    for (const each of chat.input.messages) if (each.text.trim()) say(each.role, each.text);
    let streamed = false;
    for (let turn = 0; ; turn += 1) {
      let turnText = '';
      const result = await runTurn(deps, connection, {
        system: system(deck, deps.clock.now().toISOString().slice(0, 10), web),
        // The last turn may only answer.
        tools: turn < MAX_TURNS - 1 ? tools : [],
        messages,
        taskBudgetTokens: TASK_BUDGET_TOKENS,
        effort: 'medium',
        feature: 'material',
        fast: true,
        signal: controller.signal,
        clearToolResults: { trigger: 120_000, keep: 6, clearAtLeast: 30_000, exclude: [] },
        onText: (text) => {
          // A turn's text after an earlier one's is its own paragraph.
          if (!turnText && streamed) send({ type: 'text', text: '\n\n' });
          turnText += text;
          streamed = true;
          send({ type: 'text', text });
        },
      });
      // What did not stream (another provider tells it whole) is sent now.
      const written = result.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
      if (written.trim()) {
        if (!turnText) {
          send({ type: 'text', text: (streamed ? '\n\n' : '') + written });
          streamed = true;
        } else if (written.startsWith(turnText) && written.length > turnText.length)
          send({ type: 'text', text: written.slice(turnText.length) });
        wrote = true;
      }
      for (const block of result.content) {
        const label = block.type === 'server_tool_use' ? doingLabel(block, names) : null;
        if (label) send({ type: 'reading', label });
      }
      messages.push({ role: 'assistant', content: result.content });
      if (result.stop === 'refusal') {
        state = 'failed';
        send({ type: 'error', message: 'Die KI hat das nicht beantwortet.' });
        break;
      }
      // Its own web search paused a long turn: sent again as it is, it goes on.
      if (result.stop === 'pause_turn' && turn < MAX_TURNS - 1) continue;
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
        const label = doingLabel(block, names);
        if (label) send({ type: 'reading', label });
        const input = (block.input ?? {}) as Record<string, unknown>;
        if (BOARD_TOOL_SET.has(block.name)) {
          const ran = await runMcpTool(
            deps,
            { viewer, workspaceId: deck.workspaceId },
            block.name,
            {
              ...input,
              presentation: deck.id,
            },
          );
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: ran.content.map((part) =>
              part.type === 'text'
                ? { type: 'text' as const, text: part.text }
                : {
                    type: 'image' as const,
                    source: {
                      type: 'base64' as const,
                      media_type: part.mimeType as 'image/png',
                      data: part.data,
                    },
                  },
            ),
            is_error: ran.isError ?? false,
          });
          continue;
        }
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
    if (state === 'done' && !wrote) {
      state = 'failed';
      send({
        type: 'error',
        message: 'Die KI hat keine Antwort geschrieben. Bitte nochmal fragen.',
      });
    }
  } catch (caught) {
    if (controller.signal.aborted) state = 'stopped';
    else {
      state = 'failed';
      send({ type: 'error', message: failureMessage(caught, connection) });
      const problem = keyProblem(caught, connection);
      if (problem && refusesKey(caught)) await markKeyRefused(deps, chat.keyId, problem);
      if (!(caught instanceof ApiError) && !problem)
        deps.log.warn(`Material chat failed: ${String(caught)}`);
    }
  } finally {
    running.delete(controller);
    signal.removeEventListener('abort', stop);
  }
  send({ type: 'done', state });
}
