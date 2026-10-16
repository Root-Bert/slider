import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { routes } from '@/lib/routes';
import { SettingsLayout } from '@/shell/layouts/SettingsLayout';
import { useToast } from '@/ui';
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
    <SettingsLayout
      docTitle={`Einstellungen · ${workspace.name} · Slider`}
      title={workspace.name}
      leading={<WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} size={40} />}
      back={{ to: routes.workspace(workspace.id) }}
      toast={toast}
    >
      <UsageSection workspace={workspace} />
      <GeneralSection key={workspace.id} workspace={workspace} onNotify={showToast} />
      <MembersSection workspace={workspace} userId={user.id} onNotify={showToast} />
      <LeaveSection workspace={workspace} userId={user.id} onNotify={showToast} />
      {canDeleteWorkspace(workspace.role) && (
        <DeleteSection workspace={workspace} onNotify={showToast} />
      )}
    </SettingsLayout>
  );
}
