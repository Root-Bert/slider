import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { routes } from '@/lib/routes';
import { useMe } from '@/lib/api';
import {
  cn,
  Icon,
  IconButton,
  MenuDivider,
  MenuHeading,
  MenuItem,
  PopoverPanel,
  Toast,
  useIsNarrow,
  useToast,
} from '@/ui';
import { canManageMembers, ROLE_LABELS, switcherLabel } from '../lib/roles';
import { useActiveWorkspace } from '../hooks/useWorkspace';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';
import { DomainWorkspaceRow } from './DomainWorkspaceRow';
import { JoinWorkspaceDialog } from './JoinWorkspaceDialog';
import { HeaderPopover } from './HeaderPopover';
import { PendingInvites } from './PendingInvites';
import { WorkspaceMark } from './WorkspaceMark';

/**
 * Header: current workspace with a menu to switch, invite people to a workspace, open its
 * settings, found or join another one (behind "Neuer Workspace"), accept pending invites and
 * join the company workspace of one's domain (BER-148).
 */
export function WorkspaceSwitcher() {
  const { data: me } = useMe();
  const current = useActiveWorkspace();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'create' | 'join' | null>(null);
  const [toast, showToast] = useToast();
  const workspaces = me?.workspaces ?? [];
  const invites = me?.pendingInvites ?? [];
  const company = me?.domainWorkspace ?? null;
  const canCreate = me?.limits?.canCreateWorkspace ?? true;
  if (!me?.user) return null;

  const label = switcherLabel(current?.name ?? null, invites.length);

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
              {current?.name ?? 'Workspaces'}
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
            <MenuHeading>Workspaces</MenuHeading>
            <div className="flex max-h-[min(320px,50vh)] flex-col gap-0.5 overflow-y-auto">
              {workspaces.map((workspace) => (
                // Each row carries its own settings button – and for admins an invite button – so
                // every workspace is one click from its management; they sit over the row's
                // right edge.
                <div key={workspace.id} className="group relative">
                  <MenuItem
                    selected={workspace.id === current?.id}
                    icon={<WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} />}
                    className={cn(
                      canManageMembers(workspace.role) ? 'pr-[68px]' : 'pr-10',
                      'group-hover:bg-hover',
                    )}
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
                  <div className="absolute top-1/2 right-1 flex -translate-y-1/2 gap-0.5">
                    {canManageMembers(workspace.role) && (
                      <IconButton
                        icon="personAdd"
                        label={`Mitglieder zu ${workspace.name} einladen`}
                        variant="subtle"
                        size="compact"
                        onClick={() => {
                          close();
                          void navigate(routes.workspaceInvites(workspace.id));
                        }}
                      />
                    )}
                    <IconButton
                      icon="manageAccounts"
                      label={`${workspace.name} verwalten`}
                      variant="subtle"
                      size="compact"
                      onClick={() => {
                        close();
                        void navigate(routes.workspaceSettings(workspace.id));
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <MenuDivider />
            <NewWorkspaceFlyout
              canCreate={canCreate}
              onPick={(choice) => {
                close();
                setDialog(choice);
              }}
            />
            {company && (
              <>
                <MenuDivider />
                <MenuHeading>Deine Firma</MenuHeading>
                <DomainWorkspaceRow workspace={company} onError={showToast} onJoined={close} />
              </>
            )}
            {invites.length > 0 && (
              <>
                <MenuDivider />
                <MenuHeading>Einladungen</MenuHeading>
                <PendingInvites invites={invites} onError={showToast} onJoined={close} />
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

/**
 * "Neuer Workspace" as one row: a click folds out the two ways to get one – joining by
 * invitation first, founding one's own second – beside the menu (below the row on narrow screens,
 * where there is no room to the side). It closes with the menu, which unmounts it.
 */
function NewWorkspaceFlyout({
  canCreate,
  onPick,
}: {
  canCreate: boolean;
  onPick: (choice: 'create' | 'join') => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const beside = !useIsNarrow();

  const choices = (
    <>
      <MenuItem icon="link" onClick={() => onPick('join')}>
        Mit Einladung beitreten
      </MenuItem>
      {canCreate ? (
        <MenuItem icon="add" onClick={() => onPick('create')}>
          Eigenen erstellen
        </MenuItem>
      ) : (
        // One own workspace per account (BER-130) – handing it over frees the slot.
        <div className="flex items-start gap-2.5 px-2.5 py-1.5 text-body text-fg-subtle">
          <Icon name="add" size={18} className="shrink-0 opacity-50" />
          <span className="flex flex-col gap-0.5">
            <span>Eigenen erstellen</span>
            <span className="text-xs leading-4">
              Du hast bereits einen eigenen. Übergib ihn an jemand anderen, um einen neuen zu
              gründen.
            </span>
          </span>
        </div>
      )}
    </>
  );

  return (
    <div className="relative">
      <MenuItem
        icon="add"
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(open && 'bg-hover')}
        trailing={
          <Icon
            name="chevronRight"
            size={18}
            className={cn(
              'shrink-0 text-fg-subtle transition-transform',
              open && !beside && 'rotate-90',
            )}
          />
        }
        onClick={() => setOpen((value) => !value)}
      >
        Neuer Workspace
      </MenuItem>
      {open &&
        (beside ? (
          <PopoverPanel
            id={panelId}
            position="none"
            padding="md"
            className="absolute -top-1.5 left-full ml-2.5 w-[260px]"
          >
            {choices}
          </PopoverPanel>
        ) : (
          <div id={panelId} className="flex flex-col pl-4">
            {choices}
          </div>
        ))}
    </div>
  );
}
