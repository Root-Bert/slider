import { useState } from 'react';
import {
  MAX_APP_NAME,
  createAppTokenInputSchema,
  type AppConnection,
  type CreatedAppToken,
} from '@slider/shared';
import { useAccount } from '@/features/auth';
import { useAppConnections, useCreateAppToken, useRemoveAppConnection } from '@/lib/api';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorText,
  Icon,
  IconTile,
  ListRow,
  LoadingState,
  Menu,
  Notice,
  RowList,
  Section,
  Select,
  TextField,
  useCopyToClipboard,
  type ShowToast,
} from '@/ui';

/*
 * „KI-Apps“ on `/konto`: Claude, ChatGPT, Claude Code … reach Slider over MCP with the person's
 * rights. The address to give them, how to add it, the apps let in („Entfernen“ ends their
 * access) and „Token erstellen“ for apps that take a token instead of signing in.
 */

const COPY_LABELS = { idle: 'Kopieren', copied: 'Kopiert ✓', failed: 'Nicht kopiert' } as const;

/** A read-only line to copy: the MCP address, a token, a command. */
export function CopyField({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: 'link' | 'key';
}) {
  const { state, copy } = useCopyToClipboard();
  return (
    <div className="flex gap-2">
      <TextField
        aria-label={label}
        icon={icon}
        readOnly
        value={value}
        onFocus={(event) => event.currentTarget.select()}
        className="min-w-0 flex-1 font-mono"
      />
      <Button
        size="field"
        variant="secondary"
        icon="contentCopy"
        aria-label={`${label}: ${COPY_LABELS[state]}`}
        onClick={() => void copy(value)}
      >
        <span className="max-sm:hidden">{COPY_LABELS[state]}</span>
      </Button>
    </div>
  );
}

export function AppConnectionsSection({ onNotify }: { onNotify: ShowToast }) {
  const connections = useAppConnections();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedAppToken | null>(null);
  const [removing, setRemoving] = useState<AppConnection | null>(null);
  const data = connections.data;

  return (
    <Section
      id="ki-apps"
      title="KI-Apps"
      description="Claude, ChatGPT und andere KI-Apps lesen deine Präsentationen, Kommentare und das Material und legen Recherchen als Notizen auf das Board – mit deinen Rechten. Sie verbinden sich über MCP."
      aside={
        <Button variant="secondary" size="sm" icon="key" onClick={() => setCreating(true)}>
          Token erstellen
        </Button>
      }
    >
      {connections.isPending ? (
        <LoadingState padding="sm" />
      ) : connections.isError ? (
        <ErrorText>{connections.error.message}</ErrorText>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="text-xs text-fg-subtle">Adresse für KI-Apps</h3>
            <CopyField label="MCP-Adresse" icon="link" value={data!.mcpUrl} />
            <McpSteps mcpUrl={data!.mcpUrl} oauth={data!.oauth} />
          </div>

          {created && (
            <CreatedToken
              created={created}
              mcpUrl={data!.mcpUrl}
              onDismiss={() => setCreated(null)}
            />
          )}

          <div className="flex flex-col gap-2">
            <h3 className="text-xs text-fg-subtle">Verbunden</h3>
            {data!.connections.length === 0 ? (
              <Notice tone="neutral" variant="plain">
                Noch keine KI-App verbunden.
              </Notice>
            ) : (
              <RowList>
                {data!.connections.map((connection) => (
                  <ConnectionRow
                    key={connection.id}
                    connection={connection}
                    onRemove={() => setRemoving(connection)}
                  />
                ))}
              </RowList>
            )}
          </div>
        </>
      )}
      {creating && (
        <CreateTokenDialog
          onClose={() => setCreating(false)}
          onCreated={(token) => {
            setCreating(false);
            setCreated(token);
          }}
        />
      )}
      {removing && (
        <RemoveDialog
          connection={removing}
          onClose={() => setRemoving(null)}
          onNotify={onNotify}
          onRemoved={() => {
            if (created?.connection.id === removing.id) setCreated(null);
          }}
        />
      )}
    </Section>
  );
}

/**
 * How to add the MCP address to Claude, ChatGPT and Claude Code – here and in the material page's
 * „Mit KI-Apps verbinden“ (`ConnectAppsPanel`).
 */
export function McpSteps({ mcpUrl, oauth }: { mcpUrl: string; oauth: boolean }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-fg-muted">
      {oauth ? (
        <>
          <li>
            <strong className="font-medium text-fg">Claude und ChatGPT:</strong> in den
            Einstellungen unter „Konnektoren“ einen eigenen Konnektor mit dieser Adresse hinzufügen.
            Slider fragt dann, ob die App darf.
          </li>
          <li>
            <strong className="font-medium text-fg">Claude Code:</strong>{' '}
            <code className="font-mono">claude mcp add --transport http slider {mcpUrl}</code>, dann{' '}
            <code className="font-mono">/mcp</code> zum Anmelden.
          </li>
          <li>Apps ohne Anmeldung bekommen ein Token.</li>
        </>
      ) : (
        <li>
          Erstelle ein Token und gib es der App mit – Claude Code etwa so:{' '}
          <code className="font-mono">
            claude mcp add --transport http slider {mcpUrl} --header "Authorization: Bearer …"
          </code>
        </li>
      )}
    </ul>
  );
}

