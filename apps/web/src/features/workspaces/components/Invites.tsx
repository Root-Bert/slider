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
  ConfirmDialog,
  ErrorText,
  Icon,
  IconButton,
  IconTile,
  ListRow,
  LoadingState,
  Notice,
  RowList,
  Select,
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
import { LOCKED_MESSAGE, seatsLine, seatState } from '../lib/plan';

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
  // Over the plan's limits (BER-155): no invitations at all until it is back within them.
  const locked = workspace.locked;
  const noSeat = seats.full || locked;
  // One mutation for both actions: a second `mutate` while the first runs would drop the first
  // one's callbacks (TanStack keeps only the latest), and with them its toast or one-time link.
  // So both buttons wait until it is done.
  const busy = create.isPending;
  const pendingKind = busy ? (create.variables.email ? 'email' : 'link') : null;

  const inviteByEmail = () => {
    if (busy) return;
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
    !busy &&
    create.mutate(
      { role },
      {
        onSuccess: setCreated,
        onError: (error) => onNotify(error.message, 'danger'),
      },
    );

  return (
    <div className="flex flex-col gap-3">
      {locked ? (
        <Notice tone="warning" variant="tinted" size="sm">
          {LOCKED_MESSAGE}
        </Notice>
      ) : (
        seatsHint &&
        (seats.full ? (
          <Notice tone="warning" variant="tinted" size="sm">
            {seatsHint} Entferne ein Mitglied oder ziehe eine Einladung zurück, um jemanden
            einzuladen. Über einen Link beitreten klappt erst wieder, wenn ein Platz frei ist.
          </Notice>
        ) : (
          <p className="text-body text-fg-subtle">{seatsHint}</p>
        ))
      )}
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
          disabled={noSeat}
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
          disabled={noSeat || busy}
          title={locked ? LOCKED_MESSAGE : undefined}
          loading={pendingKind === 'email'}
        >
          Einladen
        </Button>
        <Button
          variant="secondary"
          size="field"
          icon="link"
          title={
            locked ? LOCKED_MESSAGE : 'Einladungslink für alle, die ihn bekommen (7 Tage gültig)'
          }
          disabled={locked || busy}
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

  if (invites.data?.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs text-fg-subtle">Einladungen</h3>
      {invites.isPending ? (
        <LoadingState padding="sm" />
      ) : invites.isLoadingError ? (
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
  const [confirming, setConfirming] = useState(false);
  const closeConfirm = () => {
    setConfirming(false);
    revoke.reset();
  };
  const onRevoke = () =>
    revoke.mutate(invite.id, {
      onSuccess: () => {
        onNotify('Einladung zurückgezogen');
        setConfirming(false);
      },
    });
  const open = invite.state === 'valid';
  // Names the target, so every row's button says which invite it revokes.
  const revokeLabel = invite.email
    ? `Einladung an ${invite.email} zurückziehen`
    : `Einladungslink (${ROLE_LABELS[invite.role]}) zurückziehen`;
  const detail = [
    invite.createdBy ? `von ${invite.createdBy.name}` : null,
    open ? formatExpiry(invite.expiresAt) : null,
    !invite.email && invite.useCount > 0 ? `${invite.useCount}× verwendet` : null,
  ]
    .filter(Boolean)
    .join(' | ');

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
        open && (
          <>
            <IconButton
              icon="delete"
              size="sm"
              iconSize={18}
              label={revokeLabel}
              onClick={() => setConfirming(true)}
            />
            {confirming && (
              <ConfirmDialog
                onClose={closeConfirm}
                title={
                  invite.email
                    ? `Einladung an ${invite.email} zurückziehen?`
                    : 'Einladungslink zurückziehen?'
                }
                description={
                  invite.email
                    ? 'Der Link in der Einladungs-Mail funktioniert danach nicht mehr. Der Platz wird wieder frei.'
                    : 'Der Link funktioniert danach für niemanden mehr, auch nicht für alle, die ihn schon bekommen haben.'
                }
                confirmLabel="Zurückziehen"
                pending={revoke.isPending}
                // In the dialog: a toast would sit behind its backdrop.
                error={revoke.error?.message}
                onConfirm={onRevoke}
              />
            )}
          </>
        )
      }
    />
  );
}
