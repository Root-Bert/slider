import { useState } from 'react';
import {
  CALL_MODELS,
  DEFAULT_AI_NAME,
  MAX_AI_NAME_LENGTH,
  INTEGRATION_KIND_LABELS,
  INTEGRATION_KINDS,
  updateWorkspaceAiInputSchema,
  type CallModel,
  type IntegrationArea,
  type IntegrationKind,
} from '@slider/shared';
import { useIntegrations, useUpdateWorkspaceAi } from '@/lib/api';
import {
  Button,
  ErrorText,
  Icon,
  LoadingState,
  Notice,
  Section,
  Select,
  TextField,
  Toggle,
  type ShowToast,
} from '@/ui';
import { AppModelsOverview } from './components/AppModels';
import { AI_MODEL_ROLES } from './lib/ai-models';
import { InstanceRow } from './components/InstanceRow';
import { KeyForm } from './components/KeyForm';
import { KeyRow } from './components/KeyRow';
import { WorkspaceRules } from './components/WorkspaceRules';
import {
  AI_NAME_SECTION,
  CALL_NOTES_SECTION,
  describeInherited,
  INTEGRATION_GROUPS,
  KINDS,
  type IntegrationGroup,
} from './lib/providers';

/** Kinds that work without a key of their own – the form does not open by itself for them. */
const OPTIONAL: ReadonlySet<IntegrationKind> = new Set(['voice', 'live']);

/**
 * The integrations – a workspace's name for its AI first, then the AI's model, speech to text, photos – of a workspace, or of the instance
 * (`workspaceId` `null`). The instance stores keys for every workspace and sets per kind a rule –
 * for all workspaces, and for single ones apart: own keys or not, and what of its key they take
 * over. A workspace sees what the instance gives it, and stores its own where it may. Admins only
 * (workspace: its admins; instance: the instance admin). `group`: only that part – the AI, what is
 * spoken, what is pictured; without one, all of it on one page (the setup).
 */
export function IntegrationsPanel({
  workspaceId,
  group,
  onNotify,
}: {
  workspaceId: string | null;
  group?: IntegrationGroup;
  onNotify: ShowToast;
}) {
  const integrations = useIntegrations(workspaceId);
  if (integrations.isError) return <ErrorText>{integrations.error.message}</ErrorText>;
  if (!integrations.data) return <LoadingState padding="lg" />;
  const { areas, aiName, callNotes, callModel } = integrations.data;
  const kinds: readonly IntegrationKind[] = group
    ? INTEGRATION_GROUPS[group].kinds
    : INTEGRATION_KINDS;
  return (
    <>
      {workspaceId && aiName !== null && (!group || group === 'ki') && (
        <Section
          {...AI_NAME_SECTION}
          description="So heißt die KI in Kommentaren und bei den Personen in einer Präsentation."
        >
          <NameForm workspaceId={workspaceId} name={aiName} onNotify={onNotify} />
        </Section>
      )}
      {workspaceId && callNotes !== null && (!group || group === 'ki') && (
        <Section
          {...CALL_NOTES_SECTION}
          description="In jedem Anruf in einer Unterhaltung schreibt ein Agent mit und antwortet, wenn man ihn anspricht. Danach stehen Notizen, Beschlüsse und Aufgaben beim Anruf. Er braucht einen Key für Live-Mitschrift (Sprache) und einen für die KI."
        >
          <CallNotesToggle workspaceId={workspaceId} on={callNotes} onNotify={onNotify} />
          {callModel !== null && (
            <CallModelSelect workspaceId={workspaceId} model={callModel} onNotify={onNotify} />
          )}
        </Section>
      )}
      {kinds.map((kind) => (
        <AreaSection key={kind} workspaceId={workspaceId} area={areas[kind]} onNotify={onNotify} />
      ))}
    </>
  );
}

