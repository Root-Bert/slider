import type { Workspace, WorkspaceMember, WorkspaceRole } from '@slider/shared';
import { WORKSPACE_ROLES } from '@slider/shared';
import { useState } from 'react';
import { useMembers, useRemoveMember, useUpdateMemberRole } from '@/lib/workspace-queries';
import { Avatar, Badge, Button, Dialog, IconButton, Select, Spinner, type ShowToast } from '@/ui';
import {
  assignableRoles,
  canRemoveMember,
  isLastOwner,
  ROLE_HINTS,
  ROLE_LABELS,
} from '../lib/roles';
import { SettingsSection } from './SettingsSection';

/** Members with their roles; admins change roles and remove people. */
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
  const updateRole = useUpdateMemberRole(workspace.id);
  const remove = useRemoveMember(workspace.id);
  const [removing, setRemoving] = useState<WorkspaceMember | null>(null);
  const list = members.data ?? [];
  const ownerCount = list.filter((member) => member.role === 'owner').length;

  const changeRole = (member: WorkspaceMember, role: WorkspaceRole) =>
    updateRole.mutate(
      { userId: member.userId, role },
      {
        onSuccess: () => onNotify(`${member.name} ist jetzt ${ROLE_LABELS[role]}`),
        onError: (error) => onNotify(error.message, 'danger'),
      },
    );

  return (
    <SettingsSection
      title="Mitglieder"
      description="Wer in diesem Workspace Präsentationen sieht und kommentiert."
      aside={
        members.isSuccess && (
          <span className="pt-0.5 text-[13px] text-fg-subtle">{list.length}</span>
        )
      }
    >
      {members.isPending ? (
        <div className="flex justify-center py-6">
          <Spinner className="text-fg-subtle" />
        </div>
      ) : members.isError ? (
        <p className="text-[13px] text-danger">{members.error.message}</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {list.map((member) => {
            const self = member.userId === userId;
            const lastOwner = isLastOwner(member.role, ownerCount);
            const roles = lastOwner ? [] : assignableRoles(workspace.role, member.role);
            return (
              <li
                key={member.userId}
                className="flex items-center gap-3 rounded-control-sm px-2 py-2 hover:bg-white/3"
              >
                <Avatar author={{ ...member, type: 'owner' }} size={32} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-medium text-fg">
                    {member.name}
                    {self && <span className="font-normal text-fg-subtle"> (Du)</span>}
                  </span>
                  <span className="truncate text-xs text-fg-subtle">{member.email}</span>
                </span>
                {roles.length > 0 ? (
                  <Select<WorkspaceRole>
                    size="sm"
                    aria-label={`Rolle von ${member.name}`}
                    value={member.role}
                    disabled={
                      updateRole.isPending && updateRole.variables?.userId === member.userId
                    }
                    onChange={(role) => role !== member.role && changeRole(member, role)}
                    options={WORKSPACE_ROLES.filter((role) => roles.includes(role)).map((role) => ({
                      value: role,
                      label: ROLE_LABELS[role],
                    }))}
                    className="w-[120px] shrink-0"
                  />
                ) : (
                  <span
                    className="flex w-[120px] shrink-0 justify-end"
                    title={
                      lastOwner ? 'Der einzige Owner – ernenne zuerst jemand anderen.' : undefined
                    }
                  >
                    <Badge>{ROLE_LABELS[member.role]}</Badge>
                  </span>
                )}
                <span className="flex w-8 shrink-0 justify-end">
                  {!self && canRemoveMember(workspace.role, member.role) && (
                    <IconButton
                      icon="close"
                      size="sm"
                      iconSize={18}
                      label={`${member.name} entfernen`}
                      onClick={() => setRemoving(member)}
                    />
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <dl className="grid gap-x-4 gap-y-2 rounded-control bg-white/4 px-4 py-3 text-xs sm:grid-cols-[auto_1fr]">
        {WORKSPACE_ROLES.toReversed().map((role) => (
          <div key={role} className="contents">
            <dt className="font-medium text-fg-muted">{ROLE_LABELS[role]}</dt>
            <dd className="text-fg-subtle max-sm:mb-1">{ROLE_HINTS[role]}</dd>
          </div>
        ))}
      </dl>

      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing ? `${removing.name} entfernen?` : ''}
        description="Die Person verliert den Zugriff auf alle Präsentationen dieses Workspace. Ihre Präsentationen und Kommentare bleiben erhalten."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Abbrechen
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() =>
                removing &&
                remove.mutate(removing.userId, {
                  onSuccess: () => {
                    onNotify(`${removing.name} entfernt`);
                    setRemoving(null);
                  },
                  onError: (error) => onNotify(error.message, 'danger'),
                })
              }
            >
              Entfernen
            </Button>
          </>
        }
      />
    </SettingsSection>
  );
}
