import { useState } from 'react';
import type {
  CreatedWorkspaceInvite,
  InviteRole,
  Workspace,
  WorkspaceInvite,
} from '@slider/shared';
import { formatDateTime } from '@/lib/format';
import { useCreateWorkspaceInvite, useRevokeWorkspaceInvite, useWorkspaceInvites } from '@/lib/api';
import {
  Badge,
  Button,
  ErrorText,
  Icon,
  IconButton,
  IconTile,
  ListRow,
  LoadingState,
  Notice,
  RowList,
  Select,
  Spinner,
  TextField,
  useCopyToClipboard,
  type ShowToast,
} from '@/ui';
import {
  formatExpiry,
  INVITE_ROLES,
  INVITE_STATE_LABELS,
  ROLE_LABELS,
  sortInvites,
} from '../lib/roles';
import { seatsLine, seatState } from '../lib/plan';

const ROLE_OPTIONS = INVITE_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The first row of the members card: invite by e-mail or create a link, one role for both. */
export function InviteForm({ workspace, onNotify }: { workspace: Workspace; onNotify: ShowToast }) {
  const create = useCreateWorkspaceInvite(workspace.id);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('member');
  const [emailTouched, setEmailTouched] = useState(false);
  const [created, setCreated] = useState<CreatedWorkspaceInvite | null>(null);
  const emailValid = EMAIL_PATTERN.test(email.trim());
  const seats = seatState(workspace.usage);
  const seatsHint = seatsLine(workspace.usage);
  const pendingKind = create.isPending ? (create.variables.email ? 'email' : 'link') : null;

  const inviteByEmail = () => {
    setEmailTouched(true);
    if (!emailValid) return;
    const address = email.trim();
    create.mutate(
      { email: address, role },
      {
        onSuccess: (result) => {
          setEmail('');
          setEmailTouched(false);
          if (result.emailSent) {
            setCreated(null);
            onNotify(`Einladung an ${address} verschickt`);
          } else {
            setCreated(result);
          }
        },
        onError: (error) => onNotify(error.message, 'danger'),
      },
    );
  };

  const createLink = () =>
    create.mutate(
      { role },
      {
        onSuccess: setCreated,
        onError: (error) => onNotify(error.message, 'danger'),
      },
    );

  return (
    <div className="flex flex-col gap-3">
      {seatsHint &&
        (seats.full ? (
          <Notice tone="warning" variant="tinted" size="sm">
            {seatsHint} Entferne ein Mitglied oder ziehe eine Einladung zurück, um jemanden
            einzuladen. Über einen Link beitreten klappt erst wieder, wenn ein Platz frei ist.
          </Notice>
        ) : (
          <p className="text-body text-fg-subtle">{seatsHint}</p>
        ))}
      <form
        noValidate
        className="flex flex-wrap items-start gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          inviteByEmail();
        }}
      >
        <TextField
          type="email"
          aria-label="E-Mail-Adresse"
          icon="at"
          placeholder="name@firma.de"
          disabled={seats.full}
          value={email}
          error={emailTouched && !emailValid ? 'Gib eine gültige E-Mail-Adresse ein.' : null}
          onChange={(event) => setEmail(event.target.value)}
          className="min-w-[200px] flex-1"
        />
        <Select<InviteRole>
          aria-label="Rolle der eingeladenen Person"
          value={role}
          onChange={setRole}
          options={ROLE_OPTIONS}
          className="h-10 w-[120px] [&>select]:h-10"
        />
        <Button
          type="submit"
          size="field"
          icon="send"
          disabled={seats.full}
          loading={pendingKind === 'email'}
        >
          Einladen
        </Button>
        <Button
          variant="secondary"
          size="field"
          icon="link"
          title="Einladungslink für alle, die ihn bekommen (7 Tage gültig)"
          loading={pendingKind === 'link'}
          onClick={createLink}
        >
          Link
        </Button>
      </form>

      {created && <CreatedInvite created={created} onDismiss={() => setCreated(null)} />}
    </div>
  );
}

