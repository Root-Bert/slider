import { useState } from 'react';
import {
  AI_PROVIDER_LABELS,
  AI_PROVIDERS,
  addWorkspaceAiKeyInputSchema,
  type AiProvider,
  type Workspace,
  type WorkspaceAiKey,
} from '@slider/shared';
import {
  useAddWorkspaceAiKey,
  useRemoveWorkspaceAiKey,
  useUpdateWorkspaceAiKey,
  useWorkspaceAi,
  useWorkspaceAiModels,
} from '@/lib/api';
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorText,
  IconButton,
  LoadingState,
  Notice,
  Section,
  Select,
  Spinner,
  TextField,
  TextLink,
  type ShowToast,
} from '@/ui';
import { formatDateTime } from '@/lib/format';

/** Where each provider hands out keys; a custom service says so itself. */
const KEY_PAGES: Partial<Record<AiProvider, string>> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/apikey',
};

const KEY_PLACEHOLDERS: Record<AiProvider, string> = {
  anthropic: 'sk-ant-api03-…',
  openai: 'sk-proj-…',
  gemini: 'AIza…',
  custom: 'API-Key des Dienstes',
};

/** A key's service by name: the provider, or the custom service's host. */
function serviceName(key: Pick<WorkspaceAiKey, 'provider' | 'baseUrl'>): string {
  if (key.provider !== 'custom' || !key.baseUrl) return AI_PROVIDER_LABELS[key.provider];
  try {
    return new URL(key.baseUrl).host;
  } catch {
    return AI_PROVIDER_LABELS.custom;
  }
}

/**
 * The workspace's AI (BER-183): admins store API keys – Anthropic, OpenAI, Google Gemini or a
 * service speaking OpenAI's API – and set one active, with its model; then every member can let
 * the AI propose changes to slides while editing. Slider checks each key with its provider and
 * keeps it encrypted; only its start and end are shown.
 */
