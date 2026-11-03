import Anthropic from '@anthropic-ai/sdk';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { imageSize } from '@slider/odp';
import {
  PROVIDER_BASE_URLS,
  PROVIDER_LABELS,
  SERVER_PROVIDER,
  type AiFeature,
  type ModelProvider,
} from '@slider/shared';
import { z } from 'zod';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';
import {
  assertPublicHttpsUrl,
  dnsLookup,
  pinnedToChecked,
  readBodyCapped,
  safeFetch,
  type FetchLike,
} from '../sources/safe-fetch';

/*
 * The AI services a workspace can run its AI on (BER-183): Anthropic through its SDK, with all of
 * its own features; OpenAI, Google Gemini, Mistral, Aleph Alpha and any service speaking
 * OpenAI's chat API (OpenRouter, Azure, a local Ollama, …) through that API. Speech to text goes
 * through OpenAI's API too, on the same kind of connection. The AI's conversation is kept in
 * Anthropic's shape (`ai-proposals`); for the others it is translated there and back per turn.
 * Generating pictures: OpenAI's `/images/generations`, or Black Forest Labs' own API.
 */

/** The key the AI runs on: who, where, which model. */
export interface AiConnection {
  provider: ModelProvider;
  apiKey: string;
  /** The service's own address, up to `/v1` or the like: for `custom`, or one changed. */
  baseUrl: string | null;
  model: string;
  /**
   * The instance's key: only its address may be internal (`AI_ALLOW_INTERNAL_URLS`) – a
   * workspace's admins must not make the server reach into its own network.
   */
  instance?: boolean;
  /** Told what each request used (`ai-usage`) – a workspace's connections only, not key checks. */
  meter?: AiMeter;
}

/** What one request used, as the service's answer tells it. */
export interface AiUsageReport {
  feature: AiFeature;
  /** The model that answered – a fallback's, where another stepped in. */
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  audioSeconds?: number;
  images?: number;
}
export type AiMeter = (report: AiUsageReport) => void;

/** The model Anthropic keys run on unless an admin picks another. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';

/** Where the OpenAI-compatible services answer – unless a key names an address of its own. */
const OPENAI_BASE: Partial<Record<ModelProvider, string>> = {
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  mistral: 'https://api.mistral.ai/v1',
  scaleway: 'https://api.scaleway.ai/v1',
  't-systems': 'https://llm-server.llmhub.t-systems.net/v2',
  ...PROVIDER_BASE_URLS,
};

/** One turn of the AI may take this long before it counts as unreachable. */
const TURN_TIMEOUT_MS = 10 * 60_000;
/** Listing models (checking a key) may take this long. */
const LIST_TIMEOUT_MS = 20_000;
/** An answer of the service may be this big – a time limit does not bound how much it sends. */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** The service by name, for messages: „OpenAI“, or the host of a custom or self-hosted one. */
export function providerName(connection: Pick<AiConnection, 'provider' | 'baseUrl'>): string {
  if (connection.provider !== 'custom' && connection.provider !== SERVER_PROVIDER) {
    return PROVIDER_LABELS[connection.provider];
  }
  try {
    return new URL(connection.baseUrl ?? '').host || 'Der KI-Dienst';
  } catch {
    return 'Der KI-Dienst';
  }
}

/** `sk-…AbCd`: what the settings show of a key. */
export function keyHint(key: string): string {
  // A self-hosted service without one.
  if (!key) return '';
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

/**
 * Whether the service clearly refused the key (by status, not by wording) – only then is it
 * paused for everyone using it; the instance's key serves every workspace.
 */
export function refusesKey(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    return (
      [401, 402, 403].includes(error.status ?? 0) ||
      JSON.stringify(error.error ?? '').includes('"billing_error"')
    );
  }
  if (error instanceof ProviderHttpError) {
    return (
      [401, 402, 403].includes(error.status) ||
      error.code === 'insufficient_quota' ||
      // Google answers a wrong key with 400 and its own reason.
      (error.status === 400 && /api_key_invalid|api key not valid/i.test(error.message))
    );
  }
  return false;
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
  if (isUnreadableToolInput(error)) {
    return 'Die KI hat eine Änderung in kaputtem Format geschickt – bitte den Auftrag nochmal senden, notfalls in kleineren Schritten.';
  }
  return 'Da ist etwas schiefgelaufen. Bitte den Auftrag nochmal senden.';
}

