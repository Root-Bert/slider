import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { routes } from '@/lib/routes';
import { AppHeader } from '@/shell/AppHeader';
import { Icon, Toast, useToast } from '@/ui';
import { useAccount } from '@/features/auth';
import { MembersSection } from './components/MembersSection';
import { UsageSection } from './components/PlanUsage';
import { DeleteSection, GeneralSection, LeaveSection } from './components/WorkspaceSections';
import { WorkspaceMark } from './components/WorkspaceMark';
import { canDeleteWorkspace } from './lib/roles';
import { useWorkspace } from './hooks/useWorkspace';

/**
 * `/w/:workspaceId/einstellungen` – plan usage (BER-130), name, members, invitations, leave and
 * delete (BER-129). `#einladen` scrolls to the members card with the invite row.
 */
export function Component() {
  const workspace = useWorkspace();
  const { user } = useAccount();
  const [toast, showToast] = useToast();
  const { hash } = useLocation();

  // `#einladen` from the share dialog: React Router doesn't scroll to anchors by itself.
  useEffect(() => {
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [hash]);

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
              <WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} size={40} />
              <h1 className="min-w-0 truncate text-[28px] leading-tight font-semibold tracking-tight text-fg">
                {workspace.name}
              </h1>
            </div>
          </div>

          <UsageSection workspace={workspace} />
          <GeneralSection key={workspace.id} workspace={workspace} onNotify={showToast} />
          <MembersSection workspace={workspace} userId={user.id} onNotify={showToast} />
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
