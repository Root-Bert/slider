import {
  PROVIDER_LABELS,
  SERVER_PROVIDER,
  defaultQuickModel,
  type InheritedIntegration,
  type IntegrationKind,
} from '@slider/shared';
import { useInheritedModels, useSetInheritedModel, useUpdateIntegrationKey } from '@/lib/api';
import { Badge, Button, ErrorText, Select, Spinner, type ShowToast } from '@/ui';
import { AI_MODEL_ROLES } from '../lib/ai-models';
import { ModelLine } from './ModelLine';
import { ProviderLogo } from './ProviderLogo';
import { RoleModelSelect } from './RoleModelSelect';

/**
 * The instance's default as a row beside the workspace's own keys, laid out like one of them and
 * chosen like one: active while no own key is, „Aktiv setzen“ sets the active own key aside.
 * Where the instance lets the workspace pick the model of its key (`pickModel`), the row picks it.
 */
export function InstanceRow({
  workspaceId,
  kind,
  inherited,
  activeKeyId,
  choosable,
  pickModel,
  onNotify,
}: {
  workspaceId: string;
  kind: IntegrationKind;
  inherited: InheritedIntegration;
  /** The workspace's own active key; `null` while the instance's applies. */
  activeKeyId: string | null;
  /** Whether there is anything to choose between – else no „Aktiv“ to tell apart. */
  choosable: boolean;
  pickModel: boolean;
  onNotify: ShowToast;
}) {
  const update = useUpdateIntegrationKey(workspaceId);
  const setModel = useSetInheritedModel(workspaceId);
  // Seen from a workspace, the instance's self-hosted service runs on the instance's server.
  const name =
    inherited.provider === SERVER_PROVIDER
      ? 'Auf dem Instanz-Server'
      : PROVIDER_LABELS[inherited.provider];
  const models = useInheritedModels(workspaceId, kind, pickModel);
  const offered = models.data?.models ?? [];
  const options = [
    {
      value: '',
      label: `${offered.find((m) => m.id === inherited.defaultModel)?.name ?? inherited.defaultModel} (Standard der Instanz)`,
    },
    ...offered
      .filter((model) => model.id !== inherited.defaultModel)
      .map((model) => ({ value: model.id, label: model.name })),
  ];
  // Until the service answered: the current pick at least.
  if (
    inherited.model !== inherited.defaultModel &&
    !offered.some((m) => m.id === inherited.model)
  ) {
    options.push({ value: inherited.model, label: inherited.model });
  }
  const error = update.error ?? setModel.error;
  const nameOf = (id: string) => offered.find((m) => m.id === id)?.name ?? id;
  // The AI's second model, to create decks on: without one, the first.
  const isAi = kind === 'ai';
  const createStandard = inherited.defaultCreateModel ?? inherited.model;
  const createModel = inherited.createModel ?? inherited.model;
  // Quick requests: the instance's model for them, else Haiku on Anthropic, else the first.
  const quickStandard =
    inherited.defaultQuickModel ?? defaultQuickModel(inherited.provider, inherited.model);
  const quickModel = inherited.quickModel ?? quickStandard;

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <ProviderLogo provider={inherited.provider} size={18} className="text-fg" />
        <span className="text-body font-medium text-fg">{name}</span>
        <Badge>Von der Instanz</Badge>
        {choosable && !activeKeyId && <Badge tone="success">Aktiv</Badge>}
        {activeKeyId && (
          <Button
            size="xs"
            variant="soft"
            className="ml-auto"
            loading={update.isPending}
            onClick={() =>
              update.mutate(
                { keyId: activeKeyId, active: false },
                { onSuccess: () => onNotify('Der Key der Instanz ist jetzt aktiv') },
              )
            }
          >
            Aktiv setzen
          </Button>
        )}
      </div>
      {inherited.model && (
        <ModelLine role={isAi ? 'review' : null}>
          {pickModel ? (
            <>
              <Select
                aria-label={
                  isAi
                    ? `Modell für ${AI_MODEL_ROLES.review.label} mit dem Key der Instanz`
                    : 'Modell für den Key der Instanz'
                }
                size="sm"
                value={inherited.model === inherited.defaultModel ? '' : inherited.model}
                disabled={setModel.isPending}
                options={options}
                onChange={(model) =>
                  setModel.mutate(
                    { kind, model: model || null },
                    {
                      onSuccess: () =>
                        onNotify(
                          `Der Key der Instanz nutzt hier jetzt ${model || inherited.defaultModel}`,
                        ),
                    },
                  )
                }
              />
              {models.isFetching && !models.data && (
                <Spinner size="sm" label="Modelle werden geladen" />
              )}
            </>
          ) : (
            <span className="text-fg">{inherited.model}</span>
          )}
        </ModelLine>
      )}
      {isAi && inherited.model && (
        <ModelLine role="create">
          {pickModel ? (
            <RoleModelSelect
              role="create"
              where="mit dem Key der Instanz"
              offered={offered}
              standard={createStandard}
              standardLabel={
                inherited.defaultCreateModel
                  ? `${nameOf(inherited.defaultCreateModel)} (Standard der Instanz)`
                  : `Wie oben (${nameOf(inherited.model)})`
              }
              current={createModel === createStandard ? null : createModel}
              disabled={setModel.isPending}
              onPick={(model) =>
                setModel.mutate(
                  { kind, createModel: model },
                  {
                    onSuccess: () =>
                      onNotify(
                        `${AI_MODEL_ROLES.create.label} nutzt hier jetzt ${nameOf(model ?? createStandard)}`,
                      ),
                  },
                )
              }
            />
          ) : (
            <span className="text-fg">{createModel}</span>
          )}
        </ModelLine>
      )}
      {isAi && inherited.model && (
        <ModelLine role="quick">
          {pickModel ? (
            <RoleModelSelect
              role="quick"
              where="mit dem Key der Instanz"
              offered={offered}
              standard={quickStandard}
              standardLabel={
                inherited.defaultQuickModel
                  ? `${nameOf(inherited.defaultQuickModel)} (Standard der Instanz)`
                  : quickStandard === inherited.model
                    ? `Wie oben (${nameOf(inherited.model)})`
                    : `${nameOf(quickStandard)} (Standard)`
              }
              current={quickModel === quickStandard ? null : quickModel}
              disabled={setModel.isPending}
              onPick={(model) =>
                setModel.mutate(
                  { kind, quickModel: model },
                  {
                    onSuccess: () =>
                      onNotify(
                        `${AI_MODEL_ROLES.quick.label} nutzen hier jetzt ${nameOf(model ?? quickStandard)}`,
                      ),
                  },
                )
              }
            />
          ) : (
            <span className="text-fg">{quickModel}</span>
          )}
        </ModelLine>
      )}
      {error && <ErrorText>{error.message}</ErrorText>}
      {models.isError && (
        <ErrorText>Die Modelle ließen sich nicht laden: {models.error.message}</ErrorText>
      )}
    </li>
  );
}
