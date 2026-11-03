import { INTEGRATIONS_NAV, IntegrationsPanel } from '@/features/integrations';
import { useMe } from '@/lib/api';
import { routes } from '@/lib/routes';
import { LoadingState, Notice, TextLink, Toast, useToast } from '@/ui';
import { SectionNav } from '@/shell/layouts/SectionNav';
import { SETUP_PATH } from '../lib/setup-form';

/**
 * The instance's integrations – AI models, speech to text, photos – for every workspace, and per
 * kind its rules for them, for all and for single ones apart. They save on their own, without a restart, and only
 * for the instance admin signed in: the setup token opens the settings, not these keys.
 */
export function IntegrationsTab() {
  const me = useMe();
  const [toast, showToast] = useToast();
  if (me.isPending) return <LoadingState padding="lg" />;
  if (!me.data?.user?.isInstanceAdmin) {
    return (
      <Notice tone="info" title="Nur angemeldet als Instanz-Admin">
        Die Integrationen stellt der Instanz-Admin ein, angemeldet mit dem eigenen Konto.{' '}
        <TextLink href={routes.login(SETUP_PATH)} variant="inline" weight="medium">
          Zur Anmeldung
        </TextLink>
      </Notice>
    );
  }
  return (
    <div className="relative flex flex-col gap-6">
      {/* Beside the 720px column, where the wide screen has room; out of the flow. */}
      <div className="absolute inset-y-0 right-full mr-12 hidden w-44 xl:block">
        <SectionNav sections={INTEGRATIONS_NAV} />
      </div>
      <IntegrationsPanel workspaceId={null} onNotify={showToast} />
      <Toast toast={toast} />
    </div>
  );
}