function ConnectionRow({
  connection,
  onRemove,
}: {
  connection: AppConnection;
  onRemove: () => void;
}) {
  return (
    <ListRow
      textGap="tight"
      leading={
        <IconTile>
          <Icon name={connection.kind === 'token' ? 'key' : 'autoAwesome'} size={20} />
        </IconTile>
      }
      title={connection.name}
      badge={<Badge tone="neutral">{connection.workspaceName ?? 'Alle Workspaces'}</Badge>}
      subtitle={
        <>
          {connection.kind === 'token' ? 'Token erstellt' : 'Verbunden'}{' '}
          <span title={formatDateTime(connection.createdAt)}>
            {formatRelativeTime(connection.createdAt)}
          </span>
          {' | '}
          {connection.lastUsedAt ? (
            <>
              Zuletzt verwendet{' '}
              <span title={formatDateTime(connection.lastUsedAt)}>
                {formatRelativeTime(connection.lastUsedAt)}
              </span>
            </>
          ) : (
            'Noch nie verwendet'
          )}
        </>
      }
      trailing={
        <Menu
          label={`Aktionen für „${connection.name}“`}
          actions={[{ label: 'Entfernen', icon: 'delete', tone: 'danger', onSelect: onRemove }]}
        />
      }
    />
  );
}

/** The token – shown only right after creating it, as an invitation link is. */
function CreatedToken({
  created,
  mcpUrl,
  onDismiss,
}: {
  created: CreatedAppToken;
  mcpUrl: string;
  onDismiss: () => void;
}) {
  return (
    <Notice
      tone="info"
      variant="tinted"
      size="sm"
      icon="checkCircle"
      animated
      onDismiss={onDismiss}
      dismissLabel="Schließen"
      footer={
        <div className="flex flex-col gap-2">
          <CopyField label="Token" icon="key" value={created.token} />
          <CopyField
            label="Befehl für Claude Code"
            value={`claude mcp add --transport http slider ${mcpUrl} --header "Authorization: Bearer ${created.token}"`}
          />
        </div>
      }
    >
      Token „{created.connection.name}“ erstellt.{' '}
      <span className="text-fg-muted">
        Es wird nur jetzt angezeigt – wer es hat, handelt in deinem Namen.
      </span>
    </Notice>
  );
}

const ALL = '__all__';

function CreateTokenDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (created: CreatedAppToken) => void;
}) {
  const { workspaces } = useAccount();
  const [name, setName] = useState('Claude Code');
  const [workspaceId, setWorkspaceId] = useState<string>(ALL);
  const create = useCreateAppToken();
  const parsed = createAppTokenInputSchema.safeParse({
    name,
    workspaceId: workspaceId === ALL ? null : workspaceId,
  });
  const save = () => {
    if (!parsed.success) return;
    create.mutate(parsed.data, { onSuccess: onCreated });
  };
  return (
    <ConfirmDialog
      onClose={onClose}
      title="Token erstellen"
      description="Für KI-Apps, die sich nicht selbst anmelden. Das Token gilt, bis du es entfernst."
      tone="primary"
      confirmLabel="Erstellen"
      form="create-app-token"
      confirmDisabled={!parsed.success}
      pending={create.isPending}
      error={create.error?.message}
    >
      <form
        id="create-app-token"
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <TextField
          label="Name"
          value={name}
          maxLength={MAX_APP_NAME}
          autoFocus
          error={name.trim() ? null : 'Gib dem Token einen Namen.'}
          onChange={(event) => setName(event.target.value)}
        />
        {workspaces.length > 1 && (
          <label className="flex flex-col gap-1.5 text-xs text-fg-subtle">
            Workspaces
            <Select
              value={workspaceId}
              onChange={setWorkspaceId}
              options={[
                { value: ALL, label: 'Alle Workspaces' },
                ...workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name })),
              ]}
            />
          </label>
        )}
      </form>
    </ConfirmDialog>
  );
}

function RemoveDialog({
  connection,
  onClose,
  onNotify,
  onRemoved,
}: {
  connection: AppConnection;
  onClose: () => void;
  onNotify: ShowToast;
  onRemoved: () => void;
}) {
  const remove = useRemoveAppConnection();
  return (
    <ConfirmDialog
      onClose={onClose}
      title={`„${connection.name}“ entfernen?`}
      description="Die App kommt dann nicht mehr an deine Präsentationen. Was sie auf Boards gelegt hat, bleibt."
      confirmLabel="Entfernen"
      pending={remove.isPending}
      error={remove.error?.message}
      onConfirm={() =>
        remove.mutate(connection.id, {
          onSuccess: () => {
            onNotify(`„${connection.name}“ entfernt`);
            onRemoved();
            onClose();
          },
        })
      }
    />
  );
}
