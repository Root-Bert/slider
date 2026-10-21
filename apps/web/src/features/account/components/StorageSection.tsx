import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { GoogleConnection, MicrosoftConnection, NextcloudConnection } from '@slider/shared';
import { providerLoginUrl } from '@/features/auth';
import { NextcloudConnectForm, nextcloudHost } from '@/features/nextcloud';
import {
  googleDriveConnectUrl,
  useAuthProviders,
  useDisconnectGoogle,
  useDisconnectMicrosoft,
  useDisconnectNextcloud,
  useGoogleConnections,
  useMicrosoftConnections,
  useNextcloudConnections,
} from '@/lib/api';
import { safeReturnTo } from '@/lib/return-to';
import {
  Badge,
  Button,
  ConfirmDialog,
  GoogleMark,
  IconTile,
  ListRow,
  Menu,
  MicrosoftMark,
  NextcloudMark,
  Notice,
  RowList,
  Section,
  Spinner,
  Subsection,
  type MenuAction,
  type ShowToast,
} from '@/ui';

/**
 * "Speicherorte" on `/konto`: the Microsoft (OneDrive & SharePoint, BER-92), Nextcloud (BER-135)
 * and Google Drive (BER-119) accounts Slider reads presentations through, in one list. One
 * "Konto verbinden" menu adds any. A Microsoft link import tries the accounts in turn; a
 * Nextcloud link goes through the account on the same server.
 */

const MICROSOFT_LOGIN_URL = '/api/auth/microsoft/login';
const ACCOUNT_PAGE = '/konto';

/** Signs in at Microsoft and comes back here; `connectionId` preselects that account. */
const microsoftConnectUrl = (connectionId?: string) =>
  providerLoginUrl(
    connectionId
      ? `${MICROSOFT_LOGIN_URL}?connection=${encodeURIComponent(connectionId)}`
      : MICROSOFT_LOGIN_URL,
    ACCOUNT_PAGE,
  );

/** "3 Reviews synchronisieren darüber". */
function syncedReviewsCopy(count: number): string {
  if (count === 0) return 'Keine Review synchronisiert darüber';
  return count === 1
    ? '1 Review synchronisiert darüber'
    : `${count} Reviews synchronisieren darüber`;
}

