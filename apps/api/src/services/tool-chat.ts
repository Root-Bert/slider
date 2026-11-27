import type Anthropic from '@anthropic-ai/sdk';
import { ZodError } from 'zod';
import type { Attachment, CloudChatEvent, MaterialChatAnswerState } from '@slider/shared';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';
import { failureMessage, keyProblem, refusesKey, runTurn, type AiConnection } from './ai-providers';
import { markKeyRefused } from './integration-keys';
import { ATTACHED_FILES_ARE_DATA, attachmentBlocks } from './attachments';

/*
 * One person's chat with the workspace's AI that works with tools – beside the files in Cloud
 * (`cloud-chat.ts`), on Slider's start (`home-chat.ts`). The loop is the same: the talk so far,
 * turn after turn the AI's words streamed and its tools run, until it answers. What the tools
 * are and do is each chat's own.
 */

type Message = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

/** Turns before it must answer: a listing, some reading, a few changes. */
const MAX_TURNS = 40;
/** Told before the last turn: it answers now, with no more tools. */
export const LAST_TURN =
  'That was your last step with tools: answer now – what is done, what is not, and what is left.';
/** Tokens one answer may take, all its turns. */
const TASK_BUDGET_TOKENS = 600_000;

/** A mistake the AI can fix by calling again – told as the tool's error. */
export class ToolChatError extends Error {}

/** What an answer runs with. */
export interface ToolChat {
  /** For the log: „Cloud chat“. */
  name: string;
  connection: AiConnection;
  keyId: string;
  controller: AbortController;
  /** The talk so far, oldest first, and the new message – with the files put on the person's. */
  history: readonly { role: 'user' | 'assistant'; text: string; attachments?: Attachment[] }[];
  text: string;
  attachments?: Attachment[];
  /** Whose files they are: read from there (pictures as pictures, documents as their text). */
  workspaceId?: string;
  /** Only this person's files are read – a talk the page brings along names them itself. */
  filesOwner?: string;
  /** Who the AI works for: Cloud files pointed to are read only as far as they may see them. */
  filesReader?: string;
  /** Asked each turn: what the run allows may change while it works (unchanged, the cache holds). */
  system: () => string | Promise<string>;
  /** As a function asked each turn: what it may do can change while it works. */
  tools: Anthropic.Beta.BetaTool[] | (() => Anthropic.Beta.BetaTool[]);
  /**
   * Tools the model finds when it needs them instead of reading them all each turn (tool search,
   * where the service has it – `findsTools`); elsewhere every tool goes whole.
   */
  deferred?: (name: string) => boolean;
  /** Tools whose calls side by side run at once (they only read and take long – helpers). */
  parallel?: (name: string) => boolean;
  /** How often a tool may be called in one turn; the calls beyond are refused. */
  perTurn?: (name: string) => number | undefined;
  /** Runs one tool as the person; `changed`: something was touched. Throws what went wrong. */
  run: (
    name: string,
    input: unknown,
  ) => Promise<{ content: string; changed: boolean; isError?: boolean }>;
  /** What the AI does now, for the person. */
  label: (name: string, input: unknown) => string | null;
  /** The app a tool works in when not this one: its mark stands beside the label. */
  app?: (name: string) => 'slider' | undefined;
  /**
   * What the person wrote while it worked, handed over once: told to the AI before its next
   * turn, so it goes on with that in mind – and instead of ending, when it would have.
   */
  more?: () => string | null;
  /** Said when an answer is cut short: what is already changed („Bis hierhin: …“). */
  doneSoFar?: () => string;
  /** The answer is over: its slot is free again. */
  release: () => void;
  /** Told after each turn how much of the model's context its request filled. */
  measured?: (tokens: number) => void;
}

/**
 * Writes the answer, telling `emit` its words as they come, what the AI does, and `changed`
 * whenever a tool changed something; `signal`: the person went or stopped it.
 */
