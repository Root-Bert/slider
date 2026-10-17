import type { Workspace, WorkspaceMember, WorkspaceRole } from '@slider/shared';
import { WORKSPACE_ROLES } from '@slider/shared';
import { useState } from 'react';
import { useMembers, useRemoveMember, useUpdateMemberRole } from '@/lib/api';
import {
  Avatar,
  Badge,
  ConfirmDialog,
  ErrorText,
  IconButton,
  ListRow,
  LoadingState,
  RowList,
  Section,
  Select,
  type ShowToast,
} from '@/ui';
import {
  assignableRoles,
  canRemoveMember,
  CREATOR_HINT,
  CREATOR_LABEL,
  canManageMembers,
  isLastAdmin,
  ROLE_HINTS,
  ROLE_LABELS,
} from '../lib/roles';
import { formatRatio, INVITE_SECTION_ID, seatState } from '../lib/plan';
import { InviteForm, InviteList } from './Invites';

/** Members with their roles; admins invite (first row), change roles and remove people. */
export function MembersSection({
  workspace,
  userId,
  onNotify,
}: {
  workspace: Workspace;
  userId: string;
  onNotify: ShowToast;
}) {
  const members = useMembers(workspace.id);
  const remove = useRemoveMember(workspace.id);
  const [removing, setRemoving] = useState<WorkspaceMember | null>(null);
  const list = members.data ?? [];
  const adminCount = list.filter((member) => member.role === 'admin').length;
  const canInvite = canManageMembers(workspace.role);
  const seats = seatState(workspace.usage);

  return (
    <Section
      id={canInvite ? INVITE_SECTION_ID : undefined}
      title="Mitglieder"
      description={
        canInvite
          ? 'Wer in dieser Organisation Reviews sieht und kommentiert. Einladungen per E-Mail und Links gelten 7 Tage.'
          : 'Wer in dieser Organisation Reviews sieht und kommentiert.'
      }
      aside={
        canInvite &&
        seats.max !== null && (
          <Badge tone={seats.full ? 'warning' : 'neutral'}>{formatRatio(seats)} Plätze</Badge>
        )
      }
    >
      {canInvite && <InviteForm workspace={workspace} onNotify={onNotify} />}
      {members.isPending ? (
        <LoadingState />
      ) : members.isError ? (
        <ErrorText>{members.error.message}</ErrorText>
      ) : (
        <RowList variant="hover">
          {list.map((member) => (
            <MemberRow
              key={member.userId}
              workspace={workspace}
              member={member}
              self={member.userId === userId}
              adminCount={adminCount}
              onRemove={() => setRemoving(member)}
              onNotify={onNotify}
            />
          ))}
        </RowList>
      )}

      {canInvite && <InviteList workspace={workspace} onNotify={onNotify} />}

      <dl className="grid gap-x-4 gap-y-2 rounded-control bg-surface-1 px-4 py-3 text-xs sm:grid-cols-[auto_1fr]">
        {WORKSPACE_ROLES.toReversed().map((role) => (
          <div key={role} className="contents">
            <dt className="font-medium text-fg-muted">{ROLE_LABELS[role]}</dt>
            <dd className="text-fg-subtle max-sm:mb-1">{ROLE_HINTS[role]}</dd>
          </div>
        ))}
        <dt className="font-medium text-fg-muted">{CREATOR_LABEL}</dt>
        <dd className="text-fg-subtle">{CREATOR_HINT}</dd>
      </dl>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => {
          setRemoving(null);
          remove.reset();
        }}
        title={removing ? `${removing.name} entfernen?` : ''}
        description="Die Person verliert den Zugriff auf alle Reviews dieser Organisation. Ihre Reviews und Kommentare bleiben erhalten."
        confirmLabel="Entfernen"
        pending={remove.isPending}
        // In the dialog: a toast would sit behind its backdrop.
        error={remove.error?.message}
        onConfirm={() =>
          removing &&
          remove.mutate(
            { userId: removing.userId },
            {
              onSuccess: () => {
                onNotify(`${removing.name} entfernt`);
                setRemoving(null);
              },
            },
          )
        }
      />
    </Section>
  );
}

