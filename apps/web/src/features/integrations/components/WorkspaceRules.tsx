import { useState, type ReactNode } from 'react';
import {
  defaultQuickModel,
  type IntegrationArea,
  type IntegrationKey,
  type IntegrationKind,
  type IntegrationRule,
} from '@slider/shared';
import { useInstanceWorkspaces, useIntegrationModels, useSetIntegrationPolicy } from '@/lib/api';
import {
  Button,
  ErrorText,
  Icon,
  IconButton,
  SegmentedControl,
  Select,
  Subsection,
  TextField,
  type ShowToast,
} from '@/ui';
import { ruleSummary } from '../lib/providers';
import { AI_MODEL_ROLES } from '../lib/ai-models';
import { RoleModelSelect } from './RoleModelSelect';

/**
 * The instance's rules of a kind: one for all workspaces, below it single workspaces treated
 * apart – each the same two rows: the key (the instance's or not, own ones or not) and the model
 * of the instance's key (the instance's, or picked by the workspace). For a workspace apart the
 * instance may set that model too. Removed, a workspace goes back to the rule for all.
 * `hasKey`: whether the instance has something active to hand on at all.
 */
export function WorkspaceRules({
  area,
  hasKey,
  onNotify,
}: {
  area: IntegrationArea;
  hasKey: boolean;
  onNotify: ShowToast;
}) {
  const policy = useSetIntegrationPolicy();
  const [adding, setAdding] = useState(false);
  const { kind, exceptions } = area;
  // The instance's active key – its models are what a workspace apart may be set to.
  const activeKey = area.keys.find((key) => key.active);
  const save = (
    workspaceId: string | null,
    rule: IntegrationRule | null,
    done: string,
    models?: Models,
  ) =>
    policy.mutate(
      { kind, workspaceId, rule, ...models },
      {
        onSuccess: () => onNotify(done),
        onError: (error) => onNotify(error.message, 'danger'),
      },
    );
  // Someone relies on the instance's key – but it has none active.
  const missing =
    !hasKey &&
    [area.rule, ...exceptions.map((exception) => exception.rule)].some((rule) => !rule.ownKeys);

  return (
    <Subsection
      title="Was Workspaces nutzen dürfen"
      collapsible
      description="Gilt für alle Workspaces – einzelne lassen sich darunter abweichend einstellen."
      className="border-t border-hairline pt-4"
    >
      <Entry name="Alle Workspaces" icon>
        <RuleGrid
          kind={kind}
          rule={area.rule}
          disabled={policy.isPending}
          onChange={(rule) => save(null, rule, `Alle Workspaces: ${ruleSummary(kind, rule)}`)}
          model={activeKey && area.rule.inherit === 'all' && <KeyModel apiKey={activeKey} />}
        />
      </Entry>
      {missing && (
        <p className="flex items-start gap-1.5 text-sm text-fg-muted">
          <Icon name="info" size={16} className="mt-0.5 shrink-0 text-fg-subtle" />
          Die Instanz hat noch keinen Key aktiv – Workspaces ohne eigene Keys haben das bis dahin
          nicht.
        </p>
      )}

      <div className="flex flex-col gap-2 pt-2">
        <h4 className="text-sm font-semibold text-fg">Abweichend pro Workspace</h4>
        {exceptions.length === 0 && !adding && (
          <p className="text-sm text-fg-subtle">
            Noch keiner – etwa damit ein Workspace sein Modell selbst wählt oder eigene Keys
            ergänzen darf.
          </p>
        )}
        {exceptions.map((exception) => (
          <Entry
            key={exception.workspaceId}
            name={exception.name}
            onReset={() =>
              save(exception.workspaceId, null, `${exception.name} folgt wieder „Alle Workspaces“`)
            }
            disabled={policy.isPending}
          >
            <RuleGrid
              kind={kind}
              rule={exception.rule}
              disabled={policy.isPending}
              onChange={(rule) =>
                save(exception.workspaceId, rule, `${exception.name}: ${ruleSummary(kind, rule)}`)
              }
              model={
                activeKey && (
                  <ModelPick
                    name={exception.name}
                    apiKey={activeKey}
                    model={exception.model}
                    createModel={exception.createModel}
                    quickModel={exception.quickModel}
                    free={exception.rule.inherit === 'key'}
                    disabled={policy.isPending}
                    onChange={(models, label) =>
                      save(
                        exception.workspaceId,
                        exception.rule,
                        models.createModel !== undefined
                          ? `${exception.name}: ${AI_MODEL_ROLES.create.label} nutzt jetzt ${label}`
                          : models.quickModel !== undefined
                            ? `${exception.name}: ${AI_MODEL_ROLES.quick.label} nutzen jetzt ${label}`
                            : exception.rule.inherit === 'key'
                              ? `${exception.name} startet jetzt mit ${label}`
                              : `${exception.name} nutzt jetzt ${label}`,
                        models,
                      )
                    }
                  />
                )
              }
            />
          </Entry>
        ))}
        {adding ? (
          <PickWorkspace
            skip={exceptions.map((exception) => exception.workspaceId)}
            onPick={(workspace) => {
              setAdding(false);
              // Starts as the rule for all; its rows change it.
              save(
                workspace.id,
                area.rule,
                `${workspace.name} lässt sich jetzt abweichend einstellen`,
              );
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <div>
            <Button size="sm" variant="ghost" icon="add" onClick={() => setAdding(true)}>
              Workspace hinzufügen
            </Button>
          </div>
        )}
      </div>
    </Subsection>
  );
}

/** One rule's card: who it is for – a workspace apart with the way back to the rule for all. */
function Entry({
  name,
  icon = false,
  onReset,
  disabled = false,
  children,
}: {
  name: string;
  icon?: boolean;
  onReset?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-control bg-surface-1 p-3">
      <div className="flex min-h-7 items-center gap-2">
        {icon && <Icon name="person" size={16} className="shrink-0 text-fg-subtle" />}
        <span className="min-w-0 flex-1 truncate text-body font-medium text-fg">{name}</span>
        {onReset && (
          <IconButton
            icon="close"
            label={`${name} wieder wie alle Workspaces`}
            size="compact"
            disabled={disabled}
            onClick={onReset}
          />
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * The two rows of a rule. Key: whether the workspace gets the instance's, and whether it may add
 * its own – never neither. Model (not for photos): the instance's, or the workspace picks; beside
 * it `model`, the model that applies or its start.
 */
function RuleGrid({
  kind,
  rule,
  disabled,
  onChange,
  model,
}: {
  kind: IntegrationKind;
  rule: IntegrationRule;
  disabled: boolean;
  onChange: (rule: IntegrationRule) => void;
  model?: ReactNode;
}) {
  const inherits = rule.inherit !== 'none';
  return (
    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-3">
      <span className={ROW_LABEL}>Key</span>
      <div className="flex min-h-9 flex-wrap items-center gap-x-6 gap-y-2">
        <Labeled caption="Von der Instanz">
          <SegmentedControl
            label="Key von der Instanz"
            size="sm"
            track="soft"
            value={inherits ? 'yes' : 'no'}
            segments={[
              { value: 'yes', label: 'Ja', disabled },
              {
                value: 'no',
                label: 'Nein',
                disabled: disabled || !rule.ownKeys,
                ...(!rule.ownKeys && { title: 'Ohne eigene Keys braucht es den der Instanz.' }),
              },
            ]}
            onChange={(value) => onChange({ ...rule, inherit: value === 'yes' ? 'all' : 'none' })}
          />
        </Labeled>
        <Labeled caption="Eigene ergänzen">
          <SegmentedControl
            label="Eigene Keys ergänzen"
            size="sm"
            track="soft"
            value={rule.ownKeys ? 'yes' : 'no'}
            segments={[
              { value: 'yes', label: 'Ja', disabled },
              {
                value: 'no',
                label: 'Nein',
                disabled: disabled || !inherits,
                ...(!inherits && { title: 'Ohne den Key der Instanz braucht es eigene.' }),
              },
            ]}
            onChange={(value) => onChange({ ...rule, ownKeys: value === 'yes' })}
          />
        </Labeled>
      </div>
      {kind !== 'photos' && (
        <>
          <span className={ROW_LABEL}>Modell</span>
          <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2">
            {inherits ? (
              <>
                <SegmentedControl
                  label="Modell des Instanz-Keys"
                  size="sm"
                  track="soft"
                  value={rule.inherit === 'key' ? 'key' : 'all'}
                  segments={[
                    { value: 'all', label: 'Von der Instanz', disabled },
                    { value: 'key', label: 'Selbst wählen', disabled },
                  ]}
                  onChange={(inherit) => onChange({ ...rule, inherit })}
                />
                {model}
              </>
            ) : (
              <span className="text-sm text-fg-subtle">
                Mit eigenem Key wählt der Workspace es selbst.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Level with the first line of controls beside it, however many lines they wrap to. */
const ROW_LABEL = 'flex h-9 items-center text-sm font-medium text-fg-muted';

function Labeled({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-sm text-fg-muted">
      {caption}
      {children}
    </span>
  );
}

/** The instance's key's own model by name – what „Von der Instanz“ means for all. */
function KeyModel({ apiKey: key }: { apiKey: IntegrationKey }) {
  // Shared with the key's own row above: asked once.
  const models = useIntegrationModels(null, key.id, true);
  const nameOf = (id: string) => models.data?.models.find((each) => each.id === id)?.name ?? id;
  return (
    <span className="text-sm text-fg-subtle">
      {nameOf(key.model)}
      {key.kind === 'ai' &&
        key.createModel &&
        `, ${AI_MODEL_ROLES.create.label}: ${nameOf(key.createModel)}`}
      {key.kind === 'ai' &&
        key.quickModel &&
        `, ${AI_MODEL_ROLES.quick.label}: ${nameOf(key.quickModel)}`}
    </span>
  );
}

/**
 * The model of the instance's key in a workspace apart – fixed there, or (`free`) the one it
 * starts on until it picks its own. Empty: the key's own, as for all. The AI's models to create
 * decks on and for quick requests beside it, alike.
 */
function ModelPick({
  name,
  apiKey: key,
  model,
  createModel,
  quickModel,
  free,
  disabled,
  onChange,
}: {
  name: string;
  apiKey: IntegrationKey;
  model: string | null;
  createModel: string | null;
  quickModel: string | null;
  free: boolean;
  disabled: boolean;
  onChange: (models: Models, label: string) => void;
}) {
  const models = useIntegrationModels(null, key.id, true);
  const offered = models.data?.models ?? [];
  const nameOf = (id: string) => offered.find((each) => each.id === id)?.name ?? id;
  const options = [
    { value: '', label: `${nameOf(key.model)} (wie alle)` },
    ...offered
      .filter((each) => each.id !== key.model)
      .map((each) => ({ value: each.id, label: each.name })),
  ];
  // Until the service answered: the current one at least.
  if (model && !offered.some((each) => each.id === model)) {
    options.push({ value: model, label: model });
  }
  const isAi = key.kind === 'ai';
  // Decks are created on the key's own for that, else on the model it runs on there.
  const createStandard = key.createModel ?? model ?? key.model;
  // Quick requests on the key's own for them, else Haiku on Anthropic, else the model there.
  const quickStandard = key.quickModel ?? defaultQuickModel(key.provider, model ?? key.model);
  const pick = (
    <Select
      className="min-w-0"
      aria-label={
        free
          ? `Modell, mit dem ${name} startet`
          : isAi
            ? `Modell für ${AI_MODEL_ROLES.review.label} in ${name}`
            : `Modell für ${name}`
      }
      size="sm"
      value={model ?? ''}
      disabled={disabled}
      options={options}
      onChange={(value) => onChange({ model: value || null }, nameOf(value || key.model))}
    />
  );
  return (
    <span className="flex min-w-0 flex-col gap-2 text-sm text-fg-muted">
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        {free ? 'Startet mit' : isAi && `${AI_MODEL_ROLES.review.label}:`}
        {pick}
      </span>
      {isAi && (
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          {AI_MODEL_ROLES.create.label}:
          <RoleModelSelect
            className="min-w-0"
            role="create"
            where={`in ${name}`}
            offered={offered}
            standard={createStandard}
            standardLabel={key.createModel ? `${nameOf(key.createModel)} (wie alle)` : 'Wie oben'}
            current={createModel}
            disabled={disabled}
            onPick={(value) => onChange({ createModel: value }, nameOf(value ?? createStandard))}
          />
        </span>
      )}
      {isAi && (
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          {AI_MODEL_ROLES.quick.label}:
          <RoleModelSelect
            className="min-w-0"
            role="quick"
            where={`in ${name}`}
            offered={offered}
            standard={quickStandard}
            standardLabel={
              key.quickModel
                ? `${nameOf(key.quickModel)} (wie alle)`
                : quickStandard === (model ?? key.model)
                  ? 'Wie oben'
                  : `${nameOf(quickStandard)} (Standard)`
            }
            current={quickModel}
            disabled={disabled}
            onPick={(value) => onChange({ quickModel: value }, nameOf(value ?? quickStandard))}
          />
        </span>
      )}
      {models.isError && (
        <ErrorText>Die Modelle ließen sich nicht laden: {models.error.message}</ErrorText>
      )}
    </span>
  );
}

/** The models of the instance's key set for a workspace apart; `null`: the key's own. */
type Models = { model?: string | null; createModel?: string | null; quickModel?: string | null };

/** A workspace found by name – those already apart left out. */
function PickWorkspace({
  skip,
  onPick,
  onCancel,
}: {
  skip: string[];
  onPick: (workspace: { id: string; name: string }) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState('');
  const list = useInstanceWorkspaces(q.trim(), 0);
  const found = (list.data?.workspaces ?? []).filter((workspace) => !skip.includes(workspace.id));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <TextField
          label="Workspace suchen"
          value={q}
          autoFocus
          placeholder="Name"
          onChange={(event) => setQ(event.target.value)}
          className="min-w-0 flex-1"
        />
        <Button size="field" variant="ghost" className="mt-[22px]" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
      {list.isError && <ErrorText>{list.error.message}</ErrorText>}
      {list.data && found.length === 0 && (
        <p className="text-sm text-fg-subtle">Kein weiterer Workspace gefunden.</p>
      )}
      <ul className="flex flex-col">
        {found.slice(0, 6).map((workspace) => (
          <li key={workspace.id}>
            <button
              type="button"
              className="w-full rounded-control px-3 py-2 text-left text-body text-fg transition-colors hover:bg-surface-1"
              onClick={() => onPick(workspace)}
            >
              {workspace.name}
              {workspace.joinDomain && (
                <span className="ml-2 text-sm text-fg-subtle">{workspace.joinDomain}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
