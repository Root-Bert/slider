import Anthropic from '@anthropic-ai/sdk';
import { AI_PROVIDER_LABELS, type AiProvider } from '@slider/shared';
import { z } from 'zod';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';
import {
  assertPublicHttpsUrl,
  dnsLookup,
  pinnedToChecked,
  type FetchLike,
} from '../sources/safe-fetch';

/*
 * The AI services a workspace can run its AI on (BER-183): Anthropic through its SDK, with all of
 * its own features; OpenAI, Google Gemini and any service speaking OpenAI's chat API (OpenRouter,
 * Mistral, Azure, a local Ollama, …) through that API. The AI's conversation is kept in
 * Anthropic's shape (`ai-proposals`); for the others it is translated there and back per turn.
 */

/** The key the AI runs on: who, where, which model. */
export interface AiConnection {
  provider: AiProvider;
  apiKey: string;
  /** Only for `custom`: the service's address, up to `/v1` or the like. */
  baseUrl: string | null;
  model: string;
}

/** The model Anthropic keys run on unless an admin picks another. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';

/** Where the OpenAI-compatible services answer. */
const OPENAI_BASE: Partial<Record<AiProvider, string>> = {
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
};

/** One turn of the AI may take this long before it counts as unreachable. */
const TURN_TIMEOUT_MS = 10 * 60_000;
/** Listing models (checking a key) may take this long. */
const LIST_TIMEOUT_MS = 20_000;
/** An answer of the service may be this big – a time limit does not bound how much it sends. */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** The service by name, for messages: „OpenAI“, or the custom service's host. */
export function providerName(connection: Pick<AiConnection, 'provider' | 'baseUrl'>): string {
  if (connection.provider !== 'custom') return AI_PROVIDER_LABELS[connection.provider];
  try {
    return new URL(connection.baseUrl ?? '').host || 'Der KI-Dienst';
  } catch {
    return 'Der KI-Dienst';
  }
}

/** `sk-…AbCd`: what the settings show of a key. */
export function keyHint(key: string): string {
  const start = key.startsWith('sk-ant-') ? 'sk-ant-' : key.startsWith('sk-') ? 'sk-' : '';
  return `${start}…${key.slice(-4)}`;
}

export const anthropicClient = (deps: Pick<AppDeps, 'anthropic'>, apiKey: string): Anthropic =>
  deps.anthropic?.(apiKey) ?? new Anthropic({ apiKey, maxRetries: 2 });

// ── Errors ───────────────────────────────────────────────────────────────

/** An OpenAI-compatible service answered with an error. */
export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Its error code or type (`insufficient_quota`, …), when it names one. */
    readonly code: string | null,
  ) {
    super(message);
  }
}

/** An OpenAI-compatible service could not be reached at all. */
export class ProviderUnreachable extends Error {}

/**
 * A refusal that is about the key itself (gone, not allowed, out of credit) – in German – or
 * `null` for everything else.
 */
export function keyProblem(
  error: unknown,
  connection: Pick<AiConnection, 'provider' | 'baseUrl'>,
): string | null {
  const name = providerName(connection);
  if (error instanceof Anthropic.AuthenticationError) {
    return 'Anthropic hat den API-Key abgelehnt – vielleicht gelöscht oder falsch kopiert.';
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return 'Der API-Key darf das nicht – prüft die Rechte des Keys in der Anthropic Console.';
  }
  if (error instanceof Anthropic.APIError) {
    const body = JSON.stringify(error.error ?? '');
    if (
      error.status === 402 ||
      body.includes('billing_error') ||
      /credit balance/i.test(error.message)
    ) {
      return 'Das Guthaben eures Anthropic-Kontos ist aufgebraucht – in der Anthropic Console unter „Billing“ aufladen.';
    }
    return null;
  }
  if (error instanceof ProviderHttpError) {
    // Google answers a wrong key with 400 and says so.
    if (
      error.status === 401 ||
      (error.status === 400 &&
        /api key not valid|valid api key|invalid api key|api_key_invalid/i.test(error.message))
    ) {
      return `${name} hat den API-Key abgelehnt – vielleicht gelöscht oder falsch kopiert.`;
    }
    if (error.status === 403) return `Der API-Key darf das nicht – prüft seine Rechte bei ${name}.`;
    if (
      error.status === 402 ||
      error.code === 'insufficient_quota' ||
      // A 429 that mentions a quota (as Gemini's per-minute limit does) passes – not refused.
      (error.status !== 429 && /quota|billing|credit/i.test(error.message))
    ) {
      return `Das Guthaben oder Kontingent eures Kontos bei ${name} ist aufgebraucht – dort aufladen.`;
    }
  }
  return null;
}