export function WorkspaceAiSection({
  workspace,
  onNotify,
}: {
  workspace: Workspace;
  onNotify: ShowToast;
}) {
  const admin = workspace.role === 'admin';
  const ai = useWorkspaceAi(workspace.id, admin);
  const [adding, setAdding] = useState(false);
  if (!admin) return null;
  const keys = ai.data?.keys ?? [];
  const anyActive = keys.some((key) => key.active);

  return (
    <Section
      title="KI im Workspace"
      description="Hinterlegt API-Keys von Anthropic, OpenAI, Google Gemini oder einem OpenAI-kompatiblen Dienst – einer ist aktiv. Dann kann jedes Mitglied beim Bearbeiten die KI Änderungen an Folien vorschlagen lassen, ohne selbst etwas einzurichten. Abgerechnet wird über euren Key; die Folien und der Kommentar gehen dafür an den Anbieter des aktiven Keys."
    >
      {ai.isError ? (
        <ErrorText>{ai.error.message}</ErrorText>
      ) : !ai.data ? (
        <LoadingState padding="sm" />
      ) : (
        <div className="flex flex-col gap-4">
          {keys.length > 0 && !anyActive && (
            <Notice tone="warning" variant="plain" size="sm" title="Kein Key aktiv">
              Die KI ist aus, bis ihr einen Key aktiv setzt.
            </Notice>
          )}
          {keys.length > 0 && (
            <ul className="flex flex-col divide-y divide-hairline">
              {keys.map((key) => (
                <KeyRow key={key.id} workspaceId={workspace.id} apiKey={key} onNotify={onNotify} />
              ))}
            </ul>
          )}
          {keys.length === 0 || adding ? (
            <KeyForm
              workspaceId={workspace.id}
              onDone={(activated) => {
                setAdding(false);
                onNotify(
                  activated
                    ? 'API-Key gespeichert – die KI ist aktiv'
                    : 'API-Key gespeichert – setzt ihn aktiv, um ihn zu nutzen',
                );
              }}
              onCancel={keys.length > 0 ? () => setAdding(false) : undefined}
            />
          ) : (
            <div>
              <Button size="field" variant="secondary" icon="add" onClick={() => setAdding(true)}>
                Key hinzufügen
              </Button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

/** One stored key: its service, model and state – set active, another model, remove. */
function KeyRow({
  workspaceId,
  apiKey: key,
  onNotify,
}: {
  workspaceId: string;
  apiKey: WorkspaceAiKey;
  onNotify: ShowToast;
}) {
  const update = useUpdateWorkspaceAiKey(workspaceId);
  const remove = useRemoveWorkspaceAiKey(workspaceId);
  const [removing, setRemoving] = useState(false);
  // Asked of the provider right away (cached a while): the list is there when it is opened.
  const models = useWorkspaceAiModels(workspaceId, key.id, true);
  const name = serviceName(key);
  const options = models.data?.models.some((model) => model.id === key.model)
    ? models.data.models
    : [{ id: key.model, name: key.model }, ...(models.data?.models ?? [])];

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body font-medium text-fg">{name}</span>
        <code className="text-body text-fg-muted">{key.hint}</code>
        {key.error ? (
          <Badge tone="warning">Pausiert</Badge>
        ) : key.active ? (
          <Badge tone="success">Aktiv</Badge>
        ) : null}
        <span className="text-xs text-fg-subtle">
          von {key.setByName}, {formatDateTime(key.setAt)}
        </span>
        <IconButton
          icon="delete"
          label="Key entfernen"
          size="sm"
          className="ml-auto"
          onClick={() => setRemoving(true)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
        Modell:
        <Select
          aria-label={`Modell für ${name}`}
          size="sm"
          value={key.model}
          disabled={update.isPending}
          // Until the provider answered (or when it does not): just the current one.
          options={options.map((model) => ({ value: model.id, label: model.name }))}
          onChange={(model) =>
            update.mutate(
              { keyId: key.id, model },
              { onSuccess: () => onNotify(`Die KI nutzt jetzt ${model}`) },
            )
          }
        />
        {models.isFetching && !models.data && <Spinner size="sm" label="Modelle werden geladen" />}
        {!key.active && (
          <Button
            size="xs"
            variant="soft"
            className="ml-auto"
            loading={update.isPending && update.variables?.active === true}
            onClick={() =>
              update.mutate(
                { keyId: key.id, active: true },
                { onSuccess: () => onNotify(`${name} ist jetzt die KI des Workspace`) },
              )
            }
          >
            Aktiv setzen
          </Button>
        )}
      </div>
      {update.error && <ErrorText>{update.error.message}</ErrorText>}
      {models.isError && !key.error && (
        <ErrorText>Die Modelle ließen sich nicht laden: {models.error.message}</ErrorText>
      )}
      {key.error && (
        <Notice tone="warning" variant="plain" size="sm" title={`${name} nimmt keine Aufträge an`}>
          {key.error} Danach den Key erneut prüfen – oder einen neuen hinterlegen, der übernimmt.
          <div className="mt-2">
            <Button
              size="xs"
              variant="soft"
              loading={update.isPending && update.variables?.recheck === true}
              onClick={() =>
                update.mutate(
                  { keyId: key.id, recheck: true },
                  {
                    onSuccess: () =>
                      onNotify(
                        `${name} antwortet wieder – fehlt noch Guthaben, pausiert der Key beim nächsten Auftrag erneut`,
                      ),
                  },
                )
              }
            >
              Erneut prüfen
            </Button>
          </div>
        </Notice>
      )}
      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        title="API-Key entfernen?"
        description={`${key.active ? 'Die KI des Workspace ist danach aus, bis ihr einen anderen Key aktiv setzt. ' : ''}Bei ${name} bleibt der Key gültig – löscht ihn dort, wenn ihr ihn nicht mehr braucht.`}
        confirmLabel="Entfernen"
        confirmIcon="delete"
        pending={remove.isPending}
        error={remove.error?.message}
        onConfirm={() =>
          remove.mutate(key.id, {
            onSuccess: () => {
              setRemoving(false);
              onNotify('API-Key entfernt');
            },
          })
        }
      />
    </li>
  );
}

function KeyForm({
  workspaceId,
  onDone,
  onCancel,
}: {
  workspaceId: string;
  /** `activated`: it became the active key. */
  onDone: (activated: boolean) => void;
  onCancel?: () => void;
}) {
  const save = useAddWorkspaceAiKey(workspaceId);
  const [provider, setProvider] = useState<AiProvider>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [errors, setErrors] = useState<{ apiKey?: string; baseUrl?: string }>({});
  const keyPage = KEY_PAGES[provider];
  const custom = provider === 'custom';

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = addWorkspaceAiKeyInputSchema.safeParse({
          provider,
          apiKey,
          baseUrl: custom ? baseUrl : null,
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
          onSuccess: (ai) => {
            setApiKey('');
            setBaseUrl('');
            onDone(
              ai.keys.find((key) => key.hint.endsWith(parsed.data.apiKey.slice(-4)))?.active ??
                false,
            );
          },
          onError: (failure) => setErrors({ apiKey: failure.message }),
        });
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
        Anbieter
        <Select
          value={provider}
          onChange={(next) => {
            setProvider(next);
            setErrors({});
          }}
          options={AI_PROVIDERS.map((value) => ({ value, label: AI_PROVIDER_LABELS[value] }))}
          className="max-w-xs"
        />
      </label>
      {custom && (
        <TextField
          label="Adresse des Dienstes"
          placeholder="https://openrouter.ai/api/v1"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          error={errors.baseUrl}
          hint="Bis vor „/chat/completions“ – z. B. OpenRouter, Mistral, Azure oder ein eigener Server mit OpenAI-kompatibler Schnittstelle."
        />
      )}
      <TextField
        label="API-Key"
        type="password"
        autoComplete="new-password"
        placeholder={KEY_PLACEHOLDERS[provider]}
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        error={errors.apiKey}
        hint={`Slider prüft den Key bei ${custom ? 'dem Dienst' : AI_PROVIDER_LABELS[provider]}, wählt ein passendes Modell und speichert ihn verschlüsselt. Angezeigt wird danach nur sein Ende.`}
      />
      {keyPage && (
        <TextLink href={keyPage} target="_blank" rel="noreferrer" className="self-start text-sm">
          Key bei {AI_PROVIDER_LABELS[provider]} anlegen
        </TextLink>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          size="field"
          loading={save.isPending}
          disabled={!apiKey.trim() || (custom && !baseUrl.trim())}
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
