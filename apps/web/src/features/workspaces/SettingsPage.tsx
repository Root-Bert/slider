import { Link } from 'react-router';
import { AppHeader } from '@/app/AppHeader';
import { routes } from '@/app/routes';
import { Icon, Toast, useToast } from '@/ui';
import { useAccount } from '../auth/useAccount';
import { InvitesSection } from './components/InvitesSection';
import { MembersSection } from './components/MembersSection';
import { DeleteSection, GeneralSection, LeaveSection } from './components/WorkspaceSections';
import { WorkspaceMark } from './components/WorkspaceMark';
import { canDeleteWorkspace, canManageMembers, ROLE_LABELS } from './lib/roles';
import { useWorkspace } from './useWorkspace';

/** `/w/:workspaceId/einstellungen` – name, members, invitations, leave and delete (BER-129). */
export function Component() {
  const workspace = useWorkspace();
  const { user } = useAccount();
  const [toast, showToast] = useToast();

  return (
    <div className="dot-grid min-h-full">
      <title>{`Einstellungen · ${workspace.name} · Slider`}</title>
      <AppHeader />
      <main className="flex justify-center px-4 pt-2 pb-16">
        <div className="flex w-full max-w-[720px] flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Link
              to={routes.workspace(workspace.id)}
              className="inline-flex w-fit items-center gap-1 text-[13px] text-fg-subtle hover:text-fg"
            >
              <Icon name="arrowBack" size={16} />
              Zurück zu den Reviews
            </Link>
            <div className="flex items-center gap-3">
              <WorkspaceMark name={workspace.name} size={40} />
              <div className="flex min-w-0 flex-col">
                <h1 className="truncate text-[28px] leading-tight font-semibold tracking-tight text-fg">
                  {workspace.name}
                </h1>
                <p className="text-[13px] text-fg-subtle">
                  Workspace-Einstellungen · Deine Rolle: {ROLE_LABELS[workspace.role]}
                </p>
              </div>
            </div>
          </div>

          <GeneralSection key={workspace.id} workspace={workspace} onNotify={showToast} />
          <MembersSection workspace={workspace} userId={user.id} onNotify={showToast} />
          {canManageMembers(workspace.role) && (
            <InvitesSection workspace={workspace} onNotify={showToast} />
          )}
          <LeaveSection workspace={workspace} userId={user.id} onNotify={showToast} />
          {canDeleteWorkspace(workspace.role) && (
            <DeleteSection workspace={workspace} onNotify={showToast} />
          )}
        </div>
      </main>
      <Toast toast={toast} />
    </div>
  );
}