/** Why an AI request failed, for the person – in German. */
export function failureMessage(
  error: unknown,
  connection: Pick<AiConnection, 'provider' | 'baseUrl'>,
): string {
  const name = providerName(connection);
  if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError) {
    return 'Anthropic ist gerade überlastet – bitte den Auftrag gleich nochmal senden.';
  }
  if (error instanceof Anthropic.APIConnectionError || error instanceof ProviderUnreachable) {
    return `${name} ist gerade nicht erreichbar – bitte gleich nochmal senden.`;
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic hat den Auftrag nicht angenommen: ${error.message.slice(0, 300)}`;
  }
  if (error instanceof ProviderHttpError) {
    if (error.status === 429 || error.status >= 500) {
      return `${name} ist gerade überlastet – bitte den Auftrag gleich nochmal senden.`;
    }
    if (error.status === 404) {
      return `${name} kennt das Modell nicht (mehr) – ein Admin wählt in den Einstellungen ein anderes.`;
    }
    return `${name} hat den Auftrag nicht angenommen: ${error.message.slice(0, 300)}`;
  }
  if (error instanceof ApiError) return error.message;
  return 'Da ist etwas schiefgelaufen. Bitte den Auftrag nochmal senden.';
}

/** Whether the request failed at the provider (rather than in Slider): logged only otherwise. */
export const isProviderError = (error: unknown): boolean =>
  error instanceof Anthropic.APIError ||
  error instanceof ProviderHttpError ||
  error instanceof ProviderUnreachable;

// ── OpenAI-compatible requests ───────────────────────────────────────────

/**
 * The request to the service – checked: public https, unless the instance allows internal ones,
 * and sent to the very address checked, so a host that resolves anew in between (DNS rebinding)
 * cannot point it into the server's own network.
 */
async function serviceRequest(
  deps: Pick<AppDeps, 'config'>,
  connection: Pick<AiConnection, 'provider' | 'baseUrl'>,
  path: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<{ url: URL; init: RequestInit }> {
  const base = OPENAI_BASE[connection.provider] ?? connection.baseUrl;
  if (!base) throw new ApiError(400, 'bad_request', 'Für diesen Dienst fehlt die Adresse.');
  const url = new URL(`${base.replace(/\/+$/, '')}${path}`);
  if (connection.provider !== 'custom' || deps.config.aiAllowInternalUrls) return { url, init };
  const addresses = await assertPublicHttpsUrl(url, dnsLookup).catch(() => {
    throw new ApiError(
      400,
      'bad_request',
      'Diese Adresse ist intern oder nicht https – das erlaubt die Instanz nicht (AI_ALLOW_INTERNAL_URLS).',
    );
  });
  return pinnedToChecked(url, addresses, init, fetchImpl);
}

/** The answer's text, read up to `MAX_RESPONSE_BYTES`; a bigger one is cut off and refused. */
async function readLimited(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new ProviderHttpError(502, 'Die Antwort war zu groß.', null);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new ProviderHttpError(502, 'Die Antwort war zu groß.', null);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function requestJson<S extends z.ZodType>(
  deps: Pick<AppDeps, 'config' | 'aiFetch'>,
  connection: Pick<AiConnection, 'provider' | 'baseUrl' | 'apiKey'>,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; signal: AbortSignal },
  schema: S,
): Promise<z.infer<S>> {
  const { aiFetch } = deps;
  const fetchImpl: FetchLike = aiFetch
    ? (input, options) => aiFetch(String(input), options)
    : fetch;
  const request = await serviceRequest(
    deps,
    connection,
    path,
    {
      method: init.method,
      headers: {
        authorization: `Bearer ${connection.apiKey}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      // A redirect would carry the key elsewhere.
      redirect: 'error',
      signal: init.signal,
    },
    fetchImpl,
  );
  // A cancelled request stays cancelled; anything else on the way – the time limit too – is unreachable.
  const unreachable = (error: unknown) => {
    if (
      error instanceof ProviderHttpError ||
      (init.signal.aborted &&
        !(init.signal.reason instanceof DOMException && init.signal.reason.name === 'TimeoutError'))
    ) {
      return error;
    }
    return new ProviderUnreachable(error instanceof Error ? error.message : String(error));
  };
  let response: Response;
  let text: string;
  try {
    response = await fetchImpl(request.url.toString(), request.init);
    text = await readLimited(response);
  } catch (error) {
    throw unreachable(error);
  }
  if (!response.ok) {
    let message = text.slice(0, 500) || response.statusText;
    let code: string | null = null;
    try {
      const body = JSON.parse(text) as {
        error?:
          { message?: string; code?: string | number; type?: string; status?: string } | string;
      };
      const error = Array.isArray(body) ? body[0]?.error : body.error;
      if (typeof error === 'string') message = error;
      else if (error) {
        if (typeof error.message === 'string') message = error.message;
        code = String(error.code ?? error.type ?? error.status ?? '') || null;
      }
    } catch {
      // Not JSON: its text says it.
    }
    throw new ProviderHttpError(response.status, message, code);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProviderHttpError(502, 'Die Antwort war kein JSON.', null);
  }
  // Whatever the service sends is checked before it is used: an odd answer is its error, not ours.
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    throw new ProviderHttpError(502, 'Die Antwort hatte nicht die erwartete Form.', null);
  return parsed.data;
}

