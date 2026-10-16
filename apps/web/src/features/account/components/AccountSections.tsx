import { useState, type ReactNode } from 'react';
import { passkeyNameSchema, type LoginIdentity, type Passkey } from '@slider/shared';
import { isPasskeyCancel, passkeyErrorMessage, passkeysSupported } from '@/lib/passkeys';
import { providerLoginUrl } from '@/features/auth';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import {
  useAuthProviders,
  useDeletePasskey,
  useIdentities,
  usePasskeys,
  useRegisterPasskey,
  useRenamePasskey,
  useUnlinkIdentity,
} from '@/lib/api';
import {
  Badge,
  Button,
  ConfirmDialog,
  GoogleMark,
  Icon,
  IconTile,
  ListRow,
  Menu,
  MicrosoftMark,
  Notice,
  PasskeyMark,
  RowList,
  Section,
  Spinner,
  TextField,
  type ShowToast,
} from '@/ui';

/** Sections of `/konto`: connected logins and passkeys. */

// ── Connected logins ────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<LoginIdentity['provider'], string> = {
  microsoft: 'Microsoft',
  google: 'Google',
  oidc: 'Firmen-Login (SSO)',
};

const providerIcon = (provider: LoginIdentity['provider']): ReactNode =>
  provider === 'microsoft' ? (
    <MicrosoftMark size={18} />
  ) : provider === 'google' ? (
    <GoogleMark size={18} />
  ) : (
    <Icon name="key" size={20} className="text-fg-muted" />
  );

export function LoginsSection({
  microsoftConnected,
  onNotify,
}: {
  microsoftConnected: boolean;
  onNotify: ShowToast;
}) {
  const identities = useIdentities();
  const providers = useAuthProviders();
  const [unlinking, setUnlinking] = useState<LoginIdentity | null>(null);
  const connected = new Set(identities.data?.map((identity) => identity.provider));
  const linkable =
    providers.data?.providers.filter((provider) => !connected.has(provider.id)) ?? [];

  return (
    <Section
      title="Verbundene Anmeldungen"
      description="Mit jeder davon kommst du in dieses Konto."
    >
      {identities.isPending ? (
        <Spinner size={20} className="text-fg-subtle" />
      ) : identities.isError ? (
        <p className="text-sm text-danger">{identities.error.message}</p>
      ) : (
        <RowList>
          {identities.data.map((identity) => (
            <ListRow
              key={`${identity.provider}:${identity.email ?? ''}:${identity.createdAt}`}
              leading={<IconTile tone="inherit">{providerIcon(identity.provider)}</IconTile>}
              title={PROVIDER_LABELS[identity.provider]}
              subtitle={identity.email ?? '–'}
              trailing={
                <>
                  {identity.provider === 'microsoft' && microsoftConnected && (
                    <span title="Verbunden mit OneDrive & SharePoint" className="text-fg-subtle">
                      <Icon name="cloud" size={18} label="Verbunden mit OneDrive & SharePoint" />
                    </span>
                  )}
                  <Menu
                    label={`Aktionen für ${PROVIDER_LABELS[identity.provider]}`}
                    actions={[
                      {
                        label: 'Trennen',
                        icon: 'delete',
                        tone: 'danger',
                        onSelect: () => setUnlinking(identity),
                      },
                    ]}
                  />
                </>
              }
            />
          ))}
          {identities.data.length === 0 && (
            <li className="text-body text-fg-subtle">
              {providers.data?.devLogin
                ? 'Entwicklungsmodus: Du bist ohne Anmeldung drin.'
                : 'Noch keine Anmeldung verknüpft.'}
            </li>
          )}
          {linkable.map((provider) => (
            <ListRow
              key={provider.id}
              dimmed
              leading={<IconTile tone="inherit">{providerIcon(provider.id)}</IconTile>}
              title={PROVIDER_LABELS[provider.id]}
              subtitle="Nicht verbunden"
              trailing={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    window.location.assign(
                      providerLoginUrl(`${provider.loginUrl}?intent=connect`, '/konto'),
                    )
                  }
                >
                  Verbinden
                </Button>
              }
            />
          ))}
        </RowList>
      )}
      {unlinking && (
        <UnlinkDialog identity={unlinking} onClose={() => setUnlinking(null)} onNotify={onNotify} />
      )}
    </Section>
  );
}

function UnlinkDialog({
  identity,
  onClose,
  onNotify,
}: {
  identity: LoginIdentity;
  onClose: () => void;
  onNotify: ShowToast;
}) {
  const unlink = useUnlinkIdentity();
  const label = PROVIDER_LABELS[identity.provider];
  return (
    <ConfirmDialog
      onClose={onClose}
      title={`${label} trennen?`}
      description={
        identity.provider === 'microsoft'
          ? `Mit ${identity.email ?? 'diesem Microsoft-Konto'} kommst du dann nicht mehr in dieses Konto, und Slider verliert den Zugriff auf deine OneDrive- und SharePoint-Dateien. Du kannst Microsoft jederzeit wieder verbinden.`
          : `Mit ${identity.email ?? `diesem ${label}-Konto`} kommst du dann nicht mehr in dieses Konto. Du kannst es jederzeit wieder verbinden.`
      }
      confirmLabel="Trennen"
      pending={unlink.isPending}
      onConfirm={() =>
        unlink.mutate(identity.id, {
          onSuccess: () => {
            onNotify(`${label} getrennt`);
            onClose();
          },
          onError: (error) => onNotify(error.message, 'danger'),
        })
      }
    />
  );
}

// ── Passkeys ────────────────────────────────────────────────────────────────

