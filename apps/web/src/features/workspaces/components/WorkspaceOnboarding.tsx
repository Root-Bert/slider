import { useNavigate } from 'react-router';
import { routes } from '@/lib/routes';
import { AppHeader } from '@/shell/AppHeader';
import { Divider, PageHeader, Section, Toast, useToast } from '@/ui';
import { useAccount } from '@/features/auth';
import { CreateWorkspaceForm } from './CreateWorkspaceForm';
import { DomainWorkspaceRow } from './DomainWorkspaceRow';
import { JoinByCodeForm } from './JoinByCodeForm';
import { PendingInvites } from './PendingInvites';

/**
 * Without an organisation (BER-130): join the company organisation of one's domain (BER-148), or
 * found one, or join one by invitation – a pending e-mail invite, or a pasted link or code.
 * Signing up without either founds one right away, so this is mostly seen by people whose
 * company is already in Slider, or who were invited.
 */
export function WorkspaceOnboarding() {
  const { user, pendingInvites, domainWorkspace, canCreateWorkspace } = useAccount();
  const navigate = useNavigate();
  const [toast, showToast] = useToast();
  const firstName = user.name.split(/\s+/)[0] ?? user.name;
  const invited = pendingInvites.length > 0;

  const join = (
    <Section
      key="join"
      density="compact"
      icon="personAdd"
      title="Organisation beitreten"
      description={
        invited
          ? 'Du wurdest eingeladen. Oder füge einen Einladungslink ein.'
          : 'Füge den Einladungslink oder -code ein, den du bekommen hast.'
      }
    >
      {invited && (
        <div className="-mx-2">
          <PendingInvites invites={pendingInvites} onError={showToast} />
        </div>
      )}
      <JoinByCodeForm onJoin={(token) => void navigate(routes.join(token))} />
    </Section>
  );

  const company = domainWorkspace && (
    <Section
      key="company"
      density="compact"
      icon="personAdd"
      title="Deiner Firma beitreten"
      description={`Für @${domainWorkspace.domain} gibt es schon eine Organisation. Du trittst als Mitglied bei.`}
    >
      <DomainWorkspaceRow workspace={domainWorkspace} onError={showToast} />
    </Section>
  );

  const create = (
    <Section
      key="create"
      density="compact"
      icon="add"
      title={company ? 'Eigene Organisation erstellen' : 'Organisation erstellen'}
      description={
        canCreateWorkspace
          ? 'Du bist Admin und kannst danach dein Team einladen. Neue Organisationen starten im Free-Plan.'
          : 'Du hast bereits eine eigene Organisation. Übergib sie an jemand anderen, um eine neue zu gründen – weiteren trittst du per Einladung bei.'
      }
    >
      {canCreateWorkspace && (
        <CreateWorkspaceForm
          autoFocus={!invited && !company}
          onCreated={(workspace) => void navigate(routes.workspace(workspace.id))}
        />
      )}
    </Section>
  );

  return (
    <div className="dot-grid flex min-h-full flex-col">
      <title>Willkommen | Slider</title>
      <AppHeader />
      <main className="flex flex-1 justify-center px-4 pt-[clamp(8px,6vh,72px)] pb-16">
        <div className="flex w-full max-w-[456px] flex-col gap-6">
          <PageHeader
            align="center"
            title={`Willkommen, ${firstName}`}
            subtitle={
              domainWorkspace
                ? `${domainWorkspace.name} nutzt Slider schon. Tritt bei oder erstelle deine eigene Organisation.`
                : 'In Slider liegt alles in Organisationen. Erstelle deine eigene oder tritt einer bei, in die du eingeladen wurdest.'
            }
          />

          {/* The company first, then invited people see "beitreten" before "erstellen" – in the
              DOM, not just visually, so focus and screen readers follow the same order. */}
          <div className="flex flex-col gap-6">
            {company && (
              <>
                {company}
                <Divider label="oder" />
              </>
            )}
            {invited ? join : create}
            <Divider label="oder" />
            {invited ? create : join}
          </div>
        </div>
      </main>
      <Toast toast={toast} />
    </div>
  );
}
