import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  API_AUTH_LABELS,
  API_AUTHS,
  KNOWN_CONNECTIONS,
  knownConnection,
  looksLikeApi,
  type ApiAuth,
  type CloudConnection,
  type CloudConnectionInput,
} from '@slider/shared';
import { canCreateDecks } from '@/features/workspaces';
import {
  cloudConnectionKeys,
  useAddCloudConnection,
  useCheckCloudConnection,
  useCloudAgent,
  useCloudConnections,
  useOrderCloudAgent,
  useRemoveCloudConnection,
  useSetCloudConnectionMayChange,
} from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { pluralize } from '@/lib/format';
import { routes } from '@/lib/routes';
import {
  Badge,
  Button,
  ButtonLink,
  buttonClasses,
  ConfirmDialog,
  Icon,
  IconButton,
  IconTile,
  ListRow,
  Menu,
  RowList,
  SegmentedControl,
  TextField,
  TextLink,
  Toggle,
} from '@/ui';
import { AgentAvatar } from './components/AgentAvatar';
import { AgentChat } from './components/AgentChat';
import { CloudPage } from './components/CloudPage';
import { Empty, LoadFailed } from './components/Empty';
import { useCloud } from './hooks/useCloud';

const STATES = {
  connected: { tone: 'success', label: 'Verbunden' },
  sign_in: { tone: 'warning', label: 'Anmelden nötig' },
  failed: { tone: 'danger', label: 'Geht nicht' },
  proposed: { tone: 'info', label: 'Vorschlag' },
} as const;

/** How long a row says „Geprüft“ after it was asked again. */
const SAID_MS = 2000;

/** What a row says under its name. */
function rowSubtitle(connection: CloudConnection) {
  if (connection.state === 'failed' && connection.error) return connection.error;
  if (connection.state === 'sign_in') return `${connection.host} möchte, dass du dich anmeldest`;
  const api = connection.kind === 'api';
  if (connection.state === 'proposed')
    return `${connection.host}${api ? ' | API' : ''} | Vom Agenten vorgeschlagen`;
  if (api)
    return connection.tools.length > 0
      ? `${connection.host} | API | ${pluralize(connection.tools.length, 'Endpunkt', 'Endpunkte')}`
      : `${connection.host} | API`;
  return `${connection.host} | ${pluralize(connection.tools.length, 'Werkzeug', 'Werkzeuge')}`;
}

function ConnectionRow({
  connection,
  onRemove,
  onTake,
}: {
  connection: CloudConnection;
  onRemove: () => void;
  /** A proposal: connect it – its key typed into the form above. */
  onTake: () => void;
}) {
  const ui = useCloud();
  const check = useCheckCloudConnection(ui.workspace.id);
  const mayChange = useSetCloudConnectionMayChange(ui.workspace.id);
  const [checked, setChecked] = useState(false);
  const state = STATES[connection.state];
  const proposed = connection.state === 'proposed';
  // An API may be changed in by any method but GET: the switch stands for it always.
  const changing =
    connection.kind === 'api' ? 1 : connection.tools.filter((tool) => !tool.reading).length;
  return (
    <ListRow
      textGap="tight"
      leading={
        <IconTile>
          <Icon name={connection.kind === 'api' ? 'code' : 'link'} size={20} />
        </IconTile>
      }
      title={connection.name}
      badge={
        <Badge tone={checked ? 'neutral' : state.tone}>
          {check.isPending ? 'Prüft' : checked ? 'Geprüft' : state.label}
        </Badge>
      }
      subtitle={rowSubtitle(connection)}
      trailing={
        <span className="flex items-center gap-3">
          {connection.state === 'connected' && changing > 0 && (
            <Toggle
              size="sm"
              label="Agenten dürfen dort ändern"
              checked={connection.mayChange}
              onChange={(next) =>
                mayChange.mutate(
                  { connectionId: connection.id, mayChange: next },
                  { onError: (error) => ui.notify(error.message, 'danger') },
                )
              }
            />
          )}
          {connection.signInUrl && (
            // A page of the service: the browser goes there and comes back here.
            <a
              href={connection.signInUrl}
              className={buttonClasses({ variant: 'primary', size: 'sm' })}
            >
              Anmelden
            </a>
          )}
          {proposed && (
            <Button
              variant="primary"
              size="sm"
              aria-label={`„${connection.name}“ verbinden`}
              onClick={onTake}
            >
              Verbinden
            </Button>
          )}
          <Menu
            label={`Aktionen für „${connection.name}“`}
            actions={[
              ...(proposed
                ? []
                : [
                    {
                      label: 'Erneut prüfen',
                      icon: 'refresh' as const,
                      onSelect: () =>
                        check.mutate(connection.id, {
                          onSuccess: () => {
                            setChecked(true);
                            setTimeout(() => setChecked(false), SAID_MS);
                          },
                          onError: (error) => ui.notify(error.message, 'danger'),
                        }),
                    },
                  ]),
              { label: 'Entfernen', icon: 'delete', tone: 'danger', onSelect: onRemove },
            ]}
          />
        </span>
      }
    />
  );
}