const modelListSchema = z.object({
  data: z.array(z.object({ id: z.string(), created: z.number().nullish() })).nullish(),
});

// ── Models ───────────────────────────────────────────────────────────────

export interface AiModel {
  id: string;
  name: string;
}

/** Models of OpenAI that cannot chat: pictures, speech, embeddings and the like. */
const NOT_CHAT =
  /embed|whisper|tts|dall-e|davinci|babbage|moderation|image|audio|realtime|transcribe|search|computer-use|codex|sora/i;

/**
 * The models the key may run on, newest first – asking the provider also checks the key. Throws
 * the provider's refusal (`keyProblem`, `failureMessage` tell what it means).
 */
export async function listModels(
  deps: Pick<AppDeps, 'config' | 'aiFetch' | 'anthropic'>,
  connection: Omit<AiConnection, 'model'>,
): Promise<AiModel[]> {
  if (connection.provider === 'anthropic') {
    const client = anthropicClient(deps, connection.apiKey);
    const models: AiModel[] = [];
    for await (const model of client.models.list({ limit: 100 })) {
      models.push({ id: model.id, name: model.display_name || model.id });
    }
    return models;
  }
  const body = await requestJson(
    deps,
    connection,
    '/models',
    { method: 'GET', signal: AbortSignal.timeout(LIST_TIMEOUT_MS) },
    modelListSchema,
  );
  return (body.data ?? [])
    .map((model) => ({ ...model, id: model.id.replace(/^models\//, '') }))
    .filter((model) =>
      connection.provider === 'openai'
        ? !NOT_CHAT.test(model.id)
        : connection.provider === 'gemini'
          ? /gemini/i.test(model.id) && !NOT_CHAT.test(model.id)
          : true,
    )
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id))
    .map((model) => ({ id: model.id, name: model.id }));
}

/** Which of the models a new key starts on: a capable one of the kind the AI was tried with. */
const PREFERRED: Record<AiProvider, RegExp[]> = {
  anthropic: [new RegExp(`^${DEFAULT_ANTHROPIC_MODEL}$`), /sonnet/, /opus/],
  openai: [/^gpt-5(\.\d+)?$/, /^gpt-5/, /^gpt-4\.1$/, /^gpt-4o$/],
  gemini: [/^gemini-[\d.]+-pro$/, /pro/, /flash/],
  custom: [],
};

export function recommendedModel(provider: AiProvider, models: readonly AiModel[]): string | null {
  for (const pattern of PREFERRED[provider]) {
    const match = models.find((model) => pattern.test(model.id));
    if (match) return match.id;
  }
  return models[0]?.id ?? null;
}

// ── One turn of the AI ───────────────────────────────────────────────────

type Message = Anthropic.Beta.BetaMessageParam;
type Block = Anthropic.Beta.BetaContentBlock;

export interface TurnRequest {
  system: string;
  tools: Anthropic.Beta.BetaTool[];
  messages: Message[];
  /** Anthropic only: how many tokens the whole task may take. */
  taskBudgetTokens: number;
  signal: AbortSignal;
}

export interface TurnResult {
  /** `tool_use`: it called tools; `max_tokens`: cut off; `refusal`: it declined. */
  stop: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';
  /** Its answer, to go back into the conversation as the assistant's turn. */
  content: Block[];
}

/** One turn of the AI on the workspace's key: the conversation so far in, its answer out. */
export async function runTurn(
  deps: Pick<AppDeps, 'config' | 'aiFetch' | 'anthropic'>,
  connection: AiConnection,
  request: TurnRequest,
): Promise<TurnResult> {
  if (connection.provider === 'anthropic') return anthropicTurn(deps, connection, request);
  return openAiTurn(deps, connection, request);
}

/** What a turn may write when the model's own limit is unknown. */
const DEFAULT_MAX_TOKENS = 32_000;
/** The most each model may write in one answer, as Anthropic tells it. */
const maxTokensOf = new Map<string, number>();

/** The model's own output limit – a large slide fits in one write – or the default. */
async function maxTokens(client: Anthropic, model: string): Promise<number> {
  const known = maxTokensOf.get(model);
  if (known) return known;
  try {
    const limit = (await client.models.retrieve(model)).max_tokens;
    if (!limit) return DEFAULT_MAX_TOKENS;
    maxTokensOf.set(model, limit);
    return limit;
  } catch {
    // Asked again next turn; the turn itself tells what is wrong with the key.
    return DEFAULT_MAX_TOKENS;
  }
}

async function anthropicTurn(
  deps: Pick<AppDeps, 'anthropic'>,
  connection: AiConnection,
  request: TurnRequest,
): Promise<TurnResult> {
  const client = anthropicClient(deps, connection.apiKey);
  const message = await client.beta.messages
    .stream(
      {
        model: connection.model,
        max_tokens: await maxTokens(client, connection.model),
        system: request.system,
        tools: request.tools,
        messages: request.messages,
        output_config: {
          effort: 'medium',
          task_budget: { type: 'tokens', total: request.taskBudgetTokens },
        },
        cache_control: { type: 'ephemeral' },
        betas: ['server-side-fallback-2026-07-01', 'task-budgets-2026-03-13'],
        fallbacks: 'default',
      },
      { signal: request.signal },
    )
    .finalMessage();
  const stop =
    message.stop_reason === 'refusal'
      ? 'refusal'
      : message.stop_reason === 'max_tokens'
        ? 'max_tokens'
        : message.content.some((block) => block.type === 'tool_use')
          ? 'tool_use'
          : 'end_turn';
  return { stop, content: message.content };
}

/** A part of an OpenAI chat message. */
type ChatPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatPart[] | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

const chatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullish(),
        message: z
          .object({
            content: z.string().nullish(),
            refusal: z.string().nullish(),
            tool_calls: z
              .array(
                z.object({
                  id: z.string().nullish(),
                  function: z
                    .object({ name: z.string().nullish(), arguments: z.string().nullish() })
                    .nullish(),
                }),
              )
              .nullish(),
          })
          .nullish(),
      }),
    )
    .nullish(),
});