/** One kind: what applies, the keys stored here, a new one – for the instance, its rules. */
function AreaSection({
  workspaceId,
  area,
  onNotify,
}: {
  workspaceId: string | null;
  area: IntegrationArea;
  onNotify: ShowToast;
}) {
  const [adding, setAdding] = useState(false);
  const { kind, keys, inherited, rule } = area;
  const instance = workspaceId === null;
  // A workspace the instance lets store no keys of its own only sees what applies.
  const editable = instance || rule.ownKeys;
  const anyActive = keys.some((key) => key.active);
  const fallback = inherited ? describeInherited(inherited) : null;

  return (
    <Section
      id={`integration-${kind}`}
      title={INTEGRATION_KIND_LABELS[kind]}
      icon={KINDS[kind].icon}
      description={instance ? KINDS[kind].instance : KINDS[kind].workspace}
    >
      <div className="flex flex-col gap-4">
        {kind === 'ai' && <AppModelsOverview />}
        <Applies area={area} instance={instance} anyActive={anyActive} />
        {KINDS[kind].models && ((editable && keys.length > 0) || inherited) && (
          <p className="flex gap-1.5 text-xs text-fg-subtle">
            <Icon name="info" size={14} className="mt-px shrink-0" />
            {KINDS[kind].models}
          </p>
        )}
        {((editable && keys.length > 0) || inherited) && (
          <ul className="flex flex-col divide-y divide-hairline">
            {inherited && workspaceId && (
              <InstanceRow
                workspaceId={workspaceId}
                kind={kind}
                inherited={inherited}
                activeKeyId={editable ? (keys.find((key) => key.active)?.id ?? null) : null}
                choosable={editable && keys.length > 0}
                pickModel={!instance && rule.inherit === 'key'}
              />
            )}
            {editable &&
              keys.map((key) => (
                <KeyRow
                  key={key.id}
                  workspaceId={workspaceId}
                  apiKey={key}
                  fallback={fallback}
                  onNotify={onNotify}
                />
              ))}
          </ul>
        )}
        {!instance && !rule.ownKeys && inherited && (
          <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
            <Icon name="lock" size={14} />
            Eigene Keys erlaubt hier nur der Instanz-Admin.
          </p>
        )}
        {editable &&
          (adding || (keys.length === 0 && !inherited && !OPTIONAL.has(kind)) ? (
            <KeyForm
              workspaceId={workspaceId}
              kind={kind}
              onDone={() => setAdding(false)}
              onCancel={
                keys.length > 0 || inherited || OPTIONAL.has(kind)
                  ? () => setAdding(false)
                  : undefined
              }
            />
          ) : (
            <div>
              <Button size="field" variant="secondary" icon="add" onClick={() => setAdding(true)}>
                {instance || keys.length > 0 || !inherited
                  ? 'Key hinzufügen'
                  : 'Eigenen Key hinzufügen'}
              </Button>
            </div>
          ))}
        {instance && (
          <WorkspaceRules area={area} hasKey={anyActive || !!inherited} onNotify={onNotify} />
        )}
      </div>
    </Section>
  );
}

/** What applies here, when it does not come from a key of this place – or no key is active. */
function Applies({
  area,
  instance,
  anyActive,
}: {
  area: IntegrationArea;
  instance: boolean;
  anyActive: boolean;
}) {
  const { inherited, keys, rule } = area;

  // Speaking to the AI without a key of its own: recordings' speech to text does it.
  if (area.kind === 'voice' && !anyActive && !inherited) {
    return (
      <Notice tone="neutral" variant="plain" size="sm" title="Nimmt „Sprache zu Text“">
        {keys.length > 0
          ? 'Kein Key aktiv – bis ihr einen aktiv setzt, schreibt der Key von „Sprache zu Text“ mit.'
          : 'Bis hier ein Key hinterlegt ist, schreibt der Key von „Sprache zu Text“ mit.'}
      </Notice>
    );
  }

  // The words live without a key: shown after each pause instead.
  if (area.kind === 'live' && !anyActive && !inherited) {
    return (
      <Notice tone="neutral" variant="plain" size="sm" title="Text erst nach jeder Pause">
        {keys.length > 0
          ? 'Kein Key aktiv – bis ihr einen aktiv setzt, erscheint das Gesprochene erst nach jeder Pause.'
          : 'Bis hier ein Key hinterlegt ist, erscheint das Gesprochene erst nach jeder Pause.'}
      </Notice>
    );
  }

  if (instance) {
    // The server's own speech to text is a row of its own; else nothing applies without a key.
    if (!inherited && keys.length > 0 && !anyActive) {
      return (
        <Notice tone="warning" variant="plain" size="sm" title="Kein Key aktiv">
          Workspaces ohne eigenen Key haben das nicht, bis ihr einen Key aktiv setzt.
        </Notice>
      );
    }
    return null;
  }

  // Without own keys the instance's row says the rest.
  if (!rule.ownKeys && !inherited) {
    return (
      <Notice tone="neutral" variant="plain" size="sm" title="Nicht eingerichtet">
        Das richtet der Instanz-Admin ein – bis dahin ist es in diesem Workspace aus.
      </Notice>
    );
  }
  // The instance's default is a row of its own then, chosen like a key.
  if (!inherited && keys.length > 0 && !anyActive) {
    return (
      <Notice tone="warning" variant="plain" size="sm" title="Kein Key aktiv">
        Das ist aus, bis ihr einen Key aktiv setzt.
      </Notice>
    );
  }
  if (!inherited && rule.inherit === 'none' && keys.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        Die Instanz stellt dafür keinen Key – hinterlegt einen eigenen.
      </p>
    );
  }
  return null;
}