function MemberRow({
  workspace,
  member,
  self,
  adminCount,
  onRemove,
  onNotify,
}: {
  workspace: Workspace;
  member: WorkspaceMember;
  self: boolean;
  adminCount: number;
  onRemove: () => void;
  onNotify: ShowToast;
}) {
  // One mutation per row: a shared one only calls back for its latest `mutate`, so a quick
  // second role change would swallow the first one's error.
  const updateRole = useUpdateMemberRole(workspace.id);
  const lastAdmin = isLastAdmin(member.role, adminCount);
  const roles = lastAdmin ? [] : assignableRoles(workspace.role);

  // Giving up one's own admin role can only be undone by another admin: ask first.
  const [demoting, setDemoting] = useState<WorkspaceRole | null>(null);

  const changeRole = (role: WorkspaceRole) =>
    updateRole.mutate(
      { userId: member.userId, role },
      {
        onSuccess: () => onNotify(`${member.name} ist jetzt ${ROLE_LABELS[role]}`),
        onError: (error) => onNotify(error.message, 'danger'),
      },
    );
  const pickRole = (role: WorkspaceRole) => {
    if (role === member.role) return;
    if (self && canManageMembers(member.role) && !canManageMembers(role)) setDemoting(role);
    else changeRole(role);
  };

  return (
    <>
      <ListRow
        variant="hover"
        size="body"
        leading={<Avatar author={{ ...member, type: 'owner' }} size={32} />}
        title={
          <>
            {member.name}
            {self && <span className="font-normal text-fg-subtle"> (du)</span>}
          </>
        }
        badge={
          member.isCreator && (
            <span title={CREATOR_HINT} className="flex">
              <Badge tone="info">{CREATOR_LABEL}</Badge>
            </span>
          )
        }
        subtitle={member.email}
        trailing={
          roles.length > 0 ? (
            <Select<WorkspaceRole>
              size="sm"
              aria-label={`Rolle von ${member.name}`}
              value={member.role}
              disabled={updateRole.isPending}
              onChange={pickRole}
              options={WORKSPACE_ROLES.filter((role) => roles.includes(role)).map((role) => ({
                value: role,
                label: ROLE_LABELS[role],
              }))}
              // Phones: as wide as the longest role, so the name keeps the room.
              className="shrink-0 sm:w-[120px]"
            />
          ) : (
            <span
              className="flex shrink-0 justify-end sm:w-[120px]"
              title={lastAdmin ? 'Der einzige Admin – ernenne zuerst jemand anderen.' : undefined}
            >
              <Badge>{ROLE_LABELS[member.role]}</Badge>
            </span>
          )
        }
        actionSlot={
          !self &&
          canRemoveMember(workspace.role) && (
            <IconButton
              icon="close"
              size="sm"
              iconSize={18}
              label={`${member.name} entfernen`}
              onClick={onRemove}
            />
          )
        }
      />
      <ConfirmDialog
        open={demoting !== null}
        onClose={() => {
          setDemoting(null);
          updateRole.reset();
        }}
        title={demoting ? `Selbst ${ROLE_LABELS[demoting]} werden?` : ''}
        description={`Du bist danach kein Admin von „${workspace.name}“ mehr und kannst keine Mitglieder mehr verwalten. Zurück geht es nur, wenn dich ein anderer Admin wieder ernennt.`}
        confirmLabel={demoting ? `${ROLE_LABELS[demoting]} werden` : ''}
        pending={updateRole.isPending}
        // In the dialog: a toast would sit behind its backdrop.
        error={updateRole.error?.message}
        onConfirm={() => {
          const role = demoting;
          if (!role) return;
          updateRole.mutate(
            { userId: member.userId, role },
            {
              onSuccess: () => {
                onNotify(`Du bist jetzt ${ROLE_LABELS[role]}`);
                setDemoting(null);
              },
            },
          );
        }}
      />
    </>
  );
}