/** The SDK could not read a tool call's input: the model wrote broken JSON. */
export const isUnreadableToolInput = (error: unknown): boolean =>
  error instanceof Anthropic.AnthropicError &&
  !(error instanceof Anthropic.APIError) &&
  error.message.startsWith('Unable to parse tool parameter JSON');

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
  connection: Pick<AiConnection, 'provider' | 'baseUrl' | 'instance'>,
  path: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<{ url: URL; init: RequestInit }> {
  const base = connection.baseUrl ?? OPENAI_BASE[connection.provider];
  if (!base) throw new ApiError(400, 'bad_request', 'Für diesen Dienst fehlt die Adresse.');
  const url = new URL(`${base.replace(/\/+$/, '')}${path}`);
  // The services' own addresses are known; one a key names is checked.
  if (!connection.baseUrl) return { url, init };
  // The instance's self-hosted service sits in its own network by its very nature.
  const internalAllowed =
    connection.instance &&
    (deps.config.aiAllowInternalUrls || connection.provider === SERVER_PROVIDER);
  if (internalAllowed) return { url, init };
  const addresses = await assertPublicHttpsUrl(url, dnsLookup).catch(() => {
    throw new ApiError(
      400,
      'bad_request',
      deps.config.aiAllowInternalUrls
        ? 'Diese Adresse ist intern oder nicht https – das darf nur der Instanz-Admin für alle Workspaces hinterlegen.'
        : 'Diese Adresse ist intern oder nicht https – das erlaubt die Instanz nicht (AI_ALLOW_INTERNAL_URLS).',
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
  connection: Pick<AiConnection, 'provider' | 'baseUrl' | 'apiKey' | 'instance'>,
  path: string,
  /** `body`: sent as JSON – or as it is, a form (a recording to transcribe). */
  init: { method: 'GET' | 'POST'; body?: unknown; signal: AbortSignal },
  schema: S,
): Promise<z.infer<S>> {
  const { aiFetch } = deps;
  const form = init.body instanceof FormData ? init.body : null;
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
        // Black Forest Labs takes its key in a header of its own; a self-hosted one may need none.
        ...(connection.provider === 'black-forest-labs'
          ? { 'x-key': connection.apiKey }
          : connection.apiKey
            ? { authorization: `Bearer ${connection.apiKey}` }
            : {}),
        ...(init.body === undefined || form ? {} : { 'content-type': 'application/json' }),
      },
      body: form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
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
        /** Self-hosted speech to text (deploy/stt, FastAPI). */
        detail?: unknown;
      };
      const error = Array.isArray(body) ? body[0]?.error : body.error;
      if (typeof body.detail === 'string') message = body.detail;
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
/** Aleph Alpha's own list (`/models_available`), where it has no `/models`. */
const alephModelListSchema = z.array(z.object({ name: z.string() }));

// ── Models ───────────────────────────────────────────────────────────────

export interface AiModel {
  id: string;
  name: string;
}

/** Models that cannot chat: pictures, speech, embeddings and the like. */
const NOT_CHAT =
  /embed|whisper|tts|dall-e|davinci|babbage|moderation|image|audio|realtime|transcribe|search|computer-use|codex|sora|ocr|voxtral|flux|stable-diffusion|sdxl|rerank|bge-|guard/i;
/** Models that turn speech into text. */
const SPEECH = /whisper|transcribe|voxtral|speech-to-text|stt/i;
/** Models that generate pictures. */
const IMAGE = /gpt-image|dall-e|imagen|-image|flux|stable-diffusion|sdxl|recraft/i;
/** Black Forest Labs' usual models – for when its API description cannot be read. */
const BFL_FALLBACK_MODELS = ['flux-3-image', 'flux-3-image-klein', 'flux-2-pro', 'flux-2-max'];

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
  return (await offeredModels(deps, connection))
    .filter((model) =>
      // A service of one's own (and Aleph Alpha's own list) is taken at its word.
      connection.provider === 'custom' || connection.provider === 'aleph-alpha'
        ? true
        : connection.provider === 'gemini'
          ? /gemini/i.test(model.id) && !NOT_CHAT.test(model.id)
          : !NOT_CHAT.test(model.id),
    )
    .map((model) => ({ id: model.id, name: model.id }));
}

const bflCreditsSchema = z.object({ credits: z.number() });
const openApiSchema = z.object({
  paths: z.record(
    z.string(),
    z.object({ post: z.object({ summary: z.string().nullish() }).nullish() }),
  ),
});
/** „Generate an image with FLUX.2 [pro]“, „Edit or create an image with …“ – a picture model. */
const BFL_IMAGE_SUMMARY = /^(?:generate|edit)(?: or \w+)? an image with (.+?)\.?$/i;

/**
 * Black Forest Labs' picture models, as its API description names them: each its own path,
 * newest first. Fine-tuned ones need a fine-tune of one's own and are left out.
 */
async function bflImageModels(
  deps: Pick<AppDeps, 'config' | 'aiFetch'>,
  connection: Omit<AiConnection, 'model'>,
  signal: AbortSignal,
): Promise<AiModel[]> {
  // The description lies beside the versioned paths, at the root of the address.
  const spec = await requestJson(
    deps,
    connection,
    '/../openapi.json',
    { method: 'GET', signal },
    openApiSchema,
  );
  const generation = (id: string) => Number(/^flux-(\d+)-/.exec(id)?.[1] ?? 1);
  const models: AiModel[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    const id = /^\/v1\/(flux-[\w.-]+)$/.exec(path)?.[1];
    const name = BFL_IMAGE_SUMMARY.exec(item.post?.summary ?? '')?.[1];
    if (id && name && !/finetune/i.test(id + name)) models.push({ id, name });
  }
  return models.sort(
    (a, b) =>
      generation(b.id) - generation(a.id) ||
      Number(a.id.endsWith('-preview')) - Number(b.id.endsWith('-preview')) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * The models that generate pictures with the key – asking also checks it. Black Forest Labs has
 * no list of them: its credits check the key, its API description names the models. A service of
 * its own may not tell which those are: then all it offers.
 */
export async function listImageModels(
  deps: Pick<AppDeps, 'config' | 'aiFetch'>,
  connection: Omit<AiConnection, 'model'>,
): Promise<AiModel[]> {
  if (connection.provider === 'black-forest-labs') {
    const signal = AbortSignal.timeout(LIST_TIMEOUT_MS);
    const [, models] = await Promise.all([
      requestJson(deps, connection, '/credits', { method: 'GET', signal }, bflCreditsSchema),
      bflImageModels(deps, connection, signal).catch(() => []),
    ]);
    return models.length > 0 ? models : BFL_FALLBACK_MODELS.map((id) => ({ id, name: id }));
  }
  const offered = await offeredModels(deps, connection);
  const images = offered.filter((model) => IMAGE.test(model.id));
  return (images.length > 0 || connection.provider !== 'custom' ? images : offered).map(
    (model) => ({ id: model.id, name: model.id }),
  );
}

/**
 * The models that turn speech into text with the key – asking also checks it. A service of its
 * own may not tell which those are: then all it offers.
 */
export async function listSpeechModels(
  deps: Pick<AppDeps, 'config' | 'aiFetch'>,
  connection: Omit<AiConnection, 'model'>,
): Promise<AiModel[]> {
  const offered = await offeredModels(deps, connection);
  const speech = offered.filter((model) => SPEECH.test(model.id));
  const ownService = connection.provider === 'custom' || connection.provider === SERVER_PROVIDER;
  return (speech.length > 0 || !ownService ? speech : offered).map((model) => ({
    id: model.id,
    name: model.id,
  }));
}

/** Models that stream speech to text while it is spoken. */
const LIVE = /realtime/i;

/** The models that stream speech to text while it is spoken (`live`) – asking also checks the key. */
export async function listLiveModels(
  deps: Pick<AppDeps, 'config' | 'aiFetch'>,
  connection: Omit<AiConnection, 'model'>,
): Promise<AiModel[]> {
  const offered = await offeredModels(deps, connection);
  return offered
    .filter((model) => SPEECH.test(model.id) && LIVE.test(model.id))
    .map((model) => ({ id: model.id, name: model.id }));
}

/** A token for the realtime WebSocket is asked for at most this long. */
const LIVE_TOKEN_TIMEOUT_MS = 10_000;

/**
 * Where the browser streams the microphone to see the words as they are spoken: Mistral's
 * realtime WebSocket, opened with a token that soon expires and works for this one model only
 * (`POST /client/sessions`) – the key itself never reaches the browser.
 */
export async function liveTranscriptionToken(
  deps: Pick<AppDeps, 'config' | 'aiFetch'>,
  connection: AiConnection,
): Promise<{ url: string; token: string; expiresAt: string }> {
  const body = await requestJson(
    deps,
    connection,
    '/client/sessions',
    {
      method: 'POST',
      body: { purpose: 'realtime', model: connection.model },
      signal: AbortSignal.timeout(LIVE_TOKEN_TIMEOUT_MS),
    },
    z.object({
      expires_at: z.string().optional(),
      client_secret: z.object({ value: z.string(), expires_at: z.string().optional() }),
    }),
  );
  const base = new URL(`${(connection.baseUrl ?? OPENAI_BASE.mistral!).replace(/\/+$/, '')}/`);
  const url = new URL('audio/transcriptions/realtime', base);
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  url.search = new URLSearchParams({ model: connection.model }).toString();
  return {
    url: url.toString(),
    token: body.client_secret.value,
    expiresAt: body.client_secret.expires_at ?? body.expires_at ?? new Date().toISOString(),
  };
}

/** A recording of an hour, on the server's own CPU, may take this long. */
const TRANSCRIBE_TIMEOUT_MS = 30 * 60_000;

/** Mistral takes at most this many terms to listen for. */
const MAX_CONTEXT_BIAS = 100;
const MAX_TERM_CHARS = 100;

/**
 * A recording as text, through OpenAI's `/audio/transcriptions` – the services' and a
 * self-hosted one alike. `language` (ISO 639-1, e.g. `de`) spares guessing it; `prompt` gives the
 * spelling of names the recording uses („Slider“) – Whisper reads it as text said before. Mistral
 * ignores it and listens for `terms` instead (`context_bias`, one field each): the prompt's
 * words, where no terms are given.
 */
export async function transcribe(
  deps: Pick<AppDeps, 'config' | 'aiFetch'>,
  connection: AiConnection,
  audio: { bytes: Uint8Array; name: string; type: string },
  options: {
    language?: string;
    prompt?: string;
    terms?: string[];
    signal?: AbortSignal;
    /** How long the recording is, where known – for the usage. */
    durationMs?: number;
    /** What it is for, in the usage – a recording unless said. */
    feature?: AiFeature;
  } = {},
): Promise<string> {
  const form = new FormData();
  form.set('file', new Blob([Buffer.from(audio.bytes)], { type: audio.type }), audio.name);
  form.set('model', connection.model);
  if (options.language) form.set('language', options.language);
  if (connection.provider === 'mistral') {
    const terms = options.terms ?? options.prompt?.split(/[,.]/) ?? [];
    const unique = [...new Set(terms.map((term) => term.replace(/\s+/g, ' ').trim()))].filter(
      (term) => term && term.length <= MAX_TERM_CHARS,
    );
    for (const term of unique.slice(0, MAX_CONTEXT_BIAS)) form.append('context_bias', term);
  } else if (options.prompt) {
    form.set('prompt', options.prompt);
  }
  const timeout = AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS);
  const body = await requestJson(
    deps,
    connection,
    '/audio/transcriptions',
    {
      method: 'POST',
      body: form,
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    },
    transcriptionSchema,
  );
  const usage = body.usage;
  connection.meter?.({
    feature: options.feature ?? 'recording',
    model: connection.model,
    audioSeconds:
      (options.durationMs !== undefined ? options.durationMs / 1000 : null) ??
      wavSeconds(audio.bytes) ??
      usage?.seconds ??
      usage?.prompt_audio_seconds ??
      body.duration ??
      0,
    inputTokens: usage?.input_tokens ?? usage?.prompt_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? usage?.completion_tokens ?? 0,
  });
  return body.text.trim();
}

/**
 * A transcription's text – and what it used, where the service says: OpenAI's Whisper the seconds,
 * its newer models tokens, Mistral the seconds of audio.
 */
const transcriptionSchema = z.object({
  text: z.string(),
  duration: z.number().nullish(),
  usage: z
    .object({
      seconds: z.number().nullish(),
      prompt_audio_seconds: z.number().nullish(),
      input_tokens: z.number().nullish(),
      output_tokens: z.number().nullish(),
      prompt_tokens: z.number().nullish(),
      completion_tokens: z.number().nullish(),
    })
    .nullish(),
});

/** How long a WAV recording is, from its header – `null` for anything else. */
export function wavSeconds(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  const byteRate = view.getUint32(28, true);
  return byteRate > 0 ? (bytes.length - 44) / byteRate : null;
}

/** All models of an OpenAI-compatible service, newest first. */
async function offeredModels(
  deps: Pick<AppDeps, 'config' | 'aiFetch'>,
  connection: Omit<AiConnection, 'model'>,
): Promise<{ id: string; created?: number | null }[]> {
  const signal = AbortSignal.timeout(LIST_TIMEOUT_MS);
  let models: { id: string; created?: number | null }[];
  try {
    const body = await requestJson(
      deps,
      connection,
      '/models',
      { method: 'GET', signal },
      modelListSchema,
    );
    models = body.data ?? [];
  } catch (error) {
    if (
      connection.provider !== 'aleph-alpha' ||
      !(error instanceof ProviderHttpError && error.status === 404)
    ) {
      throw error;
    }
    const body = await requestJson(
      deps,
      connection,
      '/models_available',
      { method: 'GET', signal },
      alephModelListSchema,
    );
    models = body.map((model) => ({ id: model.name }));
  }
  return models
    .map((model) => ({ ...model, id: model.id.replace(/^models\//, '') }))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id));
}

/** Which of the models a new key starts on: a capable one of the kind the AI was tried with. */
const PREFERRED: Partial<Record<ModelProvider, RegExp[]>> = {
  anthropic: [new RegExp(`^${DEFAULT_ANTHROPIC_MODEL}$`), /sonnet/, /opus/],
  openai: [/^gpt-5(\.\d+)?$/, /^gpt-5/, /^gpt-4\.1$/, /^gpt-4o$/],
  gemini: [/^gemini-[\d.]+-pro$/, /pro/, /flash/],
  mistral: [/^mistral-large-latest$/, /^mistral-large/, /^mistral-medium/],
  'aleph-alpha': [/llama-3\.3-70b/, /70b/, /pharia/],
  scaleway: [/mistral-medium/i, /gpt-oss-120b/i, /qwen3/i, /llama-3\.3-70b/i],
  't-systems': [/gpt-oss-120b/i, /mistral/i, /qwen/i, /llama/i],
};

/** Which speech model a new key starts on. */
const PREFERRED_SPEECH: Partial<Record<ModelProvider, RegExp[]>> = {
  openai: [
    /^gpt-transcribe$/,
    /^gpt-transcribe/,
    /^gpt-4o-transcribe$/,
    /transcribe/,
    /^whisper-1$/,
  ],
  // Voxtral 3 (2026-10) first – `voxtral-mini-latest` may still point at an older one.
  mistral: [
    /^voxtral-mini-transcribe-3/,
    /^voxtral-small-transcribe-3/,
    /^voxtral-mini-transcribe(?!-realtime)/,
    /^voxtral-mini-latest$/,
    /^voxtral-mini(?!.*realtime)/,
    /voxtral(?!.*realtime)/,
  ],
  scaleway: [/whisper-large-v3/i, /voxtral/i, /whisper/i],
  [SERVER_PROVIDER]: [/large-v3-turbo/i, /whisper-large/i, /whisper/i],
};

/** Which realtime model a new `live` key starts on. */
const PREFERRED_LIVE: Partial<Record<ModelProvider, RegExp[]>> = {
  // Voxtral 3 first, as for the pieces.
  mistral: [
    /^voxtral-mini-transcribe-realtime-3$/,
    /^voxtral-mini-transcribe-realtime-3/,
    /^voxtral-mini-transcribe-realtime-\d{4}$/,
    /^voxtral-mini-transcribe-realtime/,
    /realtime/,
  ],
};

/** Which picture model a new key starts on. */
const PREFERRED_IMAGE: Partial<Record<ModelProvider, RegExp[]>> = {
  'black-forest-labs': [/^flux-3-image$/, /^flux-2-pro$/],
  openai: [/^gpt-image-[\d.]+(-\w+)?$/, /gpt-image/, /dall-e-3/],
  gemini: [/flash-image/, /-image/, /imagen/],
};

const PREFERRED_BY_KIND = {
  ai: PREFERRED,
  speech: PREFERRED_SPEECH,
  voice: PREFERRED_SPEECH,
  live: PREFERRED_LIVE,
  images: PREFERRED_IMAGE,
};

/** Which of the models a new key of the kind starts on: a capable one. */
export function recommendedModel(
  provider: ModelProvider,
  models: readonly AiModel[],
  kind: keyof typeof PREFERRED_BY_KIND = 'ai',
): string | null {
  for (const pattern of PREFERRED_BY_KIND[kind][provider] ?? []) {
    const match = models.find((model) => pattern.test(model.id));
    if (match) return match.id;
  }
  return models[0]?.id ?? null;
}

// ── One turn of the AI ───────────────────────────────────────────────────

type Message = Anthropic.Beta.BetaMessageParam;
/** How hard an Anthropic model thinks. */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
type Block = Anthropic.Beta.BetaContentBlock;

export interface TurnRequest {
  system: string;
  tools: Anthropic.Beta.BetaTool[];
  messages: Message[];
  /** Anthropic only: how many tokens the whole task may take. */
  taskBudgetTokens: number;
  /** Anthropic only: how hard the model thinks – `medium` when left out. */
  effort?: Effort;
  /**
   * Anthropic only: old tool results are cleared from what the model reads once the conversation
   * grows past `trigger` input tokens – `keep` latest stay, and those of the `exclude`d tools;
   * only when at least `clearAtLeast` tokens go (each clearing costs the cached prefix).
   */
  clearToolResults?: { trigger: number; keep: number; clearAtLeast: number; exclude: string[] };
  signal: AbortSignal;
  /** What it is for, in the usage – changing slides unless said. */
  feature?: AiFeature;
  /**
   * Anthropic only: someone waits for it – in fast mode where the model has one (twice the
   * price), at standard speed where the key may not or its fast quota is used up.
   */
  fast?: boolean;
}

/** The tokens of an Anthropic answer, for the usage. */
const anthropicTokens = (usage: Anthropic.Beta.BetaUsage | undefined) => ({
  inputTokens: usage?.input_tokens ?? 0,
  outputTokens: usage?.output_tokens ?? 0,
  cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
  cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
});

/** What an OpenAI-compatible service says a chat answer used (OpenRouter adds its cost). */
const chatUsageSchema = z
  .object({
    prompt_tokens: z.number().nullish(),
    completion_tokens: z.number().nullish(),
    prompt_tokens_details: z.object({ cached_tokens: z.number().nullish() }).nullish(),
  })
  .nullish();

/** The tokens of an OpenAI chat answer: cached ones are part of `prompt_tokens` there. */
function chatTokens(usage: z.infer<typeof chatUsageSchema>) {
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: Math.max(0, (usage?.prompt_tokens ?? 0) - cached),
    outputTokens: usage?.completion_tokens ?? 0,
    cacheReadTokens: cached,
  };
}

export interface TurnResult {
  /** `tool_use`: it called tools; `max_tokens`: cut off; `refusal`: it declined. */
  stop: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';
  /** Its answer, to go back into the conversation as the assistant's turn. */
  content: Block[];
  /** Ids of its tool calls whose input came as broken JSON – refused, for it to send again. */
  unreadable?: string[];
  /** How long the turn took, for the timing log (Anthropic only). */
  timing?: TurnTiming;
}

/** Where a turn's time went: waiting for the first token, then writing. */
export interface TurnTiming {
  /** From the request to the whole answer. */
  ms: number;
  /** From the request to the first token of the answer (thinking included), if seen. */
  firstTokenMs: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** `fast` when it ran in fast mode. */
  speed: string | null;
}

/**
 * The longest side a picture goes to the AI with. Anthropic refuses a request holding many
 * pictures if one is larger than 3000 px – slides are drawn 3840 px wide, phone photos are 4000 –
 * and its models see no more than about 2576 px of a picture anyway.
 */
export const MAX_PICTURE_SIDE = 2560;

/** Pictures of the conversation already looked at: each is fitted once. */
const fitted = new WeakSet<object>();

/**
 * Shrinks, in place, the conversation's pictures whose longer side exceeds
 * {@link MAX_PICTURE_SIDE}. In place and once: later turns send the same bytes (prompt cache).
 */
export async function fitPictures(messages: Anthropic.Beta.BetaMessageParam[]): Promise<void> {
  const images: Anthropic.Beta.BetaBase64ImageSource[] = [];
  const collect = (blocks: readonly unknown[]) => {
    for (const block of blocks as Anthropic.Beta.BetaContentBlockParam[]) {
      if (block.type === 'image' && block.source.type === 'base64') images.push(block.source);
      if (block.type === 'tool_result' && Array.isArray(block.content)) collect(block.content);
    }
  };
  for (const message of messages) {
    if (Array.isArray(message.content)) collect(message.content);
  }
  for (const source of images) {
    if (fitted.has(source)) continue;
    fitted.add(source);
    const bytes = Buffer.from(source.data, 'base64');
    const size = imageSize(bytes);
    if (!size || Math.max(size.width, size.height) <= MAX_PICTURE_SIDE) continue;
    const image = await loadImage(bytes).catch(() => null);
    // Unreadable, it goes as it is: the service says what is wrong with it.
    if (!image) continue;
    const scale = MAX_PICTURE_SIDE / Math.max(size.width, size.height);
    const canvas = createCanvas(
      Math.max(1, Math.round(size.width * scale)),
      Math.max(1, Math.round(size.height * scale)),
    );
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    // PNG keeps its transparency (cut-outs); everything else goes as WebP.
    const png = size.mediaType === 'image/png';
    const shrunk = png ? await canvas.encode('png') : await canvas.encode('webp', 90);
    source.media_type = png ? 'image/png' : 'image/webp';
    source.data = Buffer.from(shrunk).toString('base64');
  }
}

/** One turn of the AI on the workspace's key: the conversation so far in, its answer out. */
export async function runTurn(
  deps: Pick<AppDeps, 'config' | 'aiFetch' | 'anthropic'>,
  connection: AiConnection,
  request: TurnRequest,
): Promise<TurnResult> {
  await fitPictures(request.messages);
  if (connection.provider === 'anthropic') return anthropicTurn(deps, connection, request);
  return openAiTurn(deps, connection, {
    ...request,
    messages: request.messages.filter((message) => !isEffortMessage(message)),
  });
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

/**
 * Models that change their effort within a conversation – a `role: "system"` message with only
 * `output_config` – without losing the prompt cache. Others refuse the message: it is left out.
 */
const TURN_EFFORT_MODELS =
  /claude-(fable-5-1|mythos-5-1|opus-5-5|opus-5(?!-\d)|sonnet-5-5|haiku-5-5)/;
/** Models with a fast mode (more tokens a second, at twice the price) – on Anthropic's own API. */
const FAST_MODELS = /claude-(opus-5-5|opus-5(?!-\d)|opus-4-8)/;
/** Keys and models whose fast mode was refused (not open to the key): asked no more. */
const noFastMode = new Set<string>();

/** A message that changes how hard the model thinks from the next turn with new input on. */
export const effortMessage = (effort: Effort): Message => ({
  role: 'system',
  content: [],
  output_config: { effort },
});

/** An effort-only message – kept where the model reads it, left out elsewhere. */
const isEffortMessage = (message: Message) =>
  message.role === 'system' && Array.isArray(message.content) && message.content.length === 0;

/** Fast mode was refused or is rate limited: the turn runs again at standard speed. */
function fastModeRefused(error: unknown): 'limited' | 'refused' | null {
  if (error instanceof Anthropic.RateLimitError) return 'limited';
  if (
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.PermissionDeniedError ||
    error instanceof Anthropic.NotFoundError
  ) {
    return /speed|fast/i.test(error.message) ? 'refused' : null;
  }
  return null;
}

async function anthropicTurn(
  deps: Pick<AppDeps, 'anthropic'>,
  connection: AiConnection,
  request: TurnRequest,
): Promise<TurnResult> {
  const fastKey = `${connection.apiKey.slice(-12)}:${connection.model}`;
  const fast =
    request.fast === true &&
    connection.baseUrl === null &&
    FAST_MODELS.test(connection.model) &&
    !noFastMode.has(fastKey);
  try {
    return await anthropicTurnAt(deps, connection, request, fast);
  } catch (error) {
    const refused = fast ? fastModeRefused(error) : null;
    if (!refused || request.signal.aborted) throw error;
    if (refused === 'refused') noFastMode.add(fastKey);
    return anthropicTurnAt(deps, connection, request, false);
  }
}

async function anthropicTurnAt(
  deps: Pick<AppDeps, 'anthropic'>,
  connection: AiConnection,
  request: TurnRequest,
  fast: boolean,
): Promise<TurnResult> {
  const client = anthropicClient(deps, connection.apiKey);
  const clear = request.clearToolResults;
  const turnEffort = TURN_EFFORT_MODELS.test(connection.model);
  const messages = turnEffort
    ? request.messages
    : request.messages.filter((message) => !isEffortMessage(message));
  const startedAt = Date.now();
  const stream = client.beta.messages.stream(
    {
      model: connection.model,
      max_tokens: await maxTokens(client, connection.model),
      system: request.system,
      ...(request.tools.length > 0 ? { tools: request.tools } : {}),
      messages,
      output_config: {
        effort: request.effort ?? 'medium',
        task_budget: { type: 'tokens', total: request.taskBudgetTokens },
      },
      cache_control: { type: 'ephemeral' },
      ...(fast ? { speed: 'fast' as const } : {}),
      ...(clear
        ? {
            context_management: {
              edits: [
                {
                  type: 'clear_tool_uses_20250919' as const,
                  trigger: { type: 'input_tokens' as const, value: clear.trigger },
                  keep: { type: 'tool_uses' as const, value: clear.keep },
                  clear_at_least: { type: 'input_tokens' as const, value: clear.clearAtLeast },
                  exclude_tools: clear.exclude,
                },
              ],
            },
          }
        : {}),
      betas: [
        'server-side-fallback-2026-07-01',
        'task-budgets-2026-03-13',
        ...(clear ? ['context-management-2025-06-27'] : []),
        ...(fast ? ['fast-mode-2026-02-01'] : []),
        ...(turnEffort && messages.some(isEffortMessage)
          ? ['mid-conversation-output-config-2026-07-01']
          : []),
      ],
      fallbacks: 'default',
    },
    { signal: request.signal },
  );
  let firstTokenAt: number | null = null;
  // The fake client of the tests has no events.
  if (typeof stream.on === 'function') {
    stream.on('streamEvent', (event) => {
      if (firstTokenAt === null && event.type === 'content_block_start') firstTokenAt = Date.now();
    });
  }
  const timingOf = (message: Anthropic.Beta.BetaMessage | undefined): TurnTiming => ({
    ms: Date.now() - startedAt,
    firstTokenMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
    inputTokens: message?.usage.input_tokens ?? 0,
    outputTokens: message?.usage.output_tokens ?? 0,
    cacheReadTokens: message?.usage.cache_read_input_tokens ?? 0,
    speed: (message?.usage as { speed?: string | null } | undefined)?.speed ?? null,
  });
  let message: Anthropic.Beta.BetaMessage;
  try {
    message = await stream.finalMessage();
  } catch (error) {
    // Eager input streaming leaves the JSON unchecked: a call can come broken (an unescaped `"`
    // in its XML). The stream stops at that call – its answer so far goes back, the call
    // refused, and the AI sends it again; nothing more of this answer is paid for.
    const partial = stream.currentMessage;
    const broken = partial?.content.at(-1);
    if (!isUnreadableToolInput(error) || !partial || broken?.type !== 'tool_use') throw error;
    stream.abort();
    connection.meter?.({
      feature: request.feature ?? 'edit',
      model: partial.model || connection.model,
      ...anthropicTokens(partial.usage),
    });
    return {
      stop: 'tool_use',
      content: partial.content,
      unreadable: [broken.id],
      timing: timingOf(partial),
    };
  }
  connection.meter?.({
    feature: request.feature ?? 'edit',
    model: message.model || connection.model,
    ...anthropicTokens(message.usage),
  });
  const stop =
    message.stop_reason === 'refusal'
      ? 'refusal'
      : message.stop_reason === 'max_tokens'
        ? 'max_tokens'
        : message.content.some((block) => block.type === 'tool_use')
          ? 'tool_use'
          : 'end_turn';
  return { stop, content: message.content, timing: timingOf(message) };
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
  model: z.string().nullish(),
  usage: chatUsageSchema,
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
        // Some compatible services refuse an empty list.
        ...(tools.length > 0 ? { tools } : {}),
      },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(TURN_TIMEOUT_MS)]),
    },
    chatCompletionSchema,
  );
  connection.meter?.({
    feature: request.feature ?? 'edit',
    model: completion.model || connection.model,
    ...chatTokens(completion.usage),
  });
  const choice = completion.choices?.[0];
  const answer = choice?.message;
  if (!answer) throw new ProviderHttpError(502, 'Die Antwort enthielt keine Nachricht.', null);
  if (answer.refusal || choice.finish_reason === 'content_filter') {
    return { stop: 'refusal', content: [] };
  }
  const content: Block[] = [];
  const unreadable: string[] = [];
  if (answer.content?.trim()) {
    content.push({ type: 'text', text: answer.content, citations: null } as Block);
  }
  for (const call of answer.tool_calls ?? []) {
    if (!call.function?.name) continue;
    const id = call.id || `call_${Date.now()}_${(callCount += 1)}`;
    let input: unknown = {};
    try {
      input = JSON.parse(call.function.arguments || '{}');
    } catch {
      // Unreadable arguments: refused, and the AI sends them again.
      unreadable.push(id);
    }
    content.push({ type: 'tool_use', id, name: call.function.name, input } as Block);
  }
  const calls = content.some((block) => block.type === 'tool_use');
  const stop = choice.finish_reason === 'length' ? 'max_tokens' : calls ? 'tool_use' : 'end_turn';
  return { stop, content, ...(unreadable.length > 0 ? { unreadable } : {}) };
}

// ── One quick decision ───────────────────────────────────────────────────

/**
 * The model quick decisions run on with an Anthropic key (speaking to the AI decides what a
 * piece of speech is while the person goes on): fast, and good enough to follow a thought.
 */
export const QUICK_ANTHROPIC_MODEL = 'claude-haiku-5-5';
/** A quick decision may take this long. */
const QUICK_TIMEOUT_MS = 45_000;

export interface ToolCallRequest {
  system: string;
  /** The one tool the model must call – its input is the decision. */
  tool: Anthropic.Beta.BetaTool & { input_schema: Anthropic.Beta.BetaTool.InputSchema };
  user: string;
  maxTokens: number;
  signal: AbortSignal;
  /** What it is for, in the usage – speaking to the AI unless said. */
  feature?: AiFeature;
}

/**
 * One answer that is a call of `tool`: its input, or `null` when the model gave none. Anthropic
 * keys run on {@link QUICK_ANTHROPIC_MODEL} (the key's own model when that one is refused); the
 * others on the key's model, as OpenAI's chat API with the tool required.
 */
export async function runToolCall(
  deps: Pick<AppDeps, 'config' | 'aiFetch' | 'anthropic'>,
  connection: AiConnection,
  request: ToolCallRequest,
): Promise<unknown> {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(QUICK_TIMEOUT_MS)]);
  if (connection.provider === 'anthropic') {
    const client = anthropicClient(deps, connection.apiKey);
    const ask = async (model: string) => {
      const message = await client.beta.messages
        .stream(
          {
            model,
            max_tokens: request.maxTokens,
            system: request.system,
            tools: [request.tool],
            tool_choice: { type: 'tool', name: request.tool.name },
            messages: [{ role: 'user', content: request.user }],
          },
          { signal },
        )
        .finalMessage();
      connection.meter?.({
        feature: request.feature ?? 'voice',
        model: message.model || model,
        ...anthropicTokens(message.usage),
      });
      const call = message.content.find((block) => block.type === 'tool_use');
      return call?.type === 'tool_use' ? call.input : null;
    };
    try {
      return await ask(QUICK_ANTHROPIC_MODEL);
    } catch (error) {
      // A key without the quick model (an older account, a gateway with a list of its own).
      const status = error instanceof Anthropic.APIError ? error.status : undefined;
      if ((status === 404 || status === 400) && connection.model !== QUICK_ANTHROPIC_MODEL) {
        return ask(connection.model);
      }
      throw error;
    }
  }
  const { tool } = request;
  const completion = await requestJson(
    deps,
    connection,
    '/chat/completions',
    {
      method: 'POST',
      body: {
        model: connection.model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description ?? '',
              parameters: tool.input_schema,
            },
          },
        ],
        tool_choice: 'required',
        max_tokens: request.maxTokens,
      },
      signal,
    },
    chatCompletionSchema,
  );
  connection.meter?.({
    feature: request.feature ?? 'voice',
    model: completion.model || connection.model,
    ...chatTokens(completion.usage),
  });
  const answer = completion.choices?.[0]?.message;
  const raw =
    answer?.tool_calls?.find((call) => call.function?.name === tool.name)?.function?.arguments ??
    // A service that ignores `tool_choice` may still answer with the JSON as text.
    answer?.content?.match(/\{[\s\S]*\}/)?.[0];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

