import { CenteredCard } from '@/shell/layouts/CenteredLayout';
import { useNextcloudConnect } from '@/features/nextcloud';
import { Button, Icon, NextcloudMark, Spinner } from '@/ui';
import type { NoAccessInfo } from '../hooks/useLinkImport';

/** A3: the link points to a file in a Nextcloud Slider has no account at yet. */
export function NoAccessCard({
  info,
  onNextcloudConnected = () => {},
  onUploadInstead,
}: {
  info: NoAccessInfo;
  /** The account is connected: import the link again. */
  onNextcloudConnected?: () => void;
  onUploadInstead: () => void;
}) {
  return (
    <NextcloudNoAccess info={info} onConnected={onNextcloudConnected} onUpload={onUploadInstead} />
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
          Stattdessen Datei hochladen
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