/** Whether an agent writes along in the workspace's calls – at once, back on a refusal. */
function CallNotesToggle({
  workspaceId,
  on: saved,
  onNotify,
}: {
  workspaceId: string;
  on: boolean;
  onNotify: ShowToast;
}) {
  const [on, setOn] = useState(saved);
  const update = useUpdateWorkspaceAi(workspaceId);
  return (
    <Toggle
      checked={on}
      icon="autoAwesome"
      label="Ein Agent schreibt in Anrufen mit"
      description="Alle im Anruf sehen es an einem Zeichen. Gilt ab dem nächsten Anruf."
      onChange={(next) => {
        setOn(next);
        update.mutate(
          { callNotes: next },
          {
            onError: (error) => {
              setOn(!next);
              onNotify(error.message, 'danger');
            },
          },
        );
      }}
    />
  );
}

/**
 * Which of the key's three models the agent in a call thinks on where it looks something up or
 * works – at once, back on a refusal. The quick voice that answers at once stays as it is.
 */
function CallModelSelect({
  workspaceId,
  model: saved,
  onNotify,
}: {
  workspaceId: string;
  model: CallModel;
  onNotify: ShowToast;
}) {
  const [model, setModel] = useState(saved);
  const update = useUpdateWorkspaceAi(workspaceId);
  return (
    <div className="mt-4 flex flex-col gap-1.5">
      <label htmlFor="call-model" className="text-sm font-medium text-fg">
        Der Agent im Anruf denkt mit
      </label>
      <Select
        id="call-model"
        className="sm:max-w-sm"
        value={model}
        options={CALL_MODELS.map((value) => ({
          value,
          label: `Modell für ${AI_MODEL_ROLES[value].label}${value === 'review' ? ' (Standard)' : ''}`,
        }))}
        onChange={(next) => {
          const before = model;
          setModel(next);
          update.mutate(
            { callModel: next },
            {
              onError: (error) => {
                setModel(before);
                onNotify(error.message, 'danger');
              },
            },
          );
        }}
      />
      <span className="text-xs text-fg-subtle">
        Schaut nach, was er nicht sicher weiß – in Dateien, Präsentationen, Mails, Terminen und im
        Web – und arbeitet mit allen Werkzeugen. Die Stimme, die sofort antwortet, bleibt dieselbe.
      </span>
    </div>
  );
}

/** What the AI is called in comments and beside the people in a deck; empty gives back `KI`. */
function NameForm({
  workspaceId,
  name: saved,
  onNotify,
}: {
  workspaceId: string;
  name: string;
  onNotify: ShowToast;
}) {
  const [name, setName] = useState(saved);
  const update = useUpdateWorkspaceAi(workspaceId);
  const parsed = updateWorkspaceAiInputSchema.safeParse({ name });
  const changed = parsed.success && (parsed.data.name || DEFAULT_AI_NAME) !== saved;

  return (
    <form
      noValidate
      className="flex flex-col gap-2 sm:flex-row sm:items-start"
      onSubmit={(event) => {
        event.preventDefault();
        if (!changed) return;
        update.mutate(parsed.data, {
          onSuccess: (integrations) => setName(integrations.aiName ?? DEFAULT_AI_NAME),
          onError: (error) => onNotify(error.message, 'danger'),
        });
      }}
    >
      <TextField
        label="Name"
        value={name}
        maxLength={MAX_AI_NAME_LENGTH}
        placeholder={DEFAULT_AI_NAME}
        error={parsed.success ? null : parsed.error.issues[0]?.message}
        onChange={(event) => setName(event.target.value)}
        className="min-w-0 flex-1"
      />
      <Button
        type="submit"
        size="field"
        className="sm:mt-[22px]"
        disabled={!changed}
        loading={update.isPending}
      >
        Speichern
      </Button>
    </form>
  );
}