// ── Pictures ─────────────────────────────────────────────────────────────

/** Generating one picture may take this long – FLUX queues it, gpt-image takes its time. */
const IMAGE_TIMEOUT_MS = 3 * 60_000;
/** How often Black Forest Labs is asked whether a picture is ready. */
const BFL_POLL_MS = 1000;
/** A generated picture, fetched from where the service left it, may be this big. */
const MAX_IMAGE_BYTES = 20 * 1024 ** 2;

/** The rough shape a picture is generated in – cut to its frame afterwards. */
export type ImageShape = 'square' | 'landscape' | 'portrait';

/** OpenAI's sizes per model family; services speaking its API mostly take gpt-image's. */
function openAiSize(model: string, shape: ImageShape): string {
  if (/dall-e-2/i.test(model)) return '1024x1024';
  if (/dall-e-3/i.test(model)) {
    return { square: '1024x1024', landscape: '1792x1024', portrait: '1024x1792' }[shape];
  }
  return { square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536' }[shape];
}

/** FLUX takes width and height (multiples of 16), Kontext an aspect ratio. */
const BFL_SIZES: Record<ImageShape, { width: number; height: number; aspect_ratio: string }> = {
  square: { width: 1024, height: 1024, aspect_ratio: '1:1' },
  landscape: { width: 1440, height: 816, aspect_ratio: '16:9' },
  portrait: { width: 816, height: 1440, aspect_ratio: '9:16' },
};

const openAiImageSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().nullish(), url: z.string().nullish() })).min(1),
});
const bflTaskSchema = z.object({ id: z.string(), polling_url: z.string().nullish() });
const bflResultSchema = z.object({
  status: z.string(),
  result: z.object({ sample: z.string().nullish() }).nullish(),
});