type InputBlock = Anthropic.Beta.BetaContentBlockParam | Block;

/** A text or picture block as parts of a chat message (others carry nothing for the model). */
function chatParts(block: InputBlock): ChatPart[] {
  if (block.type === 'text') return [{ type: 'text', text: block.text }];
  if (block.type === 'image') {
    const { source } = block;
    if (source.type === 'base64') {
      return [
        {
          type: 'image_url',
          image_url: { url: `data:${source.media_type};base64,${source.data}` },
        },
      ];
    }
    if (source.type === 'url') return [{ type: 'image_url', image_url: { url: source.url } }];
  }
  return [];
}

/** The conversation as OpenAI's chat messages: tool results become `tool` messages, their pictures follow in a user message. */
function chatMessages(system: string, messages: readonly Message[]): ChatMessage[] {
  const chat: ChatMessage[] = [{ role: 'system', content: system }];
  for (const message of messages) {
    if (typeof message.content === 'string') {
      chat.push({ role: message.role, content: message.content });
      continue;
    }
    const blocks = message.content as InputBlock[];
    if (message.role === 'assistant') {
      const text = blocks
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('\n');
      const calls = blocks.flatMap((block) =>
        block.type === 'tool_use'
          ? [
              {
                id: block.id,
                type: 'function' as const,
                function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
              },
            ]
          : [],
      );
      chat.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length > 0 ? { tool_calls: calls } : {}),
      });
      continue;
    }
    // A tool's answer goes right after the call; what it shows, and anything else said, after all of them.
    const parts: ChatPart[] = [];
    for (const block of blocks) {
      if (block.type !== 'tool_result') {
        parts.push(...chatParts(block));
        continue;
      }
      const shown =
        typeof block.content === 'string'
          ? [{ type: 'text' as const, text: block.content }]
          : (block.content ?? []).flatMap((part) => chatParts(part as InputBlock));
      const said = shown.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
      const pictures = shown.filter((part) => part.type === 'image_url');
      chat.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content:
          `${block.is_error ? 'Error: ' : ''}${said}` ||
          (pictures.length > 0 ? 'The pictures follow below.' : 'Done.'),
      });
      if (pictures.length > 0) {
        parts.push(
          { type: 'text', text: `Pictures of the call ${block.tool_use_id}:` },
          ...pictures,
        );
      }
    }
    if (parts.length > 0) chat.push({ role: 'user', content: parts });
  }
  return chat;
}

