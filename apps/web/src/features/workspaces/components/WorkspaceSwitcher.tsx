import { useState } from 'react';
import { useNavigate } from 'react-router';
import { routes } from '@/app/routes';
import { useMe } from '@/lib/queries';
import { Icon, Toast, useToast } from '@/ui';
import { ROLE_LABELS } from '../lib/roles';
import { useActiveWorkspace } from '../useWorkspace';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';
import { HeaderPopover, PopoverDivider, PopoverHeading, PopoverItem } from './HeaderPopover';
import { PendingInvites } from './PendingInvites';
import { WorkspaceMark } from './WorkspaceMark';

/** Header: current organisation with a menu to switch, found one, open its settings and join invites. */
export function WorkspaceSwitcher() {
  const { data: me } = useMe();
  const current = useActiveWorkspace();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
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
            {current ? <WorkspaceMark name={current.name} /> : <Icon name="folder" size={20} />}
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
                  icon={<WorkspaceMark name={workspace.name} />}
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
            {canCreate ? (
              <PopoverItem
                icon={<Icon name="add" size={18} className="text-fg-subtle" />}
                onSelect={() => {
                  close();
                  setCreating(true);
                }}
              >
                Neue Organisation
              </PopoverItem>
            ) : (
              // One self-founded organisation per account (BER-130).
              <div className="flex items-start gap-2.5 px-2.5 py-1.5 text-[13px] text-fg-subtle">
                <Icon name="add" size={18} className="shrink-0 opacity-50" />
                <span className="flex flex-col gap-0.5">
                  <span>Neue Organisation</span>
                  <span className="text-xs leading-4">
                    Du hast bereits eine eigene Organisation. Weiteren trittst du per Einladung bei.
                  </span>
                </span>
              </div>
            )}
            {current && (
              <PopoverItem
                icon={<Icon name="person" size={18} className="text-fg-subtle" />}
                onSelect={() => {
                  close();
                  void navigate(routes.workspaceSettings(current.id));
                }}
              >
                Einstellungen & Mitglieder
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
      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
      <Toast toast={toast} />
    </>
  );
}