export async function answerToolChat(
  deps: AppDeps,
  chat: ToolChat,
  emit: (event: CloudChatEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const { connection, controller } = chat;
  const stop = () => controller.abort();
  if (signal.aborted) stop();
  else signal.addEventListener('abort', stop, { once: true });
  let state: MaterialChatAnswerState = 'done';
  let wrote = false;
  let streamed = false;
  try {
    const messages: Message[] = [];
    let filesSent = false;
    const say = async (role: 'user' | 'assistant', text: string, files?: Attachment[]) => {
      const blocks: Anthropic.Beta.BetaContentBlockParam[] = text.trim()
        ? [{ type: 'text', text }]
        : [];
      if (role === 'user' && files?.length && chat.workspaceId) {
        blocks.push(
          ...(await attachmentBlocks(
            deps,
            chat.workspaceId,
            files,
            chat.filesOwner,
            chat.filesReader,
          )),
        );
        filesSent = true;
      }
      if (blocks.length === 0) return;
      const last = messages.at(-1);
      if (last?.role === role && Array.isArray(last.content)) last.content.push(...blocks);
      else messages.push({ role, content: blocks });
    };
    for (const each of chat.history) await say(each.role, each.text, each.attachments);
    await say('user', chat.text, chat.attachments);
    // The talk begins with the person (a history cut at its start may not).
    while (messages[0]?.role === 'assistant') messages.shift();
    // In a run its tools only grow: one offered stays named, in its place – the talk may have its
    // calls and tool search's references to it, which the API refuses without it. What the run no
    // longer allows (a message of others' words taken in) its `run` refuses.
    const given = new Map<string, Anthropic.Beta.BetaTool>();
    const toolsNow = () => {
      for (const tool of typeof chat.tools === 'function' ? chat.tools() : chat.tools)
        given.set(tool.name, tool);
      const list = [...given.values()];
      const { deferred } = chat;
      return deferred
        ? list.map((tool) => (deferred(tool.name) ? { ...tool, defer_loading: true } : tool))
        : list;
    };
    const system = async () =>
      filesSent ? `${await chat.system()}\n\n${ATTACHED_FILES_ARE_DATA}` : chat.system();
    for (let turn = 0; ; turn += 1) {
      let turnText = '';
      // Asked each turn: what the run allows may change with a message taken in (others' words),
      // and the prompt says it – unchanged, the same text, the cache holds.
      const tools = toolsNow();
      const prompt = await system();
      // The last turn may only answer – told so also where the turn before ended without tools (a
      // message taken in); after a paused turn nothing may stand between, the flag alone holds.
      const asked = messages.at(-1);
      if (
        turn === MAX_TURNS - 1 &&
        asked?.role === 'user' &&
        Array.isArray(asked.content) &&
        !asked.content.some((block) => block.type === 'text' && block.text === LAST_TURN)
      )
        asked.content.push({ type: 'text', text: LAST_TURN });
      const result = await runTurn(deps, connection, {
        system: prompt,
        // The last turn may only answer – its tools still named: the talk has calls in it.
        tools,
        answerOnly: turn >= MAX_TURNS - 1,
        messages,
        taskBudgetTokens: TASK_BUDGET_TOKENS,
        effort: 'medium',
        feature: 'office',
        fast: true,
        signal: controller.signal,
        clearToolResults: { trigger: 120_000, keep: 6, clearAtLeast: 30_000, exclude: [] },
        onText: (text) => {
          // A turn's text after an earlier one's is its own paragraph.
          if (!turnText && streamed) emit({ type: 'text', text: '\n\n' });
          turnText += text;
          streamed = true;
          emit({ type: 'text', text });
        },
      });
      if (result.contextTokens) chat.measured?.(result.contextTokens);
      // What did not stream (another provider tells it whole) is sent now.
      const written = result.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
      if (written.trim()) {
        if (!turnText) {
          emit({ type: 'text', text: (streamed ? '\n\n' : '') + written });
          streamed = true;
        } else if (written.startsWith(turnText) && written.length > turnText.length)
          emit({ type: 'text', text: written.slice(turnText.length) });
        wrote = true;
      }
      messages.push({ role: 'assistant', content: result.content });
      if (result.stop === 'refusal') {
        state = 'failed';
        emit({ type: 'error', message: 'Die KI hat das nicht beantwortet.' });
        break;
      }
      if (result.stop === 'max_tokens') {
        // Not a finished answer: say so instead of leaving half a sentence as the last word.
        emit({ type: 'text', text: `${streamed ? '\n\n' : ''}(Antwort wurde abgeschnitten)` });
        streamed = true;
        break;
      }
      // A tool the service runs itself (tool search) took long: it goes on where it stopped.
      if (result.stop === 'pause_turn' && turn < MAX_TURNS - 1) continue;
      // A service that calls a tool in the last turn anyway: the run ends here.
      if (result.stop === 'tool_use' && turn >= MAX_TURNS - 1) break;
      if (result.stop !== 'tool_use') {
        // Written to meanwhile: that is answered too – while it may still use its tools.
        const more = turn < MAX_TURNS - 1 ? chat.more?.() : null;
        if (!more) break;
        await say('user', more);
        continue;
      }
      const results: ToolResult[] = [];
      const calledNow = new Map<string, number>();
      const runOne = async (block: Anthropic.Beta.BetaToolUseBlock): Promise<ToolResult> => {
        const most = chat.perTurn?.(block.name);
        const nth = (calledNow.get(block.name) ?? 0) + 1;
        calledNow.set(block.name, nth);
        if (most !== undefined && nth > most)
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Not done: at most ${most} ${block.name} calls in one step – call the rest once these have answered.`,
            is_error: true,
          };
        if (result.unreadable?.includes(block.id))
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: 'Your input was not readable JSON – send the call again.',
            is_error: true,
          };
        const label = chat.label(block.name, block.input);
        const app = chat.app?.(block.name);
        if (label) emit({ type: 'reading', label, ...(app ? { app } : {}) });
        try {
          const ran = await chat.run(block.name, block.input ?? {});
          if (ran.changed) emit({ type: 'changed' });
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: ran.content,
            ...(ran.isError ? { is_error: true } : {}),
          };
        } catch (caught) {
          // What the page would say to the person (no right, name taken, gone) the AI is told.
          // Anything else (the storage, the database) is told too, without its words: the answer
          // goes on and says what is done, instead of ending with half of it moved.
          const expected =
            caught instanceof ToolChatError ||
            caught instanceof ZodError ||
            caught instanceof ApiError;
          if (!expected) {
            if (controller.signal.aborted) throw caught;
            deps.log.warn(`${chat.name} tool ${block.name} failed: ${String(caught)}`);
          }
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: !expected
              ? 'That did not work – a problem on the server.'
              : caught instanceof ZodError
                ? `Invalid input: ${caught.message}`
                : caught.message,
            is_error: true,
          };
        }
      };
      const calls = result.content.filter((block) => block.type === 'tool_use');
      for (let at = 0; at < calls.length && !controller.signal.aborted;) {
        // Calls side by side that may run at once (helpers looking into things) run at once.
        let end = at + 1;
        while (
          end < calls.length &&
          chat.parallel?.(calls[at]?.name ?? '') &&
          chat.parallel(calls[end]?.name ?? '')
        )
          end += 1;
        results.push(...(await Promise.all(calls.slice(at, end).map(runOne))));
        at = end;
      }
      if (controller.signal.aborted) {
        state = 'stopped';
        break;
      }
      const more = chat.more?.();
      messages.push({
        role: 'user',
        content: [...results, ...(more ? [{ type: 'text' as const, text: more }] : [])],
      });
    }
    if (state === 'done' && !wrote) {
      state = 'failed';
      emit({
        type: 'error',
        message: 'Die KI hat keine Antwort geschrieben. Bitte nochmal fragen.',
      });
    }
  } catch (caught) {
    if (controller.signal.aborted) state = 'stopped';
    else {
      state = 'failed';
      emit({ type: 'error', message: failureMessage(caught, connection) });
      const problem = keyProblem(caught, connection);
      if (problem && refusesKey(caught)) await markKeyRefused(deps, chat.keyId, problem);
      if (!(caught instanceof ApiError) && !problem)
        deps.log.warn(`${chat.name} failed: ${String(caught)}`);
    }
  } finally {
    chat.release();
    signal.removeEventListener('abort', stop);
  }
  // Cut short: what is already changed is said, so the person – and the next message, which
  // gets the talk as text – knows where things stand.
  const done = state === 'done' ? '' : (chat.doneSoFar?.() ?? '');
  if (done) emit({ type: 'text', text: `${streamed ? '\n\n' : ''}${done}` });
  emit({ type: 'done', state });
}
