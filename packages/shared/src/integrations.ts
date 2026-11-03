import { z } from 'zod';

// ── Integrations ─────────────────────────────────────────────────────────

/*
 * The services Slider works with, each with an API key of the customer's: the AI's models,
 * speech to text, the photos to search and pictures generated. The instance admin sets them once for every
 * workspace and says, per kind – for all workspaces, and for single ones apart –, whether a
 * workspace may store its own and what of the instance's it takes over. Keys are checked with
 * their service, kept sealed and never sent to a browser.
 */

/**
 * `speech`: recordings (memos) to text – a self-hosted Whisper does; `voice`: speaking to the AI,
 * live while the person speaks – a fast service's key (Mistral, …); without one, `speech`'s;
 * `live`: the words shown as they are spoken, streamed to a realtime model (Mistral's) – only
 * shown, what is said still goes through `voice`.
 */
export const INTEGRATION_KINDS = ['ai', 'speech', 'voice', 'live', 'photos', 'images'] as const;
export const integrationKindSchema = z.enum(INTEGRATION_KINDS);
export type IntegrationKind = z.infer<typeof integrationKindSchema>;

/** The kinds that turn speech into text – the same services and models. */
export const isSpeechKind = (kind: IntegrationKind): kind is 'speech' | 'voice' =>
  kind === 'speech' || kind === 'voice';

export const INTEGRATION_KIND_LABELS: Record<IntegrationKind, string> = {
  ai: 'Allgemeines Modell',
  speech: 'Sprache zu Text',
  voice: 'Sprechen mit der KI',
  live: 'Live-Mitschrift',
  photos: 'Bildquellen',
  images: 'Bildgenerierung',
};

/**
 * Who runs the AI: Anthropic, OpenAI, Google (Gemini), Mistral, Aleph Alpha, the European clouds
 * (Scaleway, T-Systems – both speaking OpenAI's API) – or any service
 * that speaks OpenAI's API at an address of its own (OpenRouter, Azure, Ollama, …).
 */
export const AI_PROVIDERS = [
  'anthropic',
  'openai',
  'gemini',
  'mistral',
  'aleph-alpha',
  'scaleway',
  't-systems',
  'custom',
] as const;
export const aiProviderSchema = z.enum(AI_PROVIDERS);
export type AiProvider = z.infer<typeof aiProviderSchema>;

/**
 * Speech to text hosted by the customer (deploy/stt or any Whisper speaking OpenAI's API): its
 * address and model, a key only where it asks for one – the recordings stay in-house.
 * `SPEECH_URL` in the server's environment is taken over as one of the instance's.
 */
export const SERVER_PROVIDER = 'self-hosted';

/** Who turns speech into text – all through OpenAI's `/audio/transcriptions`. */
export const SPEECH_PROVIDERS = [
  SERVER_PROVIDER,
  'openai',
  'mistral',
  'scaleway',
  'custom',
] as const;
export type SpeechProvider = (typeof SPEECH_PROVIDERS)[number];

/**
 * Who streams speech to text while it is spoken – over a WebSocket of the service's own, the
 * browser connecting with a short-lived token the server gets for it.
 */
export const LIVE_PROVIDERS = ['mistral'] as const;

/**
 * Who generates pictures: Black Forest Labs (FLUX, its own API) – the others through OpenAI's
 * `/images/generations`.
 */
export const IMAGE_PROVIDERS = ['black-forest-labs', 'openai', 'gemini', 'custom'] as const;
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];

/** Where the editor and the AI find photos. */
export const PHOTO_PROVIDERS = ['unsplash', 'pexels'] as const;
export const photoProviderSchema = z.enum(PHOTO_PROVIDERS);
export type PhotoProvider = z.infer<typeof photoProviderSchema>;

export const INTEGRATION_PROVIDERS = {
  ai: AI_PROVIDERS,
  speech: SPEECH_PROVIDERS,
  voice: SPEECH_PROVIDERS,
  live: LIVE_PROVIDERS,
  photos: PHOTO_PROVIDERS,
  images: IMAGE_PROVIDERS,
} as const satisfies Record<IntegrationKind, readonly string[]>;

export type IntegrationProvider = AiProvider | SpeechProvider | PhotoProvider | ImageProvider;
export const integrationProviderSchema = z.enum([
  ...new Set<IntegrationProvider>([
    ...AI_PROVIDERS,
    ...SPEECH_PROVIDERS,
    ...PHOTO_PROVIDERS,
    ...IMAGE_PROVIDERS,
  ]),
] as [IntegrationProvider, ...IntegrationProvider[]]);
/** The services asked with a model – all but the photo search. */
export type ModelProvider = Exclude<IntegrationProvider, PhotoProvider>;