/** An API as typed into the form: its sign-in and what it is for. */
interface ApiDraft {
  name: string;
  auth: ApiAuth;
  header: string;
  user: string;
  spec: string;
  about: string;
}
const NEW_API: ApiDraft = { name: '', auth: 'bearer', header: '', user: '', spec: '', about: '' };

/** What is typed, as an address: a bare host („api.personio.de“) is meant with https. */
function addressOf(said: string): string | null {
  if (/^https?:\/\//i.test(said)) return said;
  return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(said) ? `https://${said}` : null;
}

/**
 * An API's fields, under the address: how it signs in and the secret for it – typed here and
 * nowhere else, sent once and never shown again –, its OpenAPI description, what it is for.
 */
function ApiFields({
  api,
  secret,
  host,
  notice,
  onChange,
  onSecret,
}: {
  api: ApiDraft;
  secret: string;
  host: string | null;
  notice: string | null;
  onChange: (next: ApiDraft) => void;
  onSecret: (secret: string) => void;
}) {
  const set = (change: Partial<ApiDraft>) => onChange({ ...api, ...change });
  const secretField = (placeholder: string) => (
    <TextField
      type="password"
      icon="key"
      autoComplete="off"
      aria-label={placeholder}
      placeholder={placeholder}
      value={secret}
      onChange={(event) => onSecret(event.target.value)}
      className="min-w-0 flex-1"
    />
  );
  return (
    <div className="flex flex-col gap-3">
      {notice && <p className="text-sm text-fg-muted">{notice}</p>}
      <TextField
        icon="title"
        aria-label="Name der API"
        placeholder="Name, wie du die API nennst (freiwillig)"
        value={api.name}
        onChange={(event) => set({ name: event.target.value })}
      />
      <div className="-mx-1 overflow-x-auto p-1">
        <SegmentedControl
          label="Anmeldung"
          size="sm"
          track="soft"
          value={api.auth}
          onChange={(auth) => set({ auth })}
          segments={API_AUTHS.map((each) => ({ value: each, label: API_AUTH_LABELS[each] }))}
        />
      </div>
      {api.auth === 'bearer' && secretField('Token, den dir der Dienst gegeben hat')}
      {api.auth === 'header' && (
        <div className="flex gap-2 max-sm:flex-col">
          <TextField
            icon="tag"
            aria-label="Name des Headers"
            placeholder="Header, z. B. X-Api-Key"
            value={api.header}
            onChange={(event) => set({ header: event.target.value })}
            className="min-w-0 flex-1"
          />
          {secretField('Schlüssel')}
        </div>
      )}
      {api.auth === 'basic' && (
        <div className="flex gap-2 max-sm:flex-col">
          <TextField
            icon="person"
            autoComplete="off"
            aria-label="Benutzer"
            placeholder="Benutzer"
            value={api.user}
            onChange={(event) => set({ user: event.target.value })}
            className="min-w-0 flex-1"
          />
          {secretField('Passwort')}
        </div>
      )}
      <TextField
        icon="description"
        aria-label="OpenAPI-Beschreibung"
        placeholder="Adresse der OpenAPI-Beschreibung, https://… (freiwillig)"
        value={api.spec}
        onChange={(event) => set({ spec: event.target.value })}
      />
      <TextField
        icon="notes"
        aria-label="Wofür"
        placeholder="Wofür? Damit deine Agenten wissen, was sie dort finden (freiwillig)"
        value={api.about}
        onChange={(event) => set({ about: event.target.value })}
      />
      <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
        <Icon name="shield" size={16} />
        {api.auth === 'none'
          ? 'Deine Agenten fragen die API nur ab; ändern dürfen sie dort erst, wenn du es erlaubst.'
          : `${api.auth === 'basic' ? 'Das Passwort' : 'Der Schlüssel'} geht nur an ${host ?? 'diese Adresse'} und wird verschlüsselt gespeichert. Deine Agenten sehen ${api.auth === 'basic' ? 'es' : 'ihn'} nie.`}
      </p>
    </div>
  );
}

/**
 * The agent that helps to connect what did not connect directly – right under the field, in
 * the page: its chat as on its own page, and from there its proposal stands in the list below.
 */
function ConnectHelper({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const ui = useCloud();
  const queryClient = useQueryClient();
  const found = useCloudAgent(ui.workspace.id, agentId);
  const agent = found.data;
  // What it proposes stands in the list as soon as it has answered.
  const updated = agent?.updatedAt;
  const running = agent?.running;
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: cloudConnectionKeys.list(ui.workspace.id) });
  }, [queryClient, ui.workspace.id, updated, running]);
  return (
    <section
      aria-label="Agent hilft beim Verbinden"
      className="flex flex-col gap-3 rounded-panel bg-surface-1 p-4"
    >
      <div className="flex items-center gap-3">
        {agent ? (
          <AgentAvatar id={agent.id} size={28} className="rounded-mark" />
        ) : (
          <Icon name="autoAwesome" size={20} className="text-fg-muted" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">
            {agent?.title ?? 'Agent hilft beim Verbinden'}
          </p>
          <p className="truncate text-xs text-fg-muted">
            Er sucht heraus, wie es geht, und schlägt die Verbindung vor. Den Schlüssel trägst du
            selbst ein, nie in den Chat.
          </p>
        </div>
        <ButtonLink to={routes.cloudAgent(ui.workspace.id, agentId)} variant="ghost" size="sm">
          Als Agent öffnen
        </ButtonLink>
        <IconButton icon="close" label="Schließen" size="sm" onClick={onClose} />
      </div>
      <div className="flex h-[420px] min-h-0 flex-col">
        {found.isPending ? (
          <div aria-hidden className="skeleton min-h-0 flex-1 rounded-panel" />
        ) : !agent ? (
          <LoadFailed
            message={found.error?.message ?? 'Diesen Agenten gibt es nicht.'}
            onRetry={() => void found.refetch()}
          />
        ) : (
          <AgentChat agent={agent} chat={agent.chats[0] ?? null} />
        )}
      </div>
    </section>
  );
}

/** The order the helping agent starts with – the person's words, in the chat as theirs. */
const helpOrder = (said: string, why: string | null) =>
  why
    ? `Ich möchte „${said}“ unter Verbindungen verbinden, direkt ging es nicht: ${why} Hilf mir dabei.`
    : `Ich möchte „${said}“ unter Verbindungen verbinden, direkt ging es nicht. Hilf mir dabei.`;

/**
 * „Verbindungen“: the services outside – Figma, Linear, a company's own MCP server or any HTTP
 * API – a person connects so that their agents work there too. Typed in where it stands; what
 * does not connect directly gets an agent right under the field that finds out how and proposes
 * the connection, its key typed into the form by the person.
 */
export function Component() {
  const ui = useCloud();
  const list = useCloudConnections(ui.workspace.id);
  const add = useAddCloudConnection(ui.workspace.id);
  const remove = useRemoveCloudConnection(ui.workspace.id);
  const order = useOrderCloudAgent(ui.workspace.id);
  const [params, setParams] = useSearchParams();
  // The helping agent stays open under the field on reload and back (`?agent=`).
  const helperId = params.get('agent');
  const [address, setAddress] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const [api, setApi] = useState<ApiDraft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CloudConnection | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const connections = [...(list.data ?? [])].sort(
    (a, b) => Number(b.state === 'proposed') - Number(a.state === 'proposed'),
  );
  const may = canCreateDecks(ui.workspace.role);
  const busy = add.isPending || order.isPending;
  // Known services that are not connected yet: one click each.
  const offered = KNOWN_CONNECTIONS.filter(
    (known) => !connections.some((each) => each.host === new URL(known.url).host),
  );
  const reset = () => {
    setAddress('');
    setKey(null);
    setApi(null);
    setNotice(null);
  };
  const openHelper = (said: string, why: string | null) =>
    order.mutate(helpOrder(said, why), {
      onSuccess: (agent) => {
        reset();
        setParams({ agent: agent.id });
      },
      onError: (error) => ui.notify(error.message, 'danger'),
    });
  const send = (input: CloudConnectionInput, said: string) =>
    add.mutate(input, {
      onSuccess: (connection) => {
        reset();
        // The service's own sign-in is the next step: go there at once.
        if (connection.signInUrl) window.location.assign(connection.signInUrl);
      },
      onError: (error) => {
        if (input.kind === 'api' || !(error instanceof ApiError)) return;
        if (error.code !== 'connection_failed') return;
        // No MCP server there: an API is asked for its sign-in, anything else gets help – the
        // field then shows no error, the next step says it.
        add.reset();
        if (looksLikeApi(input.url)) {
          setApi({ ...NEW_API });
          setNotice(`Dort antwortet kein MCP-Server. Als API verbinden?`);
        } else openHelper(said, error.message);
      },
    });
  const connect = (typed: string) => {
    const said = typed.trim();
    if (!said || busy) return;
    const url = knownConnection(said) ? said : addressOf(said);
    if (api) {
      if (!url) return;
      const secret = key?.trim() || undefined;
      send(
        {
          url,
          kind: 'api',
          ...(api.name.trim() && { name: api.name.trim() }),
          api: {
            auth: api.auth,
            ...(api.auth === 'header' && api.header.trim() && { header: api.header.trim() }),
            ...(api.spec.trim() && { spec: api.spec.trim() }),
            ...(api.about.trim() && { about: api.about.trim() }),
          },
          ...(api.auth !== 'none' && secret && { token: secret }),
          ...(api.auth === 'basic' && api.user.trim() && { user: api.user.trim() }),
        },
        said,
      );
      return;
    }
    // Neither a known name nor an address: an agent finds out how.
    if (!url) {
      openHelper(said, null);
      return;
    }
    send({ url, ...(key?.trim() && { token: key.trim() }) }, said);
  };
  /** An agent's proposal: connected at once where nothing is to be typed, else into the form. */
  const take = (connection: CloudConnection) => {
    const needsSecret = connection.kind === 'api' && connection.api?.auth !== 'none';
    if (!needsSecret) {
      send(
        {
          url: connection.url,
          name: connection.name,
          ...(connection.api && { kind: 'api', api: connection.api }),
        },
        connection.url,
      );
      return;
    }
    const proposal = connection.api;
    setAddress(connection.url);
    setKey('');
    setNotice(
      `Vorschlag des Agenten für „${connection.name}“: trag den Schlüssel ein und verbinde.`,
    );
    setApi({
      name: connection.name,
      auth: proposal?.auth ?? 'bearer',
      header: proposal?.header ?? '',
      user: '',
      spec: proposal?.spec ?? '',
      about: proposal?.about ?? '',
    });
    formRef.current?.scrollIntoView({ block: 'nearest' });
  };
  const typedUrl = addressOf(address.trim());
  return (
    <CloudPage
      docTitle="Verbindungen"
      title="Verbindungen"
      crumbs={[{ label: 'Verbindungen' }]}
      nodes={[]}
    >
      {() => (
        <div className="flex flex-col gap-6">
          {may && (
            <form
              ref={formRef}
              noValidate
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                connect(address);
              }}
            >
              <div className="flex items-start gap-2 max-sm:flex-col max-sm:items-stretch">
                <div className="min-w-0 flex-1">
                  <TextField
                    icon={api ? 'code' : 'link'}
                    aria-label={api ? 'Adresse der API' : 'Dienst verbinden'}
                    placeholder={
                      api
                        ? 'Adresse der API, https://api.…'
                        : 'Name eines Dienstes oder seine Adresse, https://…'
                    }
                    value={address}
                    error={add.error?.message ?? null}
                    onChange={(event) => {
                      setAddress(event.target.value);
                      add.reset();
                    }}
                  />
                </div>
                <Button
                  type="submit"
                  variant="primary"
                  size="field"
                  disabled={!address.trim() || busy}
                >
                  {add.isPending
                    ? 'Verbindet'
                    : order.isPending
                      ? 'Fragt den Agenten'
                      : 'Verbinden'}
                </Button>
              </div>
              {api ? (
                <ApiFields
                  api={api}
                  secret={key ?? ''}
                  host={typedUrl ? new URL(typedUrl).host : null}
                  notice={notice}
                  onChange={(next) => {
                    setApi(next);
                    add.reset();
                  }}
                  onSecret={(next) => {
                    setKey(next);
                    add.reset();
                  }}
                />
              ) : (
                key !== null && (
                  <TextField
                    type="password"
                    icon="key"
                    autoFocus
                    aria-label="Schlüssel des Dienstes"
                    placeholder="Schlüssel, den dir der Dienst gegeben hat"
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                  />
                )
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {api ? (
                  <TextLink
                    variant="underline"
                    size="xs"
                    onClick={() => {
                      setApi(null);
                      setNotice(null);
                      setKey(null);
                      add.reset();
                    }}
                  >
                    Doch ein MCP-Server
                  </TextLink>
                ) : (
                  <>
                    <TextLink
                      variant="underline"
                      size="xs"
                      onClick={() => {
                        setApi({ ...NEW_API });
                        setKey('');
                        add.reset();
                      }}
                    >
                      Eine API verbinden
                    </TextLink>
                    {key === null && address.trim() !== '' && !knownConnection(address) && (
                      <TextLink variant="underline" size="xs" onClick={() => setKey('')}>
                        Der Dienst meldet mit einem Schlüssel an
                      </TextLink>
                    )}
                  </>
                )}
              </div>
              {offered.length > 0 && !api && (
                <div className="flex flex-wrap items-center gap-2">
                  {offered.map((known) => (
                    <Button
                      key={known.id}
                      variant="secondary"
                      size="sm"
                      icon="add"
                      disabled={busy}
                      onClick={() => connect(known.name)}
                    >
                      {known.name}
                    </Button>
                  ))}
                </div>
              )}
            </form>
          )}
          {helperId && (
            <ConnectHelper
              key={helperId}
              agentId={helperId}
              onClose={() => setParams({}, { replace: true })}
            />
          )}
          {list.isPending ? (
            <div aria-hidden className="flex flex-col gap-3">
              {[0, 1].map((row) => (
                <div key={row} className="skeleton h-12 rounded-control" />
              ))}
            </div>
          ) : list.isError && connections.length === 0 ? (
            <LoadFailed message={list.error.message} onRetry={() => void list.refetch()} />
          ) : connections.length === 0 ? (
            helperId ? null : (
              <Empty
                icon="link"
                title="Noch nichts verbunden"
                message={
                  may
                    ? 'Verbinde einen Dienst oder eine API. Was nicht direkt geht, richtet ein Agent hier mit dir ein.'
                    : 'Verbindungen richten Mitglieder des Workspace ein.'
                }
              />
            )
          ) : (
            <RowList>
              {connections.map((connection) => (
                <ConnectionRow
                  key={connection.id}
                  connection={connection}
                  onRemove={() => setRemoving(connection)}
                  onTake={() => take(connection)}
                />
              ))}
            </RowList>
          )}
          {removing && (
            <ConfirmDialog
              onClose={() => setRemoving(null)}
              title={`„${removing.name}“ entfernen?`}
              description="Deine Agenten kommen dann nicht mehr dorthin. Was dort liegt, bleibt."
              confirmLabel="Entfernen"
              onConfirm={() => {
                const { id, name } = removing;
                setRemoving(null);
                remove.mutate(id, {
                  onSuccess: () => ui.notify(`„${name}“ entfernt`),
                  onError: (error) => ui.notify(error.message, 'danger'),
                });
              }}
            />
          )}
        </div>
      )}
    </CloudPage>
  );
}
