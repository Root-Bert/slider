import { useState } from 'react';
import type {
  CreatedWorkspaceInvite,
  InviteRole,
  Workspace,
  WorkspaceInvite,
} from '@slider/shared';
import { formatDateTime } from '@/lib/format';
import {
  useCreateWorkspaceInvite,
  useRevokeWorkspaceInvite,
  useWorkspaceInvites,
} from '@/lib/workspace-queries';
import { useCopyToClipboard } from '@/features/sharing/hooks/useCopyToClipboard';
import { Badge, Button, Icon, IconButton, Select, Spinner, TextField, type ShowToast } from '@/ui';
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
    create.mutate(
      { email: email.trim(), role },
      {
        onSuccess: (result) => {
          setEmail('');
          setEmailTouched(false);
          setCreated(result);
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
      {seatsHint && (
        <p
          className={
            seats.full
              ? 'flex items-start gap-2 rounded-control bg-warning/10 px-3 py-2.5 text-[13px] leading-5 text-fg'
              : 'text-[13px] text-fg-subtle'
          }
        >
          {seats.full && <Icon name="warning" size={18} className="mt-px shrink-0 text-warning" />}
          <span>
            {seatsHint}
            {seats.full &&
              ' Entferne ein Mitglied oder ziehe eine Einladung zurück, um jemanden einzuladen. Über einen Link beitreten klappt erst wieder, wenn ein Platz frei ist.'}
          </span>
        </p>
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
          className="h-10"
          icon="send"
          disabled={seats.full}
          loading={pendingKind === 'email'}
        >
          Einladen
        </Button>
        <Button
          variant="secondary"
          className="h-10"
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
  const revoke = useRevokeWorkspaceInvite(workspace.id);

  if (invites.isSuccess && invites.data.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs text-fg-subtle">Einladungen</h3>
      {invites.isPending ? (
        <div className="flex justify-center py-4">
          <Spinner className="text-fg-subtle" />
        </div>
      ) : invites.isError ? (
        <p className="text-[13px] text-danger">{invites.error.message}</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {sortInvites(invites.data).map((invite) => (
            <InviteRow
              key={invite.id}
              invite={invite}
              revoking={revoke.isPending && revoke.variables === invite.id}
              onRevoke={() =>
                revoke.mutate(invite.id, {
                  onSuccess: () => onNotify('Einladung zurückgezogen'),
                  onError: (error) => onNotify(error.message, 'danger'),
                })
              }
            />
          ))}
        </ul>
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
    <div className="flex animate-fade-in flex-col gap-3 rounded-control bg-info/10 p-3">
      <div className="flex items-start gap-2">
        <Icon name="checkCircle" size={18} className="mt-px shrink-0 text-info" />
        <p className="flex-1 text-[13px] leading-5 text-fg">
          {invite.email
            ? `Einladung für ${invite.email} erstellt. Die E-Mail konnte nicht verschickt werden – schick den Link selbst.`
            : `Einladungslink als ${ROLE_LABELS[invite.role]} erstellt.`}{' '}
          <span className="text-fg-muted">Er wird nur jetzt angezeigt.</span>
        </p>
        <IconButton
          icon="close"
          size="sm"
          iconSize={18}
          label="Schließen"
          onClick={onDismiss}
          className="-mt-1 -mr-1"
        />
      </div>
      <div className="flex gap-2">
        <TextField
          aria-label="Einladungslink"
          icon="link"
          readOnly
          value={created.url}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1"
        />
        <Button className="h-10" icon="contentCopy" onClick={() => void copy(created.url)}>
          <span className="max-sm:hidden">{COPY_LABELS[state]}</span>
        </Button>
      </div>
      <p role="status" className="sr-only">
        {state === 'copied' ? 'Link kopiert' : state === 'failed' ? 'Kopieren fehlgeschlagen' : ''}
      </p>
    </div>
  );
}

function InviteRow({
  invite,
  revoking,
  onRevoke,
}: {
  invite: WorkspaceInvite;
  revoking: boolean;
  onRevoke: () => void;
}) {
  const open = invite.state === 'valid';
  const detail = [
    invite.createdBy ? `von ${invite.createdBy.name}` : null,
    open ? formatExpiry(invite.expiresAt) : null,
    !invite.email && invite.useCount > 0 ? `${invite.useCount}× verwendet` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="flex items-center gap-3 rounded-control-sm px-2 py-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-chip bg-white/6 text-fg-muted">
        <Icon name={invite.email ? 'at' : 'link'} size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={
              open ? 'truncate text-[13px] text-fg' : 'truncate text-[13px] text-fg-subtle'
            }
          >
            {invite.email ?? 'Einladungslink'}
          </span>
          <Badge>{ROLE_LABELS[invite.role]}</Badge>
        </span>
        <span
          className="truncate text-xs text-fg-subtle"
          title={`Erstellt ${formatDateTime(invite.createdAt)}`}
        >
          {detail}
        </span>
      </span>
      <Badge tone={open ? 'info' : invite.state === 'used' ? 'success' : 'neutral'}>
        {INVITE_STATE_LABELS[invite.state]}
      </Badge>
      <span className="flex w-8 shrink-0 justify-end">
        {open &&
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
          ))}
      </span>
    </li>
  );
}
