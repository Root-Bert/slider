import { useEffect } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { routes } from '@/lib/routes';
import { SettingsLayout } from '@/shell/layouts/SettingsLayout';
import { AppTabs } from '@/shell/AppTabs';
import { useToast, type IconName } from '@/ui';
import { useAccount } from '@/features/auth';
import {
  INTEGRATION_GROUPS,
  IntegrationsPanel,
  workspaceIntegrationsNav,
  type IntegrationGroup,
} from '@/features/integrations';
import { AgentAvatarsSection } from './components/AgentAvatarsSection';
import { CloudUsage } from './components/CloudUsage';
import { MembersSection } from './components/MembersSection';
import { SsoSection } from './components/SsoSection';
import { UsageSection } from './components/PlanUsage';
import {
  DeleteSection,
  DomainSection,
  GeneralSection,
  LeaveSection,
} from './components/WorkspaceSections';
import { Part } from './components/SettingsPart';
import { WorkspaceMark } from './components/WorkspaceMark';
import { canDeleteWorkspace, canManageIntegrations } from './lib/roles';
import { useWorkspace } from './hooks/useWorkspace';

/** The page's sections, in order – each wrapped by `Part`, listed in the nav at the side. */
const SECTIONS = {
  usage: { id: 'nutzung', title: 'Plan & Nutzung', icon: 'cloud' },
  general: { id: 'allgemein', title: 'Allgemein', icon: 'settings' },
  files: { id: 'dateien', title: 'Dateien', icon: 'folder' },
  agents: { id: 'agenten', title: 'Agenten', icon: 'autoAwesome' },
  domain: { id: 'domain', title: 'Beitritt per Domain', icon: 'link' },
  sso: { id: 'firmen-login', title: 'Firmen-Login', icon: 'key' },
  members: { id: 'mitglieder', title: 'Mitglieder', icon: 'manageAccounts' },
  leave: { id: 'verlassen', title: 'Verlassen', icon: 'logout' },
  delete: { id: 'loeschen', title: 'Löschen', icon: 'delete' },
} as const satisfies Record<string, { id: string; title: string; icon: IconName }>;
const NAV = Object.values(SECTIONS);
/**
 * The page's tabs, by what they are about – never by app, since what the AI, speech and pictures
 * run on serves every app: the workspace itself, then the three parts of its integrations
 * (admins only). The path keeps `integrationen` for the first of them, the header's button.
 */
type SettingsTab = 'workspace' | IntegrationGroup;
const TAB_PATHS = {
  integrationen: 'ki',
  sprache: 'sprache',
  bilder: 'bilder',
} as const satisfies Record<string, IntegrationGroup>;
const pathOf = (tab: IntegrationGroup) =>
  (Object.keys(TAB_PATHS) as (keyof typeof TAB_PATHS)[]).find((key) => TAB_PATHS[key] === tab)!;
const TABS: readonly { value: SettingsTab; label: string; icon: IconName }[] = [
  { value: 'workspace', label: 'Workspace', icon: 'settings' },
  ...(Object.keys(INTEGRATION_GROUPS) as IntegrationGroup[]).map((value) => ({
    value,
    label: INTEGRATION_GROUPS[value].label,
    icon: INTEGRATION_GROUPS[value].icon,
  })),
];
const titleOf = (tab: SettingsTab) =>
  tab === 'workspace' ? 'Einstellungen' : INTEGRATION_GROUPS[tab].label;

/**
 * `/w/:workspaceId/einstellungen` – plan usage (BER-130), name, joining by domain (BER-148),
 * company login (BER-162), members, invitations, leave and delete (BER-129). `#einladen` scrolls to the members card with the invite row.
 * Cloud's files stand among them, marked as Cloud's. Admins get the integrations beside it, a
 * tab per subject – „KI“ (`/einstellungen/integrationen`), „Sprache“, „Bilder“: the services the workspace works with, within what the instance
 * allows.
 */
export function Component() {
  const workspace = useWorkspace();
  const { user, domainJoin } = useAccount();
  const [toast, showToast] = useToast();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const { tab: tabParam } = useParams();
  const integrations = canManageIntegrations(workspace.role);
  const tab: SettingsTab =
    tabParam && tabParam in TAB_PATHS ? TAB_PATHS[tabParam as keyof typeof TAB_PATHS] : 'workspace';

  // `#einladen` from the share dialog: React Router doesn't scroll to anchors by itself.
  useEffect(() => {
    if (!hash) return;
    try {
      document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
    } catch {
      // A malformed `#%…` from a hand-edited link: nothing to scroll to, not a crashed page.
    }
  }, [hash]);

  // Cloud's files were a tab of their own once: now a section of the workspace's.
  if (tabParam === 'office')
    return (
      <Navigate to={`${routes.workspaceSettings(workspace.id)}#${SECTIONS.files.id}`} replace />
    );
  // An unknown tab, or the integrations for a member who isn't admin: the workspace tab.
  if ((tabParam !== undefined && tab === 'workspace') || (tab !== 'workspace' && !integrations))
    return <Navigate to={routes.workspaceSettings(workspace.id)} replace />;

  return (
    <SettingsLayout
      docTitle={`${titleOf(tab)} | ${workspace.name} | Slider`}
      title={workspace.name}
      leading={<WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} size={40} />}
      back="app"
      header="none"
      nav={tab === 'workspace' ? NAV : workspaceIntegrationsNav(tab)}
      toast={toast}
    >
      {integrations && (
        <AppTabs<SettingsTab>
          label="Workspace oder seine Integrationen"
          value={tab}
          onChange={(next) =>
            void navigate(
              next === 'workspace'
                ? routes.workspaceSettings(workspace.id)
                : `${routes.workspaceSettings(workspace.id)}/${pathOf(next)}`,
            )
          }
          segments={TABS}
        />
      )}
      {tab !== 'workspace' ? (
        <IntegrationsPanel workspaceId={workspace.id} group={tab} onNotify={showToast} />
      ) : (
        <>
          <Part section={SECTIONS.usage}>
            <UsageSection workspace={workspace} />
          </Part>
          <Part section={SECTIONS.general}>
            <GeneralSection key={workspace.id} workspace={workspace} onNotify={showToast} />
          </Part>
          <Part section={SECTIONS.files}>
            {/* Two cards of its own (files, areas): spaced like the page's sections. */}
            <div className="flex flex-col gap-6">
              <CloudUsage workspaceId={workspace.id} admin={workspace.role === 'admin'} />
            </div>
          </Part>
          <Part section={SECTIONS.agents}>
            <AgentAvatarsSection workspace={workspace} onNotify={showToast} />
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
          <Part section={SECTIONS.leave}>
            <LeaveSection workspace={workspace} userId={user.id} />
          </Part>
          {canDeleteWorkspace(workspace.role) && (
            <Part section={SECTIONS.delete}>
              <DeleteSection workspace={workspace} />
            </Part>
          )}
        </>
      )}
    </SettingsLayout>
  );
}