export function PasskeysSection({ onNotify }: { onNotify: ShowToast }) {
  const [supported] = useState(passkeysSupported);
  const passkeys = usePasskeys();
  const register = useRegisterPasskey();
  const [renaming, setRenaming] = useState<Passkey | null>(null);
  const [removing, setRemoving] = useState<Passkey | null>(null);

  const add = () =>
    register.mutate(undefined, {
      onSuccess: (passkey) => onNotify(`„${passkey.name}“ hinzugefügt`),
      onError: (error) => {
        if (!isPasskeyCancel(error)) onNotify(passkeyErrorMessage(error), 'danger');
      },
    });

  return (
    <Section
      title="Passkeys"
      description="Anmelden mit Fingerabdruck, Gesicht oder Geräte-PIN – ohne Passwort und ohne Mail. Ein Passkey gilt nur für dieses Konto und diese Slider-Adresse."
      aside={
        supported ? (
          <Button
            variant="secondary"
            onClick={add}
            loading={register.isPending}
            className="max-sm:hidden"
          >
            {!register.isPending && <PasskeyMark size={18} />}
            Passkey hinzufügen
          </Button>
        ) : undefined
      }
    >
      {!supported && (
        <Notice tone="warning" variant="inline">
          Dieser Browser unterstützt keine Passkeys.
        </Notice>
      )}
      {passkeys.isPending ? (
        <Spinner size={20} className="text-fg-subtle" />
      ) : passkeys.isError ? (
        <p className="text-sm text-danger">{passkeys.error.message}</p>
      ) : passkeys.data.length === 0 ? (
        <Notice tone="neutral" variant="plain">
          Noch kein Passkey. Mit einem Passkey meldest du dich auf diesem Gerät mit einem Klick an.
        </Notice>
      ) : (
        <RowList>
          {passkeys.data.map((passkey) => (
            <ListRow
              key={passkey.id}
              textGap="tight"
              leading={
                <IconTile>
                  <PasskeyMark size={20} />
                </IconTile>
              }
              title={passkey.name}
              badge={passkey.synced && <Badge tone="info">Synchronisiert</Badge>}
              subtitle={
                <>
                  Erstellt{' '}
                  <span title={formatDateTime(passkey.createdAt)}>
                    {formatRelativeTime(passkey.createdAt)}
                  </span>
                  {' · '}
                  {passkey.lastUsedAt ? (
                    <>
                      Zuletzt verwendet{' '}
                      <span title={formatDateTime(passkey.lastUsedAt)}>
                        {formatRelativeTime(passkey.lastUsedAt)}
                      </span>
                    </>
                  ) : (
                    'Noch nie verwendet'
                  )}
                </>
              }
              trailing={
                <Menu
                  label={`Aktionen für „${passkey.name}“`}
                  actions={[
                    { label: 'Umbenennen', icon: 'edit', onSelect: () => setRenaming(passkey) },
                    {
                      label: 'Entfernen',
                      icon: 'delete',
                      tone: 'danger',
                      onSelect: () => setRemoving(passkey),
                    },
                  ]}
                />
              }
            />
          ))}
        </RowList>
      )}
      {supported && (
        <Button
          variant="secondary"
          onClick={add}
          loading={register.isPending}
          className="w-full sm:hidden"
        >
          {!register.isPending && <PasskeyMark size={18} />}
          Passkey hinzufügen
        </Button>
      )}
      {renaming && (
        <RenameDialog passkey={renaming} onClose={() => setRenaming(null)} onNotify={onNotify} />
      )}
      {removing && (
        <RemoveDialog passkey={removing} onClose={() => setRemoving(null)} onNotify={onNotify} />
      )}
    </Section>
  );
}

function RenameDialog({
  passkey,
  onClose,
  onNotify,
}: {
  passkey: Passkey;
  onClose: () => void;
  onNotify: ShowToast;
}) {
  const [name, setName] = useState(passkey.name);
  const rename = useRenamePasskey();
  const parsed = passkeyNameSchema.safeParse(name);
  const save = () => {
    if (!parsed.success) return;
    rename.mutate(
      { id: passkey.id, name: parsed.data },
      {
        onSuccess: () => {
          onNotify('Name gespeichert');
          onClose();
        },
        onError: (error) => onNotify(error.message, 'danger'),
      },
    );
  };
  return (
    <ConfirmDialog
      onClose={onClose}
      title="Passkey umbenennen"
      description="Ein Name, an dem du das Gerät oder den Passwort-Manager wiedererkennst."
      tone="primary"
      confirmLabel="Speichern"
      confirmDisabled={!parsed.success}
      pending={rename.isPending}
      onConfirm={save}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <TextField
          label="Name"
          value={name}
          maxLength={60}
          autoFocus
          error={parsed.success ? null : 'Der Name darf nicht leer sein.'}
          onChange={(event) => setName(event.target.value)}
        />
      </form>
    </ConfirmDialog>
  );
}

function RemoveDialog({
  passkey,
  onClose,
  onNotify,
}: {
  passkey: Passkey;
  onClose: () => void;
  onNotify: ShowToast;
}) {
  const remove = useDeletePasskey();
  return (
    <ConfirmDialog
      onClose={onClose}
      title={`„${passkey.name}“ entfernen?`}
      description="Mit diesem Passkey kannst du dich dann nicht mehr anmelden. Lösche ihn danach auch im Passwort-Manager deines Geräts."
      confirmLabel="Entfernen"
      pending={remove.isPending}
      onConfirm={() =>
        remove.mutate(passkey.id, {
          onSuccess: () => {
            onNotify('Passkey entfernt');
            onClose();
          },
          onError: (error) => onNotify(error.message, 'danger'),
        })
      }
    />
  );
}
