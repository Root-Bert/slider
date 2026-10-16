import { useState } from 'react';
import { useNavigate } from 'react-router';
import { routes } from '@/lib/routes';
import { useMe } from '@/lib/api';
import { Icon, MenuDivider, MenuHeading, MenuItem, Toast, useToast } from '@/ui';
import { ROLE_LABELS } from '../lib/roles';
import { useActiveWorkspace } from '../hooks/useWorkspace';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';
import { JoinWorkspaceDialog } from './JoinWorkspaceDialog';
import { HeaderPopover } from './HeaderPopover';
import { PendingInvites } from './PendingInvites';
import { WorkspaceMark } from './WorkspaceMark';

/**
 * Header: current organisation with a menu to switch, found one or join one by link, open its
 * settings and accept pending invites.
 */
export function WorkspaceSwitcher() {
  const { data: me } = useMe();
  const current = useActiveWorkspace();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'create' | 'join' | null>(null);
  const [toast, showToast] = useToast();
  const workspaces = me?.workspaces ?? [];
  const invites = me?.pendingInvites ?? [];
  const canCreate = me?.limits?.canCreateWorkspace ?? true;
  if (!me?.user) return null;

  const label = current
    ? `Organisation: ${current.name}${invites.length > 0 ? `, ${invites.length} Einladungen` : ''}`
    : 'Organisationen';

  return (
    <>
      <HeaderPopover
        label={label}
        triggerClassName="flex h-9 max-w-[240px] items-center gap-2 rounded-control pr-2 pl-1.5 text-fg transition-colors hover:bg-hover aria-expanded:bg-hover"
        trigger={() => (
          <>
            {current ? (
              <WorkspaceMark name={current.name} logoUrl={current.logoUrl} />
            ) : (
              <Icon name="folder" size={20} />
            )}
            <span className="truncate text-sm font-medium max-sm:hidden">
              {current?.name ?? 'Organisationen'}
            </span>
            {invites.length > 0 && (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-thumb bg-info px-1 text-tiny font-semibold text-primary-hover">
                {invites.length}
              </span>
            )}
            <Icon name="expandMore" size={18} className="shrink-0 text-fg-subtle" />
          </>
        )}
      >
        {(close) => (
          <>
            <MenuHeading>Organisationen</MenuHeading>
            <div className="flex max-h-[min(320px,50vh)] flex-col gap-0.5 overflow-y-auto">
              {workspaces.map((workspace) => (
                <MenuItem
                  key={workspace.id}
                  selected={workspace.id === current?.id}
                  icon={<WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} />}
                  trailing={
                    workspace.id === current?.id ? (
                      <Icon name="check" size={18} className="text-fg-muted" />
                    ) : null
                  }
                  onClick={() => {
                    close();
                    void navigate(routes.workspace(workspace.id));
                  }}
                >
                  <span className="truncate">{workspace.name}</span>
                  <span className="shrink-0 text-xs text-fg-subtle">
                    {ROLE_LABELS[workspace.role]}
                  </span>
                </MenuItem>
              ))}
            </div>
            <MenuDivider />
            <MenuHeading>Neue Organisation</MenuHeading>
            {canCreate ? (
              <MenuItem
                icon="add"
                onClick={() => {
                  close();
                  setDialog('create');
                }}
              >
                Eigene erstellen
              </MenuItem>
            ) : (
              // One own organisation per account (BER-130) – handing it over frees the slot.
              <div className="flex items-start gap-2.5 px-2.5 py-1.5 text-body text-fg-subtle">
                <Icon name="add" size={18} className="shrink-0 opacity-50" />
                <span className="flex flex-col gap-0.5">
                  <span>Eigene erstellen</span>
                  <span className="text-xs leading-4">
                    Du hast bereits eine eigene. Übergib sie an jemand anderen, um eine neue zu
                    gründen.
                  </span>
                </span>
              </div>
            )}
            <MenuItem
              icon="personAdd"
              onClick={() => {
                close();
                setDialog('join');
              }}
            >
              Mit Einladung beitreten
            </MenuItem>
            <MenuDivider />
            {current && (
              <MenuItem
                icon="settings"
                onClick={() => {
                  close();
                  void navigate(routes.workspaceSettings(current.id));
                }}
              >
                Organisation verwalten
              </MenuItem>
            )}
            {invites.length > 0 && (
              <>
                <MenuDivider />
                <MenuHeading>Einladungen</MenuHeading>
                <PendingInvites invites={invites} onError={showToast} compact />
              </>
            )}
          </>
        )}
      </HeaderPopover>
      <CreateWorkspaceDialog open={dialog === 'create'} onClose={() => setDialog(null)} />
      <JoinWorkspaceDialog open={dialog === 'join'} onClose={() => setDialog(null)} />
      <Toast toast={toast} />
    </>
  );
}
