import { useState } from 'react';
import { useNavigate } from 'react-router';
import { routes } from '@/app/routes';
import { useMe } from '@/lib/queries';
import { Icon, Toast, useToast } from '@/ui';
import { ROLE_LABELS } from '../lib/roles';
import { useActiveWorkspace } from '../useWorkspace';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';
import { JoinWorkspaceDialog } from './JoinWorkspaceDialog';
import { HeaderPopover, PopoverDivider, PopoverHeading, PopoverItem } from './HeaderPopover';
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
        triggerClassName="flex h-9 max-w-[240px] items-center gap-2 rounded-control pr-2 pl-1.5 text-fg transition-colors hover:bg-white/10 aria-expanded:bg-white/10"
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
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-thumb bg-info px-1 text-[10px] font-semibold text-white">
                {invites.length}
              </span>
            )}
            <Icon name="expandMore" size={18} className="shrink-0 text-fg-subtle" />
          </>
        )}
      >
        {(close) => (
          <>
            <PopoverHeading>Organisationen</PopoverHeading>
            <div className="flex max-h-[min(320px,50vh)] flex-col gap-0.5 overflow-y-auto">
              {workspaces.map((workspace) => (
                <PopoverItem
                  key={workspace.id}
                  selected={workspace.id === current?.id}
                  icon={<WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} />}
                  trailing={
                    workspace.id === current?.id ? (
                      <Icon name="check" size={18} className="text-fg-muted" />
                    ) : null
                  }
                  onSelect={() => {
                    close();
                    void navigate(routes.workspace(workspace.id));
                  }}
                >
                  <span className="truncate">{workspace.name}</span>
                  <span className="shrink-0 text-xs text-fg-subtle">
                    {ROLE_LABELS[workspace.role]}
                  </span>
                </PopoverItem>
              ))}
            </div>
            <PopoverDivider />
            <PopoverHeading>Neue Organisation</PopoverHeading>
            {canCreate ? (
              <PopoverItem
                icon={<Icon name="add" size={18} className="text-fg-subtle" />}
                onSelect={() => {
                  close();
                  setDialog('create');
                }}
              >
                Eigene erstellen
              </PopoverItem>
            ) : (
              // One own organisation per account (BER-130) – handing it over frees the slot.
              <div className="flex items-start gap-2.5 px-2.5 py-1.5 text-[13px] text-fg-subtle">
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
            <PopoverItem
              icon={<Icon name="personAdd" size={18} className="text-fg-subtle" />}
              onSelect={() => {
                close();
                setDialog('join');
              }}
            >
              Mit Einladung beitreten
            </PopoverItem>
            <PopoverDivider />
            {current && (
              <PopoverItem
                icon={<Icon name="settings" size={18} className="text-fg-subtle" />}
                onSelect={() => {
                  close();
                  void navigate(routes.workspaceSettings(current.id));
                }}
              >
                Organisation verwalten
              </PopoverItem>
            )}
            {invites.length > 0 && (
              <>
                <PopoverDivider />
                <PopoverHeading>Einladungen</PopoverHeading>
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
