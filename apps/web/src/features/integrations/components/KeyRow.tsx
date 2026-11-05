import { useState } from 'react';
import { SERVER_PROVIDER, type IntegrationKey } from '@slider/shared';
import { useIntegrationModels, useRemoveIntegrationKey, useUpdateIntegrationKey } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorText,
  IconButton,
  Notice,
  Select,
  Spinner,
  type ShowToast,
} from '@/ui';
import { serviceName } from '../lib/providers';
import { AI_MODEL_ROLES, createModelOptions } from '../lib/ai-models';
import { ModelLine } from './ModelLine';
import { ProviderLogo } from './ProviderLogo';

/**
 * One stored key: its service, model and state – set active (or no longer use it), another
 * model, remove. `workspaceId` `null`: the instance's. `fallback`: what applies once it is no
 * longer used (the instance's) – a row of its own then, set active instead of this one.
 */
export function KeyRow({
  workspaceId,
  apiKey: key,
  fallback,
  onNotify,
}: {
  workspaceId: string | null;
  apiKey: IntegrationKey;
  fallback: string | null;
  onNotify: ShowToast;
}) {
  const update = useUpdateIntegrationKey(workspaceId);
  const remove = useRemoveIntegrationKey(workspaceId);
  const [removing, setRemoving] = useState(false);
  const hasModel = key.kind !== 'photos';
  // Asked of the service right away (cached a while): the list is there when it is opened.
  const models = useIntegrationModels(workspaceId, key.id, hasModel);
  const name = serviceName(key);
  const options = models.data?.models.some((model) => model.id === key.model)
    ? models.data.models
    : [{ id: key.model, name: key.model }, ...(models.data?.models ?? [])];
  const nameOf = (id: string) => options.find((model) => model.id === id)?.name ?? id;
  // The AI's second model, to create decks on: none of its own runs on the first.
  const isAi = key.kind === 'ai';
  const pending = (field: 'active' | 'recheck') =>
    update.isPending && update.variables?.[field] !== undefined;
  const toggle = key.active ? (
    !fallback && (
      <Button
        size="xs"
        variant="ghost"
        loading={pending('active')}
        onClick={() =>
          update.mutate(
            { keyId: key.id, active: false },
            { onSuccess: () => onNotify(`${name} ist nicht mehr aktiv`) },
          )
        }
      >
        Nicht mehr nutzen
      </Button>
    )
  ) : (
    <Button
      size="xs"
      variant="soft"
      loading={pending('active')}
      onClick={() =>
        update.mutate(
          { keyId: key.id, active: true },
          { onSuccess: () => onNotify(`${name} ist jetzt aktiv`) },
        )
      }
    >
      Aktiv setzen
    </Button>
  );

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <ProviderLogo provider={key.provider} size={18} className="text-fg" />
        <span className="text-body font-medium text-fg">{name}</span>
        {/* Self-hosted: where it answers – and maybe no key at all. */}
        {key.provider === SERVER_PROVIDER && key.baseUrl && (
          <code className="text-body text-fg-muted">{key.baseUrl}</code>
        )}
        {key.hint ? (
          <code className="text-body text-fg-muted">{key.hint}</code>
        ) : (
          <Badge>Ohne Key</Badge>
        )}
        {key.error ? (
          <Badge tone="warning">Pausiert</Badge>
        ) : key.active ? (
          <Badge tone="success">Aktiv</Badge>
        ) : null}
        <span className="text-xs text-fg-subtle">
          von {key.setByName}, {formatDateTime(key.setAt)}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {/* Without a model there is no second line to hold it. */}
          {!hasModel && toggle}
          <IconButton
            icon="delete"
            label="Key entfernen"
            size="sm"
            onClick={() => setRemoving(true)}
          />
        </span>
      </div>
      {hasModel && (
        <ModelLine role={isAi ? 'review' : null} end={toggle}>
          <Select
            aria-label={
              isAi ? `Modell für ${AI_MODEL_ROLES.review.label} mit ${name}` : `Modell für ${name}`
            }
            size="sm"
            value={key.model}
            disabled={update.isPending}
            // Until the service answered (or when it does not): just the current one.
            options={options.map((model) => ({ value: model.id, label: model.name }))}
            onChange={(model) =>
              update.mutate(
                { keyId: key.id, model },
                { onSuccess: () => onNotify(`${name} nutzt jetzt ${model}`) },
              )
            }
          />
          {models.isFetching && !models.data && (
            <Spinner size="sm" label="Modelle werden geladen" />
          )}
        </ModelLine>
      )}
      {isAi && (
        <ModelLine role="create">
          <Select
            aria-label={`Modell für ${AI_MODEL_ROLES.create.label} mit ${name}`}
            size="sm"
            value={key.createModel ?? ''}
            disabled={update.isPending}
            options={createModelOptions(
              models.data?.models ?? [],
              `Wie oben (${nameOf(key.model)})`,
              key.model,
              key.createModel,
            )}
            onChange={(model) =>
              update.mutate(
                { keyId: key.id, createModel: model || null },
                {
                  onSuccess: () =>
                    onNotify(
                      `${AI_MODEL_ROLES.create.label} nutzt jetzt ${nameOf(model || key.model)}`,
                    ),
                },
              )
            }
          />
        </ModelLine>
      )}
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
              loading={pending('recheck')}
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
        title={key.hint ? 'API-Key entfernen?' : `${name} entfernen?`}
        description={`${key.active ? (fallback ? `Danach gilt wieder ${fallback}. ` : 'Danach ist das aus, bis ihr einen anderen Key aktiv setzt. ') : ''}${key.hint ? `Bei ${name} bleibt der Key gültig – löscht ihn dort, wenn ihr ihn nicht mehr braucht.` : 'Der Dienst selbst läuft weiter.'}`}
        confirmLabel="Entfernen"
        confirmIcon="delete"
        pending={remove.isPending}
        error={remove.error?.message}
        onConfirm={() =>
          remove.mutate(key.id, {
            onSuccess: () => {
              setRemoving(false);
              onNotify(key.hint ? 'API-Key entfernt' : `${name} entfernt`);
            },
          })
        }
      />
    </li>
  );
}
