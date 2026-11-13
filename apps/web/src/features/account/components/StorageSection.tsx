import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { NextcloudConnection } from '@slider/shared';
import { NextcloudConnectForm, nextcloudHost } from '@/features/nextcloud';
import { useDisconnectNextcloud, useNextcloudConnections } from '@/lib/api';
import { safeReturnTo } from '@/lib/return-to';
import {
  Badge,
  Button,
  ConfirmDialog,
  IconTile,
  ListRow,
  Menu,
  NextcloudMark,
  Notice,
  RowList,
  Section,
  Spinner,
  Subsection,
  type ShowToast,
} from '@/ui';

/**
 * "Speicherorte" on `/konto`: the Nextcloud accounts (BER-135) Slider reads presentations through.
 * A Nextcloud link goes through the account on the same server.
 */

/** "3 Präsentationen damit verknüpft". */
function syncedReviewsCopy(count: number): string {
  if (count === 0) return 'Keine Präsentation damit verknüpft';
  return count === 1 ? '1 Präsentation damit verknüpft' : `${count} Präsentationen damit verknüpft`;
}

/**
 * `reconnect` (from `?nextcloud=` – a review's banner sends people here) opens the Nextcloud form
 * for that server; after connecting they go back to `returnTo`.
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
  const nextcloud = useNextcloudConnections();
  const [addingNextcloud, setAddingNextcloud] = useState(reconnect !== null);
  const [server, setServer] = useState(reconnect);
  const [disconnecting, setDisconnecting] = useState<NextcloudConnection | null>(null);
  const nextcloudList = nextcloud.data ?? [];
  const empty = nextcloudList.length === 0;

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

  const connectButton = (className: string) => (
    <Button variant="secondary" size="sm" className={className} onClick={() => openNextcloud(null)}>
      <NextcloudMark size={16} />
      {empty ? 'Nextcloud verbinden' : 'Weitere Nextcloud verbinden'}
    </Button>
  );

  return (
    <Section
      title="Speicherorte"
      description="Von hier holt Slider deine Präsentationen."
      aside={!addingNextcloud && connectButton('shrink-0 max-sm:hidden')}
    >
      {nextcloud.error && <p className="text-sm text-danger">{nextcloud.error.message}</p>}
      {nextcloud.isPending ? (
        <Spinner size={20} className="text-fg-subtle" />
      ) : empty ? (
        !nextcloud.error &&
        !addingNextcloud && (
          <Notice tone="neutral" variant="plain">
            Noch kein Speicherort verbunden. Verbinde eine Nextcloud, um Präsentationen daraus
            einzufügen.
          </Notice>
        )
      ) : (
        <RowList>
          {nextcloudList.map((connection) => (
            <StorageRow
              key={connection.id}
              mark={<NextcloudMark size={18} />}
              title={connection.account}
              menuLabel={nextcloudHost(connection.server)}
              subtitle={`Nextcloud (${nextcloudHost(connection.server)}) | ${syncedReviewsCopy(connection.deckCount)}`}
              expired="Verbindung getrennt"
              needsReconnect={connection.needsReconnect}
              onReconnect={() => openNextcloud(connection.server)}
              onDisconnect={() => setDisconnecting(connection)}
            />
          ))}
        </RowList>
      )}
      {/* The workspace decides who sees a linked deck, never the source (BER-165). */}
      {!empty && (
        <Notice tone="neutral" variant="inline" icon="visibility">
          Präsentationen, die du verknüpfst, sehen alle Mitglieder des Workspace – Slider liest die
          Datei mit deinem Konto, Freigaben in der Nextcloud gelten in Slider nicht. Wenn nur
          bestimmte Personen sie sehen sollen, schränke den Zugriff per Rechtsklick auf die
          Präsentation ein („Zugriff einschränken …“).
        </Notice>
      )}
      {/* On a phone below the list, full width: beside the heading it squeezes the text. */}
      {!addingNextcloud && connectButton('w-full sm:hidden')}
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
      {disconnecting && (
        <DisconnectNextcloudDialog
          connection={disconnecting}
          onClose={() => setDisconnecting(null)}
          onNotify={onNotify}
        />
      )}
    </Section>
  );
}

/** One connected account: its mark, where it reads from, "Neu verbinden" when expired, "Trennen". */
function StorageRow({
  mark,
  title,
  menuLabel,
  subtitle,
  expired,
  needsReconnect,
  onReconnect,
  onDisconnect,
}: {
  mark: ReactNode;
  title: string;
  /** Names the account in its ⋯ menu's label. */
  menuLabel: string;
  subtitle: string;
  /** The badge while `needsReconnect`. */
  expired: string;
  needsReconnect: boolean;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <ListRow
      textGap="tight"
      leading={<IconTile tone="inherit">{mark}</IconTile>}
      title={title}
      badge={needsReconnect && <Badge tone="warning">{expired}</Badge>}
      subtitle={subtitle}
      trailing={
        <>
          {needsReconnect && (
            <Button variant="secondary" size="sm" onClick={onReconnect}>
              Neu verbinden
            </Button>
          )}
          <Menu
            label={`Aktionen für ${menuLabel}`}
            actions={[{ label: 'Trennen', icon: 'delete', tone: 'danger', onSelect: onDisconnect }]}
          />
        </>
      }
    />
  );
}

/** What disconnecting means for the reviews linked through the account, until `until`. */
const linkedConsequence = (reviews: number, until: string) =>
  reviews === 0
    ? 'Gerade ist keine Präsentation damit verknüpft.'
    : `${reviews === 1 ? '1 Präsentation kann' : `${reviews} Präsentationen können`} dann keine neuen Versionen mehr holen, bis ${until}.`;

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
  const consequence = linkedConsequence(connection.deckCount, 'du die Nextcloud wieder verbindest');
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