/** A picture the service left at an address: fetched like any link – public https only. */
async function fetchGenerated(
  deps: Pick<AppDeps, 'aiFetch'>,
  address: string,
): Promise<Uint8Array> {
  const { aiFetch } = deps;
  try {
    // `aiFetch` stands in for the network (tests): there is no address to check.
    const { response } = aiFetch
      ? { response: await aiFetch(address, { redirect: 'error' }) }
      : await safeFetch(new URL(address), { fetch, lookup: dnsLookup, maxBytes: MAX_IMAGE_BYTES });
    if (!response.ok) throw new ProviderHttpError(502, 'Das Bild war nicht abrufbar.', null);
    return await readBodyCapped(response, MAX_IMAGE_BYTES);
  } catch (error) {
    if (error instanceof ProviderHttpError) throw error;
    throw new ProviderUnreachable(error instanceof Error ? error.message : String(error));
  }
}

/**
 * One picture from `prompt`, as the service sends it (PNG, JPEG or WebP): through OpenAI's
 * `/images/generations`, or Black Forest Labs' own API – a task asked about until it is ready.
 */
export async function generateImage(
  deps: Pick<AppDeps, 'config' | 'aiFetch'>,
  connection: AiConnection,
  prompt: string,
  shape: ImageShape,
  options: { signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  const picture = await generatePicture(deps, connection, prompt, shape, options);
  connection.meter?.({ feature: 'image', model: connection.model, images: 1 });
  return picture;
}

async function generatePicture(
  deps: Pick<AppDeps, 'config' | 'aiFetch'>,
  connection: AiConnection,
  prompt: string,
  shape: ImageShape,
  options: { signal?: AbortSignal },
): Promise<Uint8Array> {
  const timeout = AbortSignal.timeout(IMAGE_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  if (connection.provider === 'black-forest-labs') {
    const { width, height, aspect_ratio } = BFL_SIZES[shape];
    const task = await requestJson(
      deps,
      connection,
      `/${encodeURIComponent(connection.model)}`,
      {
        method: 'POST',
        body: /kontext/i.test(connection.model)
          ? { prompt, aspect_ratio, output_format: 'jpeg' }
          : { prompt, width, height, output_format: 'jpeg' },
        signal,
      },
      bflTaskSchema,
    );
    // Asked where it says – another region of the same service, perhaps.
    const base = (connection.baseUrl ?? PROVIDER_BASE_URLS['black-forest-labs'] ?? '').replace(
      /\/+$/,
      '',
    );
    const polling = task.polling_url ? new URL(task.polling_url) : null;
    const where =
      polling && polling.href.startsWith(`${base}/`)
        ? { connection, path: polling.href.slice(base.length) }
        : polling && polling.protocol === 'https:' && /(^|\.)bfl\.ai$/.test(polling.hostname)
          ? {
              connection: { ...connection, baseUrl: polling.origin },
              path: `${polling.pathname}${polling.search}`,
            }
          : { connection, path: `/get_result?id=${encodeURIComponent(task.id)}` };
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, BFL_POLL_MS));
      if (signal.aborted) throw new ProviderUnreachable('Das Bild kam nicht rechtzeitig.');
      const result = await requestJson(
        deps,
        where.connection,
        where.path,
        { method: 'GET', signal },
        bflResultSchema,
      );
      if (result.status === 'Ready') {
        if (!result.result?.sample) {
          throw new ProviderHttpError(502, 'Die Antwort enthielt kein Bild.', null);
        }
        return fetchGenerated(deps, result.result.sample);
      }
      if (/moderated/i.test(result.status)) {
        throw new ApiError(
          400,
          'bad_request',
          'Der Inhaltsfilter des Dienstes hat das Bild abgelehnt – bitte die Beschreibung ändern.',
        );
      }
      if (result.status !== 'Pending') {
        throw new ProviderHttpError(502, `Das Bild ging nicht: ${result.status}`, null);
      }
    }
  }
  const gptImage = /gpt-image/i.test(connection.model);
  const body = await requestJson(
    deps,
    connection,
    '/images/generations',
    {
      method: 'POST',
      body: {
        model: connection.model,
        prompt,
        n: 1,
        size: openAiSize(connection.model, shape),
        // gpt-image always answers in base64 and refuses the parameter; the others are asked.
        ...(gptImage ? { output_format: 'jpeg' } : { response_format: 'b64_json' }),
      },
      signal,
    },
    openAiImageSchema,
  );
  const [first] = body.data;
  if (first?.b64_json) return new Uint8Array(Buffer.from(first.b64_json, 'base64'));
  if (first?.url) return fetchGenerated(deps, first.url);
  throw new ProviderHttpError(502, 'Die Antwort enthielt kein Bild.', null);
}