/** `a, b oder c`. */
const orList = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} oder ${names.at(-1)}` : (names[0] ?? '');

const microsoftLabel = (connection: MicrosoftConnection) => connection.account ?? 'Microsoft-Konto';
const googleLabel = (connection: GoogleConnection) => connection.account ?? 'Google-Konto';

type Disconnecting =
  | { kind: 'microsoft'; connection: MicrosoftConnection }
  | { kind: 'nextcloud'; connection: NextcloudConnection }
  | { kind: 'google'; connection: GoogleConnection };

/**
 * `reconnect` (from `?nextcloud=` – a review's banner sends people here) opens the Nextcloud form
 * for that server; after connecting they go back to `returnTo`. Microsoft is only offered with a
 * Microsoft app on the server (or accounts left from one).
 */
export function StorageSection({
  onNotify,
  reconnect,
  returnTo,
}: {
  onNotify: ShowToast;
  reconnect: string | null;
  returnTo: string | null;
}) {
  const navigate = useNavigate();
  const microsoft = useMicrosoftConnections();
  const nextcloud = useNextcloudConnections();
  const google = useGoogleConnections();
  const providers = useAuthProviders();
  const [addingNextcloud, setAddingNextcloud] = useState(reconnect !== null);
  const [server, setServer] = useState(reconnect);
  const [disconnecting, setDisconnecting] = useState<Disconnecting | null>(null);
  const microsoftList = microsoft.data ?? [];
  const nextcloudList = nextcloud.data ?? [];
  const googleList = google.data ?? [];
  const microsoftAvailable =
    microsoftList.length > 0 ||
    Boolean(providers.data?.providers.some((p) => p.id === 'microsoft'));
  const googleAvailable = Boolean(providers.data?.googleDrive);
  const empty = microsoftList.length === 0 && nextcloudList.length === 0 && googleList.length === 0;
  // Each backend fails on its own: an unreachable Nextcloud must not hide the Microsoft accounts.
  const errors = [microsoft.error, nextcloud.error, google.error].filter((error) => error != null);

  const openNextcloud = (at: string | null) => {
    setServer(at);
    setAddingNextcloud(true);
  };
  const closeNextcloud = () => {
    setAddingNextcloud(false);
    setServer(null);
  };
  const nextcloudConnected = (connection: NextcloudConnection) => {
    closeNextcloud();
    onNotify(`Verbunden mit Nextcloud (${nextcloudHost(connection.server)})`);
    if (returnTo) void navigate(safeReturnTo(returnTo));
  };

  const connectActions: MenuAction[] = [
    ...(microsoftAvailable
      ? [
          {
            label: 'OneDrive & SharePoint',
            icon: <MicrosoftMark size={18} />,
            onSelect: () => window.location.assign(microsoftConnectUrl()),
          },
        ]
      : []),
    ...(googleAvailable
      ? [
          {
            label: 'Google Drive',
            icon: <GoogleMark size={18} />,
            onSelect: () => window.location.assign(googleDriveConnectUrl(ACCOUNT_PAGE)),
          },
        ]
      : []),
    { label: 'Nextcloud', icon: <NextcloudMark size={18} />, onSelect: () => openNextcloud(null) },
  ];

  const connectMenu = {
    label: 'Speicherort verbinden',
    triggerText: empty ? 'Konto verbinden' : 'Weiteres Konto verbinden',
    actions: connectActions,
  };

  return (
    <Section
      title="Speicherorte"
      description="Von hier liest Slider deine Präsentationen und hält die Reviews dazu aktuell."
      aside={<Menu {...connectMenu} className="shrink-0 max-sm:hidden" />}
    >
      {errors.map((error) => (
        <p key={error.message} className="text-sm text-danger">
          {error.message}
        </p>
      ))}
      {microsoft.isPending || nextcloud.isPending || google.isPending ? (
        <Spinner size={20} className="text-fg-subtle" />
      ) : empty ? (
        errors.length === 0 &&
        !addingNextcloud && (
          <Notice tone="neutral" variant="plain">
            {`Noch kein Speicherort verbunden. Verbinde ${orList([
              ...(microsoftAvailable ? ['OneDrive', 'SharePoint'] : []),
              ...(googleAvailable ? ['Google Drive'] : []),
              'eine Nextcloud',
            ])}, um Präsentationen daraus einzufügen.`}
          </Notice>
        )
      ) : (
        <RowList>
          {microsoftList.map((connection) => (
            <ListRow
              key={connection.id}
              textGap="tight"
              leading={
                <IconTile tone="inherit">
                  <MicrosoftMark size={18} />
                </IconTile>
              }
              title={microsoftLabel(connection)}
              badge={
                connection.needsReconnect && <Badge tone="warning">Anmeldung abgelaufen</Badge>
              }
              subtitle={`OneDrive & SharePoint | ${syncedReviewsCopy(connection.deckCount)}`}
              trailing={
                <>
                  {connection.needsReconnect && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => window.location.assign(microsoftConnectUrl(connection.id))}
                    >
                      Neu verbinden
                    </Button>
                  )}
                  <Menu
                    label={`Aktionen für ${microsoftLabel(connection)}`}
                    actions={[
                      {
                        label: 'Trennen',
                        icon: 'delete',
                        tone: 'danger',
                        onSelect: () => setDisconnecting({ kind: 'microsoft', connection }),
                      },
                    ]}
                  />
                </>
              }
            />
          ))}
          {googleList.map((connection) => (
            <ListRow
              key={connection.id}
              textGap="tight"
              leading={
                <IconTile tone="inherit">
                  <GoogleMark size={18} />
                </IconTile>
              }
              title={googleLabel(connection)}
              badge={connection.needsReconnect && <Badge tone="warning">Verbindung getrennt</Badge>}
              subtitle={`Google Drive | ${syncedReviewsCopy(connection.deckCount)}`}
              trailing={
                <>
                  {connection.needsReconnect && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        window.location.assign(googleDriveConnectUrl(ACCOUNT_PAGE, connection.id))
                      }
                    >
                      Neu verbinden
                    </Button>
                  )}
                  <Menu
                    label={`Aktionen für ${googleLabel(connection)}`}
                    actions={[
                      {
                        label: 'Trennen',
                        icon: 'delete',
                        tone: 'danger',
                        onSelect: () => setDisconnecting({ kind: 'google', connection }),
                      },
                    ]}
                  />
                </>
              }
            />
          ))}
          {nextcloudList.map((connection) => (
            <ListRow
              key={connection.id}
              textGap="tight"
              leading={
                <IconTile tone="inherit">
                  <NextcloudMark size={18} />
                </IconTile>
              }
              title={connection.account}
              badge={connection.needsReconnect && <Badge tone="warning">Verbindung getrennt</Badge>}
              subtitle={`Nextcloud (${nextcloudHost(connection.server)}) | ${syncedReviewsCopy(connection.deckCount)}`}
              trailing={
                <>
                  {connection.needsReconnect && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openNextcloud(connection.server)}
                    >
                      Neu verbinden
                    </Button>
                  )}
                  <Menu
                    label={`Aktionen für ${nextcloudHost(connection.server)}`}
                    actions={[
                      {
                        label: 'Trennen',
                        icon: 'delete',
                        tone: 'danger',
                        onSelect: () => setDisconnecting({ kind: 'nextcloud', connection }),
                      },
                    ]}
                  />
                </>
              }
            />
          ))}
        </RowList>
      )}
      {/* The workspace decides who sees a linked deck, never the source (BER-165). */}
      {!empty && (
        <Notice tone="neutral" variant="inline" icon="visibility">
          Präsentationen, die du verknüpfst, sehen alle Mitglieder der Organisation – Slider liest
          die Datei mit deinem Konto, Freigaben in OneDrive, SharePoint, Nextcloud oder Google Drive
          gelten in Slider nicht. Wenn nur bestimmte Personen sie sehen sollen, schränke den Zugriff
          per Rechtsklick auf die Review ein („Zugriff einschränken …“).
        </Notice>
      )}
      {/* On a phone below the list, full width: beside the heading it squeezes the text. */}
      <Menu {...connectMenu} className="sm:hidden" triggerClassName="w-full" />
      {addingNextcloud && (
        <Subsection
          title="Nextcloud verbinden"
          icon={<NextcloudMark size={16} />}
          className="border-t border-hairline pt-5"
          aside={
            <Button variant="ghost" size="sm" onClick={closeNextcloud}>
              Abbrechen
            </Button>
          }
        >
          {server && (
            <Notice tone="warning" variant="plain">
              Verbinde dein Konto bei {nextcloudHost(server)} erneut, damit Slider deine
              Präsentationen wieder aktualisieren kann.
            </Notice>
          )}
          <NextcloudConnectForm
            key={server ?? ''}
            initialServer={server ?? ''}
            onConnected={nextcloudConnected}
          />
        </Subsection>
      )}
      {disconnecting?.kind === 'microsoft' && (
        <DisconnectMicrosoftDialog
          connection={disconnecting.connection}
          onClose={() => setDisconnecting(null)}
          onNotify={onNotify}
        />
      )}
      {disconnecting?.kind === 'google' && (
        <DisconnectGoogleDialog
          connection={disconnecting.connection}
          onClose={() => setDisconnecting(null)}
          onNotify={onNotify}
        />
      )}
      {disconnecting?.kind === 'nextcloud' && (
        <DisconnectNextcloudDialog
          connection={disconnecting.connection}
          onClose={() => setDisconnecting(null)}
          onNotify={onNotify}
        />
      )}
    </Section>
  );
}

function DisconnectMicrosoftDialog({
  connection,
  onClose,
  onNotify,
}: {
  connection: MicrosoftConnection;
  onClose: () => void;
  onNotify: ShowToast;
}) {
  const disconnect = useDisconnectMicrosoft();
  const label = microsoftLabel(connection);
  const reviews = connection.deckCount;
  const consequence =
    reviews === 0
      ? 'Gerade synchronisiert keine Review darüber.'
      : `${reviews === 1 ? '1 Review wird' : `${reviews} Reviews werden`} dann nicht mehr automatisch aktualisiert, bis ein anderes deiner Microsoft-Konten Zugriff hat oder du dieses wieder verbindest.`;
  return (
    <ConfirmDialog
      onClose={onClose}
      title={`${label} trennen?`}
      description={`Slider liest dann keine Dateien mehr über dieses Konto. ${consequence}`}
      confirmLabel="Trennen"
      pending={disconnect.isPending}
      // In the dialog: a toast would sit behind its backdrop.
      error={disconnect.error?.message}
      onConfirm={() =>
        disconnect.mutate(connection.id, {
          onSuccess: () => {
            onNotify(`${label} getrennt`);
            onClose();
          },
        })
      }
    />
  );
}

function DisconnectNextcloudDialog({
  connection,
  onClose,
  onNotify,
}: {
  connection: NextcloudConnection;
  onClose: () => void;
  onNotify: ShowToast;
}) {
  const disconnect = useDisconnectNextcloud();
  const host = nextcloudHost(connection.server);
  const reviews = connection.deckCount;
  const consequence =
    reviews === 0
      ? 'Gerade synchronisiert keine Review darüber.'
      : `${reviews === 1 ? '1 Review wird' : `${reviews} Reviews werden`} dann nicht mehr automatisch aktualisiert, bis du die Nextcloud wieder verbindest.`;
  return (
    <ConfirmDialog
      onClose={onClose}
      title={`Nextcloud (${host}) trennen?`}
      description={`Slider löscht seinen Zugang in deiner Nextcloud und liest keine Dateien mehr darüber. ${consequence}`}
      confirmLabel="Trennen"
      pending={disconnect.isPending}
      // In the dialog: a toast would sit behind its backdrop.
      error={disconnect.error?.message}
      onConfirm={() =>
        disconnect.mutate(connection.id, {
          onSuccess: ({ revoked }) => {
            onNotify(
              revoked
                ? `Nextcloud (${host}) getrennt`
                : `Getrennt – Nextcloud war nicht erreichbar. Entferne „Slider“ dort unter Einstellungen → Sicherheit.`,
            );
            onClose();
          },
        })
      }
    />
  );
}

function DisconnectGoogleDialog({
  connection,
  onClose,
  onNotify,
}: {
  connection: GoogleConnection;
  onClose: () => void;
  onNotify: ShowToast;
}) {
  const disconnect = useDisconnectGoogle();
  const label = googleLabel(connection);
  const reviews = connection.deckCount;
  const consequence =
    reviews === 0
      ? 'Gerade synchronisiert keine Review darüber.'
      : `${reviews === 1 ? '1 Review wird' : `${reviews} Reviews werden`} dann nicht mehr automatisch aktualisiert, bis du Google Drive wieder verbindest.`;
  return (
    <ConfirmDialog
      onClose={onClose}
      title={`${label} trennen?`}
      description={`Slider gibt seinen Zugang bei Google zurück und liest keine Dateien mehr darüber. ${consequence}`}
      confirmLabel="Trennen"
      pending={disconnect.isPending}
      // In the dialog: a toast would sit behind its backdrop.
      error={disconnect.error?.message}
      onConfirm={() =>
        disconnect.mutate(connection.id, {
          onSuccess: () => {
            onNotify(`${label} getrennt`);
            onClose();
          },
        })
      }
    />
  );
}
