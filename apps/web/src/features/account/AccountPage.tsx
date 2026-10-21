import { useSearchParams } from 'react-router';
import { routes } from '@/lib/routes';
import { SettingsLayout } from '@/shell/layouts/SettingsLayout';
import { isLoginError, LoginErrorBanner, useAccount } from '@/features/auth';
import { Avatar, Section, TextField, useToast } from '@/ui';
import { LoginsSection, NameField, PasskeysSection } from './components/AccountSections';
import { DeleteAccountSection, ExportDataSection } from './components/DataSections';
import { StorageSection } from './components/StorageSection';

/** The groups inside a card, split by hairlines. */
const GROUPS =
  'flex flex-col divide-y divide-hairline [&>*]:py-5 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0';

/**
 * `/konto` – "Konto & Anmeldung": who you are, how you sign in ("Anmeldung": Microsoft, Google,
 * SSO, passkeys), where Slider reads files from ("Speicherorte": Microsoft, Nextcloud), and your
 * data: download it, delete the account (BER-145). `?linkError=` after a failed "Verbinden";
 * `?nextcloud=<server>&returnTo=` to connect that Nextcloud again (a review's banner). Your
 * colour, how decks open and the instance settings live on `/einstellungen`.
 */
export function Component() {
  const { user, viewer } = useAccount();
  const [toast, showToast] = useToast();
  const [searchParams] = useSearchParams();
  const linkError = searchParams.get('linkError');

  return (
    <SettingsLayout
      docTitle="Konto & Anmeldung | Slider"
      title="Konto & Anmeldung"
      leading={<Avatar author={viewer.author} size={32} />}
      back={{ to: routes.reviews() }}
      toast={toast}
    >
      {isLoginError(linkError) && <LoginErrorBanner code={linkError} />}

      <Section
        title="Profil"
        description="Den Namen sehen die anderen an deinen Kommentaren. Die Adresse kommt von deiner Anmeldung."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <NameField name={user.name} onNotify={showToast} />
          <TextField label="E-Mail" value={user.email} readOnly />
        </div>
      </Section>

      <Section title="Anmeldung" description="Mit jedem dieser Wege kommst du in dieses Konto.">
        <div className={GROUPS}>
          <LoginsSection />
          <PasskeysSection onNotify={showToast} />
        </div>
      </Section>

      <StorageSection
        onNotify={showToast}
        reconnect={searchParams.get('nextcloud')}
        returnTo={searchParams.get('returnTo')}
      />
      <ExportDataSection />
      <DeleteAccountSection email={user.email} />
    </SettingsLayout>
  );
}
