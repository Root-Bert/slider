import {
  INTEGRATION_KIND_LABELS,
  INTEGRATION_KINDS,
  PROVIDER_LABELS,
  type InheritedIntegration,
  type IntegrationKey,
  type IntegrationKind,
  type IntegrationRule,
  type IntegrationProvider,
} from '@slider/shared';
import type { IconName } from '@/ui';

/** Where each service hands out keys; a service of one's own says so itself. */
export const KEY_PAGES: Partial<Record<IntegrationProvider, string>> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/apikey',
  mistral: 'https://console.mistral.ai/api-keys',
  scaleway: 'https://console.scaleway.com/iam/api-keys',
  't-systems': 'https://apikey.llmhub.t-systems.net',
  'black-forest-labs': 'https://dashboard.bfl.ai',
  unsplash: 'https://unsplash.com/oauth/applications',
  pexels: 'https://www.pexels.com/api/',
};

export const KEY_PLACEHOLDERS: Record<IntegrationProvider, string> = {
  anthropic: 'sk-ant-api03-…',
  openai: 'sk-proj-…',
  gemini: 'AIza…',
  mistral: 'API-Key von Mistral',
  'aleph-alpha': 'API-Token von Aleph Alpha',
  scaleway: 'Secret Key von Scaleway',
  't-systems': 'API-Key des LLM Hub',
  'black-forest-labs': 'API-Key von Black Forest Labs',
  custom: 'API-Key des Dienstes',
  'self-hosted': 'Leer, wenn keiner nötig ist',
  unsplash: 'Access Key der Unsplash-App',
  pexels: 'API-Key von Pexels',
};

/** What each kind is for – a little different for the instance, which sets it for everyone. */
export const KINDS: Record<
  IntegrationKind,
  /** `models`: which of a service's models fit – it lists all of them, also ones that do not. */
  { icon: IconName; workspace: string; instance: string; models?: string }
> = {
  ai: {
    icon: 'autoAwesome',
    workspace:
      'Das Modell, mit dem die KI beim Bearbeiten Folien ändert, kommentiert und auf Fragen antwortet. Abgerechnet wird über den aktiven Key; die Folien und der Kommentar gehen dafür an seinen Anbieter.',
    instance:
      'Das Modell, mit dem die KI in allen Workspaces Folien ändert, kommentiert und auf Fragen antwortet – solange ein Workspace kein eigenes nutzt. Abgerechnet wird über den aktiven Key; die Folien und der Kommentar gehen dafür an seinen Anbieter.',
  },
  speech: {
    icon: 'notesMic',
    workspace:
      'Wer Sprachaufnahmen in Text umwandelt. Die Aufnahmen gehen dafür an den Anbieter des aktiven Keys.',
    instance:
      'Wer in allen Workspaces Sprachaufnahmen in Text umwandelt. Die Aufnahmen gehen dafür an den Anbieter des aktiven Keys.',
    models:
      'Passend sind Modelle, die Aufnahmen in Text umwandeln – meist mit „transcribe“ oder „whisper“ im Namen. Ein größeres schreibt genauer, auf Tempo kommt es hier wenig an. Nicht geeignet: „realtime“ (Live-Streaming) und „tts“ (Sprachausgabe).',
  },
  voice: {
    icon: 'mic',
    workspace:
      'Wer beim Sprechen mit der KI live mitschreibt – jede Sekunde zählt, ein schneller Dienst (z. B. Mistral) passt hier besser als ein selbst gehosteter. Ohne aktiven Key hier nimmt es den von „Sprache zu Text“. Das Gesprochene geht dafür an den Anbieter des Keys.',
    instance:
      'Wer in allen Workspaces beim Sprechen mit der KI live mitschreibt – jede Sekunde zählt, ein schneller Dienst (z. B. Mistral) passt hier besser als ein selbst gehosteter. Ohne Key hier nimmt es den von „Sprache zu Text“. Das Gesprochene geht dafür an den Anbieter des Keys.',
    models:
      'Passend sind Modelle, die Aufnahmen in Text umwandeln – meist mit „transcribe“ oder „whisper“ im Namen. Ein kleines, schnelles reicht, z. B. „voxtral-mini-transcribe“. Nicht geeignet: „realtime“ (das ist für die Live-Mitschrift – hier gehen kurze Stücke hin) und „tts“ (Sprachausgabe).',
  },
  live: {
    icon: 'subtitles',
    workspace:
      'Zeigt beim Sprechen mit der KI Wort für Wort, was gerade verstanden wird – noch während du sprichst. Nur zur Anzeige: was daraus wird, entscheidet weiter „Sprechen mit der KI“. Ohne Key erscheint der Text erst nach jeder Pause. Das Mikrofon geht dafür direkt an den Anbieter des Keys.',
    instance:
      'Zeigt in allen Workspaces beim Sprechen mit der KI Wort für Wort, was gerade verstanden wird – noch während man spricht. Nur zur Anzeige: was daraus wird, entscheidet weiter „Sprechen mit der KI“. Ohne Key erscheint der Text erst nach jeder Pause. Das Mikrofon geht dafür direkt an den Anbieter des Keys.',
    models:
      'Passend sind nur Live-Modelle – mit „realtime“ im Namen, z. B. „voxtral-mini-transcribe-realtime-3“.',
  },
  photos: {
    icon: 'image',
    workspace:
      'Wo der Editor und die KI Fotos für Folien finden. Fotos laden direkt vom Dienst; jedes nennt Fotograf:in und Dienst.',
    instance:
      'Wo in allen Workspaces der Editor und die KI Fotos für Folien finden. Fotos laden direkt vom Dienst; jedes nennt Fotograf:in und Dienst.',
  },
  images: {
    icon: 'draw',
    workspace:
      'Wer Bilder für Folien aus einer Beschreibung erzeugt. Die Beschreibung geht dafür an den Anbieter des aktiven Keys.',
    instance:
      'Wer in allen Workspaces Bilder für Folien aus einer Beschreibung erzeugt. Die Beschreibung geht dafür an den Anbieter des aktiven Keys.',
  },
};