/** Open and past invitations; admins revoke open ones. */
export function InviteList({ workspace, onNotify }: { workspace: Workspace; onNotify: ShowToast }) {
  const invites = useWorkspaceInvites(workspace.id);

  if (invites.isSuccess && invites.data.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs text-fg-subtle">Einladungen</h3>
      {invites.isPending ? (
        <LoadingState padding="sm" />
      ) : invites.isError ? (
        <ErrorText>{invites.error.message}</ErrorText>
      ) : (
        <RowList variant="flush">
          {sortInvites(invites.data).map((invite) => (
            <InviteRow
              key={invite.id}
              workspaceId={workspace.id}
              invite={invite}
              onNotify={onNotify}
            />
          ))}
        </RowList>
      )}
    </div>
  );
}

const COPY_LABELS = {
  idle: 'Link kopieren',
  copied: 'Kopiert ✓',
  failed: 'Nicht kopiert',
} as const;

/** The plain link – shown only right after creating it. */
function CreatedInvite({
  created,
  onDismiss,
}: {
  created: CreatedWorkspaceInvite;
  onDismiss: () => void;
}) {
  const { state, copy } = useCopyToClipboard();
  const { invite } = created;
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
        <>
          <div className="flex gap-2">
            <TextField
              aria-label="Einladungslink"
              icon="link"
              readOnly
              value={created.url}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1"
            />
            <Button
              size="field"
              icon="contentCopy"
              // The label is hidden on phones; the button keeps its name.
              aria-label={COPY_LABELS[state]}
              onClick={() => void copy(created.url)}
            >
              <span className="max-sm:hidden">{COPY_LABELS[state]}</span>
            </Button>
          </div>
          <p role="status" className="sr-only">
            {state === 'copied'
              ? 'Link kopiert'
              : state === 'failed'
                ? 'Kopieren fehlgeschlagen'
                : ''}
          </p>
        </>
      }
    >
      {invite.email
        ? `Einladung für ${invite.email} erstellt. Die E-Mail konnte nicht verschickt werden – schick den Link selbst.`
        : `Einladungslink als ${ROLE_LABELS[invite.role]} erstellt.`}{' '}
      <span className="text-fg-muted">Er wird nur jetzt angezeigt.</span>
    </Notice>
  );
}

function InviteRow({
  workspaceId,
  invite,
  onNotify,
}: {
  workspaceId: string;
  invite: WorkspaceInvite;
  onNotify: ShowToast;
}) {
  // One mutation per row: a shared one only calls back for its latest `mutate` and tracks only
  // its latest variables, so a second revoke would hide the first one's spinner and error.
  const revoke = useRevokeWorkspaceInvite(workspaceId);
  const revoking = revoke.isPending;
  const onRevoke = () =>
    revoke.mutate(invite.id, {
      onSuccess: () => onNotify('Einladung zurückgezogen'),
      onError: (error) => onNotify(error.message, 'danger'),
    });
  const open = invite.state === 'valid';
  const detail = [
    invite.createdBy ? `von ${invite.createdBy.name}` : null,
    open ? formatExpiry(invite.expiresAt) : null,
    !invite.email && invite.useCount > 0 ? `${invite.useCount}× verwendet` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ListRow
      variant="flush"
      size="body"
      titleWeight="normal"
      titleTone={open ? 'fg' : 'subtle'}
      leading={
        <IconTile size={32}>
          <Icon name={invite.email ? 'at' : 'link'} size={16} />
        </IconTile>
      }
      title={invite.email ?? 'Einladungslink'}
      badge={<Badge>{ROLE_LABELS[invite.role]}</Badge>}
      subtitle={detail}
      subtitleTitle={`Erstellt ${formatDateTime(invite.createdAt)}`}
      trailing={
        <Badge tone={open ? 'info' : invite.state === 'used' ? 'success' : 'neutral'}>
          {INVITE_STATE_LABELS[invite.state]}
        </Badge>
      }
      actionSlot={
        open &&
        (revoking ? (
          <Spinner size={16} className="text-fg-subtle" />
        ) : (
          <IconButton
            icon="delete"
            size="sm"
            iconSize={18}
            label="Einladung zurückziehen"
            onClick={onRevoke}
          />
        ))
      }
    />
  );
}