export const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  mistral: 'Mistral AI',
  'aleph-alpha': 'Aleph Alpha',
  scaleway: 'Scaleway',
  't-systems': 'T-Systems',
  'black-forest-labs': 'Black Forest Labs',
  custom: 'OpenAI-kompatibel',
  'self-hosted': 'Selbst gehostet',
  unsplash: 'Unsplash',
  pexels: 'Pexels',
};
/**
 * Services at an address that may differ per customer: Aleph Alpha runs on premises too
 * (PhariaAI); Black Forest Labs answers in the EU unless its global address is given.
 * Prefilled with the usual one, changeable.
 */
export const PROVIDER_BASE_URLS: Partial<Record<IntegrationProvider, string>> = {
  'aleph-alpha': 'https://api.aleph-alpha.com',
  'black-forest-labs': 'https://api.eu.bfl.ai/v1',
};

/** Whether a key comes with an address: `custom` and self-hosted need one, some may change theirs. */
export function providerAddress(provider: IntegrationProvider): 'required' | 'optional' | 'none' {
  if (provider === 'custom' || provider === SERVER_PROVIDER) return 'required';
  return PROVIDER_BASE_URLS[provider] ? 'optional' : 'none';
}

/** One stored key; per kind and place, the active one is used. */
export const integrationKeySchema = z.object({
  id: z.string(),
  kind: integrationKindSchema,
  provider: integrationProviderSchema,
  /** The service's address – for `custom`, or one changed from the usual. */
  baseUrl: z.string().nullable(),
  /** `sk-…AbCd` – all that is shown of the key; empty where there is none (self-hosted). */
  hint: z.string(),
  /** The model it runs on (AI, speech, pictures); empty for photos. */
  model: z.string(),
  active: z.boolean(),
  setByName: z.string(),
  setAt: z.iso.datetime(),
  /** Why the service refused it last; `null` while it works. */
  error: z.string().nullable(),
});
export type IntegrationKey = z.infer<typeof integrationKeySchema>;

/**
 * What a workspace takes over of the instance's active key: the key with its model, the key on a
 * model of its own choosing (`key`), or nothing. Photos have no model: `key` is `all` there.
 */
export const INTEGRATION_INHERITS = ['all', 'key', 'none'] as const;
export const integrationInheritSchema = z.enum(INTEGRATION_INHERITS);
export type IntegrationInherit = z.infer<typeof integrationInheritSchema>;

/** The instance's rule for a kind – for all workspaces, or for one apart. */
export const integrationRuleSchema = z.object({
  /** Whether the workspace may store keys of its own. */
  ownKeys: z.boolean(),
  inherit: integrationInheritSchema,
});
export type IntegrationRule = z.infer<typeof integrationRuleSchema>;

/** Until the instance says otherwise: own keys allowed, the instance's taken over as it is. */
export const DEFAULT_INTEGRATION_RULE: IntegrationRule = { ownKeys: true, inherit: 'all' };

/** A workspace the instance treats apart for a kind. */
export const integrationExceptionSchema = z.object({
  workspaceId: z.string(),
  name: z.string(),
  rule: integrationRuleSchema,
  /**
   * The model the instance runs its active key on there – fixed, or where the workspace picks
   * one, its default. `null`: the key's own.
   */
  model: z.string().nullable(),
});
export type IntegrationException = z.infer<typeof integrationExceptionSchema>;

/** What applies where nothing is set: for a workspace the instance's active key (as the rule lets it). */
export const inheritedIntegrationSchema = z.object({
  provider: integrationProviderSchema,
  /** The model it runs on here – the workspace's pick, where it may pick one. */
  model: z.string(),
  /** The instance's model for it. */
  defaultModel: z.string(),
});
export type InheritedIntegration = z.infer<typeof inheritedIntegrationSchema>;

export const integrationAreaSchema = z.object({
  kind: integrationKindSchema,
  /** Newest first. A workspace that may not store its own gets none of its keys here. */
  keys: z.array(integrationKeySchema),
  /** Instance: the rule for all workspaces. Workspace: the one that applies to it. */
  rule: integrationRuleSchema,
  /** Instance: the workspaces treated apart, by name. Workspace: empty. */
  exceptions: z.array(integrationExceptionSchema),
  inherited: inheritedIntegrationSchema.nullable(),
});
export type IntegrationArea = z.infer<typeof integrationAreaSchema>;

/** `GET /instance/integrations`, `GET /workspaces/:id/integrations` */
export const integrationsSchema = z.object({
  areas: z.object({
    ai: integrationAreaSchema,
    speech: integrationAreaSchema,
    voice: integrationAreaSchema,
    live: integrationAreaSchema,
    photos: integrationAreaSchema,
    images: integrationAreaSchema,
  }),
  /** The workspace's AI by name (`KI` until named); `null` for the instance. */
  aiName: z.string().nullable(),
});
export type Integrations = z.infer<typeof integrationsSchema>;

/** `PATCH /workspaces/:id/ai` – the AI's name; empty gives it back its default. */
export const updateWorkspaceAiInputSchema = z.object({
  name: z.string().trim().max(40, 'Höchstens 40 Zeichen.'),
});
export type UpdateWorkspaceAiInput = z.infer<typeof updateWorkspaceAiInputSchema>;

