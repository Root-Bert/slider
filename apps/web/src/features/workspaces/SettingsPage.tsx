import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { routes } from '@/lib/routes';
import { SettingsLayout } from '@/shell/layouts/SettingsLayout';
import { useToast, type IconName } from '@/ui';
import { useAccount } from '@/features/auth';
import { MembersSection } from './components/MembersSection';
import { SsoSection } from './components/SsoSection';
import { WorkspaceAiSection } from './components/WorkspaceAiSection';
import { UsageSection } from './components/PlanUsage';
import {
  DeleteSection,
  DomainSection,
  GeneralSection,
  LeaveSection,
} from './components/WorkspaceSections';
import { Part } from './components/SettingsPart';
import { WorkspaceMark } from './components/WorkspaceMark';
import { canDeleteWorkspace } from './lib/roles';
import { useWorkspace } from './hooks/useWorkspace';

/** The page's sections, in order – each wrapped by `Part`, listed in the nav at the side. */
const SECTIONS = {
  usage: { id: 'nutzung', title: 'Plan & Nutzung', icon: 'cloud' },
  general: { id: 'allgemein', title: 'Allgemein', icon: 'settings' },
  domain: { id: 'domain', title: 'Beitritt per Domain', icon: 'link' },
  sso: { id: 'firmen-login', title: 'Firmen-Login', icon: 'key' },
  members: { id: 'mitglieder', title: 'Mitglieder', icon: 'manageAccounts' },
  ai: { id: 'ki', title: 'KI', icon: 'autoAwesome' },
  leave: { id: 'verlassen', title: 'Verlassen', icon: 'logout' },
  delete: { id: 'loeschen', title: 'Löschen', icon: 'delete' },
} as const satisfies Record<string, { id: string; title: string; icon: IconName }>;
const NAV = Object.values(SECTIONS);

/**
 * `/w/:workspaceId/einstellungen` – plan usage (BER-130), name, joining by domain (BER-148),
 * company login (BER-162), members, invitations, leave and delete (BER-129). `#einladen` scrolls to the members card with the invite row.
 */
export function Component() {
  const workspace = useWorkspace();
  const { user, domainJoin } = useAccount();
  const [toast, showToast] = useToast();
  const { hash } = useLocation();

  // `#einladen` from the share dialog: React Router doesn't scroll to anchors by itself.
  useEffect(() => {
    if (!hash) return;
    try {
      document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
    } catch {
      // A malformed `#%…` from a hand-edited link: nothing to scroll to, not a crashed page.
    }
  }, [hash]);

  return (
    <SettingsLayout
      docTitle={`Einstellungen | ${workspace.name} | Slider`}
      title={workspace.name}
      leading={<WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} size={40} />}
      back={{ to: routes.workspace(workspace.id) }}
      nav={NAV}
      toast={toast}
    >
      <Part section={SECTIONS.usage}>
        <UsageSection workspace={workspace} />
      </Part>
      <Part section={SECTIONS.general}>
        <GeneralSection key={workspace.id} workspace={workspace} onNotify={showToast} />
      </Part>
      <Part section={SECTIONS.domain}>
        <DomainSection
          workspace={workspace}
          email={user.email}
          enabled={domainJoin}
          onNotify={showToast}
        />
      </Part>
      <Part section={SECTIONS.sso}>
        <SsoSection workspace={workspace} enabled={domainJoin} onNotify={showToast} />
      </Part>
      <Part section={SECTIONS.members}>
        <MembersSection workspace={workspace} userId={user.id} onNotify={showToast} />
      </Part>
      <Part section={SECTIONS.ai}>
        <WorkspaceAiSection workspace={workspace} onNotify={showToast} />
      </Part>
      <Part section={SECTIONS.leave}>
        <LeaveSection workspace={workspace} userId={user.id} />
      </Part>
      {canDeleteWorkspace(workspace.role) && (
        <Part section={SECTIONS.delete}>
          <DeleteSection workspace={workspace} />
        </Part>
      )}
    </SettingsLayout>
  );
}