/** A key's service by name: the provider, or the host of a service of one's own. */
export function serviceName(key: Pick<IntegrationKey, 'provider' | 'baseUrl'>): string {
  if (key.provider !== 'custom' || !key.baseUrl) return PROVIDER_LABELS[key.provider];
  try {
    return new URL(key.baseUrl).host;
  } catch {
    return PROVIDER_LABELS.custom;
  }
}

/** The panel's sections, for the nav at the side – each `integration-<kind>`. */
export const INTEGRATIONS_NAV = INTEGRATION_KINDS.map((kind) => ({
  id: `integration-${kind}`,
  title: INTEGRATION_KIND_LABELS[kind],
  icon: KINDS[kind].icon,
}));

/** The workspace's own first section, before the kinds: what its AI is called. */
export const AI_NAME_SECTION = {
  id: 'integration-name',
  title: 'Name der KI',
  icon: 'person',
} as const satisfies { id: string; title: string; icon: IconName };

/** A workspace's nav: its AI's name, then the kinds – the instance has no name to give. */
export const WORKSPACE_INTEGRATIONS_NAV = [AI_NAME_SECTION, ...INTEGRATIONS_NAV];

/** „Anthropic · claude-sonnet-5-5“ – what applies from the instance (or the server). */
export const describeInherited = (inherited: InheritedIntegration) =>
  [PROVIDER_LABELS[inherited.provider], inherited.model].filter(Boolean).join(' · ');

/** „Key der Instanz, Modell frei, eigene Keys erlaubt“ – a rule in words, for toasts. */
export const ruleSummary = (kind: IntegrationKind, rule: IntegrationRule) =>
  [
    rule.inherit === 'none'
      ? 'ohne Key der Instanz'
      : kind === 'photos' || rule.inherit === 'all'
        ? 'Key der Instanz'
        : 'Key der Instanz, Modell frei',
    rule.ownKeys ? 'eigene Keys erlaubt' : 'keine eigenen Keys',
  ].join(', ');
