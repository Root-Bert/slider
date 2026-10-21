import { CenteredCard } from '@/shell/layouts/CenteredLayout';
import { useNextcloudConnect } from '@/features/nextcloud';
import { Button, GoogleMark, Icon, NextcloudMark, Spinner, TextLink } from '@/ui';
import type { NoAccessInfo } from '../hooks/useLinkImport';

const SHARING_HELP_URL =
  'https://support.microsoft.com/de-de/office/dateien-oder-ordner-in-microsoft-365-freigeben-1fe37332-0f9a-4719-970e-d2578da4941c';

/** Figma A3 copy, two lines. */
const LOGIN_COPY = [
  'Die Präsentation ist nur für deine Organisation freigegeben.',
  'Melde dich mit deinem Microsoft-Konto an oder lade die Datei hoch.',
];

/** A3: the link points to a file only people in the owner's organisation may open. */
export function NoAccessCard({
  info,
  connected = false,
  onSignIn,
  onNextcloudConnected = () => {},
  onPickGoogle = () => {},
  googlePending = false,
  onUploadInstead,
}: {
  info: NoAccessInfo;
  /** A Microsoft account is connected already: the sign-in adds another one. */
  connected?: boolean;
  /** Leaves for `info.loginUrl` (the link form remembers the link first, see `link-login.ts`). */
  onSignIn: () => void;
  /** `nextcloud`: the account is connected – import the link again. */
  onNextcloudConnected?: () => void;
  /** `google`: opens Google's picker on the linked file (connecting an account first). */
  onPickGoogle?: (fileId?: string) => void;
  googlePending?: boolean;
  onUploadInstead: () => void;
}) {
  if (info.kind === 'google') {
    return (
      <GoogleNoAccess
        info={info}
        pending={googlePending}
        onPick={() => onPickGoogle(info.googleFileId)}
        onUpload={onUploadInstead}
      />
    );
  }
  if (info.kind === 'nextcloud') {
    return (
      <NextcloudNoAccess
        info={info}
        onConnected={onNextcloudConnected}
        onUpload={onUploadInstead}
      />
    );
  }
  return (
    <CenteredCard
      headingLevel={2}
      density="compact"
      icon={<Icon name="lock" size="2xl" />}
      title="Wir können diesen Link nicht öffnen"
      message={
        info.kind === 'login'
          ? LOGIN_COPY.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))
          : info.message
      }
    >
      <p className="glass inline-flex max-w-full items-center gap-1.5 rounded-chip py-1.5 pr-3 pl-2.5 text-xs text-fg-muted">
        <Icon name="lock" size="md" className="shrink-0" />
        <span className="truncate">{info.host} | Nur Personen in deiner Organisation</span>
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {info.kind === 'consent' ? (
          <Button variant="secondary" size="lg" onClick={onSignIn}>
            Erneut anmelden
          </Button>
        ) : info.loginUrl ? (
          <Button size="lg" onClick={onSignIn}>
            {connected || info.kind === 'forbidden'
              ? 'Weiteres Microsoft-Konto verbinden'
              : 'Mit Microsoft anmelden'}
          </Button>
        ) : (
          // Disabled buttons get no pointer events, so the explanation sits on a wrapper.
          <span title="Microsoft-Anmeldung ist nicht eingerichtet">
            <Button size="lg" disabled>
              Mit Microsoft anmelden
            </Button>
          </span>
        )}
        <Button variant="secondary" size="lg" onClick={onUploadInstead}>
          Stattdessen PPTX hochladen
        </Button>
      </div>
      <TextLink
        href={SHARING_HELP_URL}
        target="_blank"
        rel="noopener noreferrer"
        variant="underline"
        size="body"
        weight="medium"
        trailingIcon="arrowForward"
        className="leading-4.5"
      >
        Link-Freigabe ändern – so geht’s
      </TextLink>
    </CenteredCard>
  );
}

/** A3 for a file in a Nextcloud: connect an account there (popup), then the link imports. */
function NextcloudNoAccess({
  info,
  onConnected,
  onUpload,
}: {
  info: NoAccessInfo;
  onConnected: () => void;
  onUpload: () => void;
}) {
  const { state, connect, cancel } = useNextcloudConnect(onConnected);
  const waiting = state.status === 'waiting';
  return (
    <CenteredCard
      headingLevel={2}
      density="compact"
      icon={<Icon name="lock" size="2xl" />}
      title="Verbinde deine Nextcloud"
      message={state.status === 'error' ? state.message : info.message}
    >
      <p className="glass inline-flex max-w-full items-center gap-1.5 rounded-chip py-1.5 pr-3 pl-2.5 text-xs text-fg-muted">
        <NextcloudMark size={16} />
        <span className="truncate">{info.host} | Nur mit deinem Nextcloud-Konto</span>
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button size="lg" disabled={waiting} onClick={() => void connect(info.nextcloudServer)}>
          {waiting ? <Spinner size={16} /> : <NextcloudMark size={16} />}
          Mit Nextcloud verbinden
        </Button>
        <Button variant="secondary" size="lg" onClick={onUpload}>
          Stattdessen PPTX hochladen
        </Button>
      </div>
      {/* Like the connect form: the login window may be gone unnoticed, the spinner must end. */}
      {waiting && (
        <Button variant="ghost" size="sm" onClick={cancel}>
          Abbrechen
        </Button>
      )}
      <p className="max-w-[420px] text-center text-xs text-fg-subtle">
        Nextcloud erlaubt keine Nur-Lese-Freigabe. Slider liest nur Präsentationen und ändert
        nichts.
      </p>
    </CenteredCard>
  );
}

/**
 * A3 for a file in Google Drive (BER-119): Slider reads only files picked in Google's picker, so
 * the picker opens on the linked file – one click hands it over.
 */
function GoogleNoAccess({
  info,
  pending,
  onPick,
  onUpload,
}: {
  info: NoAccessInfo;
  pending: boolean;
  onPick: () => void;
  onUpload: () => void;
}) {
  return (
    <CenteredCard
      headingLevel={2}
      density="compact"
      icon={<Icon name="lock" size="2xl" />}
      title="Wähle die Präsentation in Google aus"
      message={info.message}
    >
      <p className="glass inline-flex max-w-full items-center gap-1.5 rounded-chip py-1.5 pr-3 pl-2.5 text-xs text-fg-muted">
        <GoogleMark size={16} />
        <span className="truncate">{info.host} | Nur mit deinem Google-Konto</span>
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button size="lg" loading={pending} onClick={onPick}>
          {!pending && <GoogleMark size={16} />}
          In Google Drive auswählen
        </Button>
        <Button variant="secondary" size="lg" onClick={onUpload}>
          Stattdessen PPTX hochladen
        </Button>
      </div>
      <p className="max-w-[420px] text-center text-xs text-fg-subtle">
        Slider sieht in deinem Google Drive nur die Dateien, die du selbst auswählst.
      </p>
    </CenteredCard>
  );
}
