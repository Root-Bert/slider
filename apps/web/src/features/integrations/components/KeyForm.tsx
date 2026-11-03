import { useState } from 'react';
import {
  addIntegrationKeyInputSchema,
  INTEGRATION_PROVIDERS,
  PROVIDER_BASE_URLS,
  PROVIDER_LABELS,
  providerAddress,
  SERVER_PROVIDER,
  type IntegrationKind,
  type IntegrationProvider,
  isSpeechKind,
} from '@slider/shared';
import { useAddIntegrationKey } from '@/lib/api';
import { Button, cn, TextField, TextLink } from '@/ui';
import { KEY_PAGES, KEY_PLACEHOLDERS } from '../lib/providers';
import { ProviderLogo } from './ProviderLogo';

/**
 * A new key: its service picked by its mark, then the key – and the address, where the service
 * has one of its own (a service speaking OpenAI's API) or may differ (Aleph Alpha on
 * premises). Checked with the service before it is stored.
 */
export function KeyForm({
  workspaceId,
  kind,
  onDone,
  onCancel,
}: {
  workspaceId: string | null;
  kind: IntegrationKind;
  /** `activated`: it became the active key. */
  onDone: (activated: boolean) => void;
  onCancel?: () => void;
}) {
  const save = useAddIntegrationKey(workspaceId);
  const providers = INTEGRATION_PROVIDERS[kind];
  const [provider, setProvider] = useState<IntegrationProvider>(providers[0]);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [errors, setErrors] = useState<{ apiKey?: string; baseUrl?: string }>({});
  const keyPage = KEY_PAGES[provider];
  const address = providerAddress(provider);
  const label = PROVIDER_LABELS[provider];
  const selfHosted = provider === SERVER_PROVIDER;
  const named = provider === 'custom' || selfHosted ? 'dem Dienst' : label;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = addIntegrationKeyInputSchema.safeParse({
          kind,
          provider,
          apiKey,
          baseUrl: address === 'none' ? null : baseUrl.trim() || null,
        });
        if (!parsed.success) {
          const next: { apiKey?: string; baseUrl?: string } = {};
          for (const issue of parsed.error.issues) {
            const field = issue.path[0] === 'baseUrl' ? 'baseUrl' : 'apiKey';
            next[field] ??= issue.message;
          }
          setErrors(next);
          return;
        }
        setErrors({});
        save.mutate(parsed.data, {
          onSuccess: (integrations) => {
            setApiKey('');
            setBaseUrl('');
            // Newest first: the first of its service with its key's end is the one just stored.
            onDone(
              integrations.areas[kind].keys.find(
                (key) =>
                  key.provider === parsed.data.provider &&
                  key.hint.endsWith(parsed.data.apiKey.slice(-4)),
              )?.active ?? false,
            );
          },
          onError: (failure) => setErrors({ apiKey: failure.message }),
        });
      }}
    >
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium text-fg">Anbieter</legend>
        <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {providers.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === provider}
              onClick={() => {
                setProvider(option);
                setErrors({});
              }}
              className={cn(
                'flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-control border px-2 py-2.5 text-center text-xs text-fg-muted transition-colors',
                option === provider
                  ? 'border-border-focus bg-selected text-fg'
                  : 'border-hairline hover:bg-hover hover:text-fg',
              )}
            >
              <ProviderLogo provider={option} size={22} className="text-fg" />
              {PROVIDER_LABELS[option]}
            </button>
          ))}
        </div>
      </fieldset>
      {address !== 'none' && (
        <TextField
          label={address === 'required' ? 'Adresse des Dienstes' : 'Adresse (optional)'}
          placeholder={
            PROVIDER_BASE_URLS[provider] ??
            (selfHosted ? 'http://stt:8000/v1' : 'https://openrouter.ai/api/v1')
          }
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          error={errors.baseUrl}
          hint={
            address === 'required'
              ? selfHosted
                ? 'Bis vor „/audio/transcriptions“ – z. B. der Whisper-Dienst aus deploy/stt. Die Aufnahmen verlassen euer Netz nicht.'
                : isSpeechKind(kind)
                  ? 'Bis vor „/audio/transcriptions“ – ein Dienst mit OpenAI-kompatibler Schnittstelle.'
                  : kind === 'images'
                    ? 'Bis vor „/images/generations“ – ein Dienst mit OpenAI-kompatibler Schnittstelle.'
                    : 'Bis vor „/chat/completions“ – z. B. OpenRouter, Azure oder ein eigener Server mit OpenAI-kompatibler Schnittstelle.'
              : provider === 'black-forest-labs'
                ? `Leer: ${PROVIDER_BASE_URLS[provider]} – Rechenzentren in der EU. Weltweit: https://api.bfl.ai/v1.`
                : `Leer: ${PROVIDER_BASE_URLS[provider]}. Für eine eigene Installation deren Adresse.`
          }
        />
      )}
      <TextField
        label={selfHosted ? 'API-Key (optional)' : 'API-Key'}
        type="password"
        autoComplete="new-password"
        placeholder={KEY_PLACEHOLDERS[provider]}
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        error={errors.apiKey}
        hint={
          selfHosted
            ? 'Nur falls der Dienst einen verlangt. Slider fragt ihn nach seinen Modellen und wählt ein passendes.'
            : `Slider prüft den Key bei ${named}${kind === 'photos' ? '' : ', wählt ein passendes Modell'} und speichert ihn verschlüsselt. Angezeigt wird danach nur sein Ende.`
        }
      />
      {keyPage && (
        <TextLink href={keyPage} target="_blank" rel="noreferrer" className="self-start text-sm">
          Key bei {label} anlegen
        </TextLink>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          size="field"
          loading={save.isPending}
          disabled={(!selfHosted && !apiKey.trim()) || (address === 'required' && !baseUrl.trim())}
        >
          {save.isPending ? 'Wird geprüft …' : 'Speichern'}
        </Button>
        {onCancel && (
          <Button size="field" variant="ghost" onClick={onCancel}>
            Abbrechen
          </Button>
        )}
      </div>
    </form>
  );
}