/**
 * `PATCH /instance/integrations/:kind` – the rule for all workspaces (`workspaceId` `null`), or
 * for one apart; `rule` `null` gives that one back to the rule for all.
 */
export const updateIntegrationPolicyInputSchema = z
  .object({
    workspaceId: z.string().min(1).nullable().default(null),
    rule: integrationRuleSchema.nullable(),
    /** A workspace apart: the model of the instance's active key there; `null` its own. */
    model: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .superRefine((input, context) => {
    if (input.model !== undefined && !input.workspaceId) {
      context.addIssue({
        code: 'custom',
        message: 'Ein eigenes Modell gibt es nur für einzelne Workspaces.',
        path: ['model'],
      });
    }
    if (!input.rule && !input.workspaceId) {
      context.addIssue({ code: 'custom', message: 'Die Regel für alle fehlt.', path: ['rule'] });
    }
    if (input.rule && !input.rule.ownKeys && input.rule.inherit === 'none') {
      context.addIssue({
        code: 'custom',
        message: 'Ohne eigene Keys und ohne den der Instanz hätte der Workspace nichts.',
        path: ['rule'],
      });
    }
  });
export type UpdateIntegrationPolicyInput = z.input<typeof updateIntegrationPolicyInputSchema>;

/**
 * `PUT /workspaces/:id/integrations/instance/:kind/model` – the model the workspace runs the
 * instance's key on, where the rule lets it pick; `null`: the instance's.
 */
export const setInheritedModelInputSchema = z.object({
  model: z.string().trim().min(1).max(200).nullable(),
});
export type SetInheritedModelInput = z.infer<typeof setInheritedModelInputSchema>;

/** `GET …/integrations/keys/:keyId/models` – what the key may run on, newest first. */
export const aiModelListSchema = z.object({
  models: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type AiModelList = z.infer<typeof aiModelListSchema>;

/** `POST …/integrations/keys` – a key, checked with its service before it is stored. */
export const addIntegrationKeyInputSchema = z
  .object({
    kind: integrationKindSchema,
    provider: integrationProviderSchema,
    /** Self-hosted: empty where the service asks for none. */
    apiKey: z.string().trim().max(400).default(''),
    baseUrl: z.string().trim().max(500).nullable().default(null),
  })
  .superRefine((input, context) => {
    const issue = (message: string, path: 'apiKey' | 'baseUrl' | 'provider' = 'apiKey') =>
      context.addIssue({ code: 'custom', message, path: [path] });
    if (!(INTEGRATION_PROVIDERS[input.kind] as readonly string[]).includes(input.provider)) {
      issue('Diesen Anbieter gibt es dafür nicht.', 'provider');
    }
    const keyless = input.provider === SERVER_PROVIDER && input.apiKey === '';
    if (!keyless && input.apiKey.length < 8) issue('Das ist kein gültiger API-Key.');
    if (/\s/.test(input.apiKey)) issue('Der Key enthält Leerzeichen – bitte nochmal kopieren.');
    if (input.provider === 'anthropic') {
      if (!input.apiKey.startsWith('sk-ant-')) {
        issue('Das ist kein Anthropic-API-Key (er beginnt mit „sk-ant-“).');
      } else if (input.apiKey.startsWith('sk-ant-admin')) {
        issue('Das ist ein Admin-Key. Bitte einen normalen API-Key anlegen.');
      }
    }
    const address = providerAddress(input.provider);
    if (address === 'none' || (address === 'optional' && !input.baseUrl)) return;
    const url = URL.canParse(input.baseUrl ?? '') ? new URL(input.baseUrl!) : null;
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
      issue(
        address === 'required'
          ? `Bitte die Adresse des Dienstes angeben, z. B. ${input.provider === SERVER_PROVIDER ? 'http://stt:8000/v1' : 'https://openrouter.ai/api/v1'}.`
          : 'Das ist keine gültige Adresse.',
        'baseUrl',
      );
    } else if (/[?#]/.test(input.baseUrl!) || url.username || url.password) {
      // Paths are appended to it: a `?` would turn them into a query and reach any path.
      issue('Bitte nur die Adresse angeben – ohne „?“, „#“ oder Zugangsdaten darin.', 'baseUrl');
    }
  });
export type AddIntegrationKeyInput = z.infer<typeof addIntegrationKeyInputSchema>;

/**
 * `PATCH …/integrations/keys/:keyId` – make it the active one (or none: the instance's applies),
 * or pick its model.
 */
export const updateIntegrationKeyInputSchema = z
  .object({
    active: z.boolean().optional(),
    model: z.string().trim().min(1).max(200).optional(),
    /** A refused key asked again – e.g. once the account was topped up. */
    recheck: z.literal(true).optional(),
  })
  .refine(
    (input) =>
      input.active !== undefined || input.model !== undefined || input.recheck !== undefined,
  );
export type UpdateIntegrationKeyInput = z.infer<typeof updateIntegrationKeyInputSchema>;