let callCount = 0;

async function openAiTurn(
  deps: Pick<AppDeps, 'config' | 'aiFetch'>,
  connection: AiConnection,
  request: TurnRequest,
): Promise<TurnResult> {
  const tools = request.tools.flatMap((tool) =>
    'input_schema' in tool
      ? [
          {
            type: 'function' as const,
            function: {
              name: tool.name,
              description: tool.description ?? '',
              parameters: tool.input_schema,
            },
          },
        ]
      : [],
  );
  const completion = await requestJson(
    deps,
    connection,
    '/chat/completions',
    {
      method: 'POST',
      body: {
        model: connection.model,
        messages: chatMessages(request.system, request.messages),
        tools,
      },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(TURN_TIMEOUT_MS)]),
    },
    chatCompletionSchema,
  );
  const choice = completion.choices?.[0];
  const answer = choice?.message;
  if (!answer) throw new ProviderHttpError(502, 'Die Antwort enthielt keine Nachricht.', null);
  if (answer.refusal || choice.finish_reason === 'content_filter') {
    return { stop: 'refusal', content: [] };
  }
  const content: Block[] = [];
  if (answer.content?.trim()) {
    content.push({ type: 'text', text: answer.content, citations: null } as Block);
  }
  for (const call of answer.tool_calls ?? []) {
    if (!call.function?.name) continue;
    let input: unknown = {};
    try {
      input = JSON.parse(call.function.arguments || '{}');
    } catch {
      // Unreadable arguments: the tool says what is missing, and the AI tries again.
    }
    content.push({
      type: 'tool_use',
      id: call.id || `call_${Date.now()}_${(callCount += 1)}`,
      name: call.function.name,
      input,
    } as Block);
  }
  const calls = content.some((block) => block.type === 'tool_use');
  const stop = choice.finish_reason === 'length' ? 'max_tokens' : calls ? 'tool_use' : 'end_turn';
  return { stop, content };
}
