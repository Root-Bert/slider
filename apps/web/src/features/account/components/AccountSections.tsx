import { useState, type ReactNode } from 'react';
import { passkeyNameSchema, type LoginIdentity, type Passkey } from '@slider/shared';
import { GoogleMark } from '@/features/auth/components/GoogleMark';
import { MicrosoftMark } from '@/features/auth/components/MicrosoftMark';
import { PasskeyMark } from '@/features/auth/components/PasskeyMark';
import {
  isPasskeyCancel,
  passkeyErrorMessage,
  passkeysSupported,
} from '@/features/auth/lib/passkeys';
import { providerLoginUrl } from '@/features/auth/lib/return-to';
import { SettingsSection } from '@/features/workspaces/components/SettingsSection';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import {
  useAuthProviders,
  useDeletePasskey,
  useIdentities,
  usePasskeys,
  useRegisterPasskey,
  useRenamePasskey,
  useUnlinkIdentity,
} from '@/lib/workspace-queries';
import { Badge, Button, Dialog, Icon, Menu, Spinner, TextField, type ShowToast } from '@/ui';

/** Sections of `/konto`: connected logins and passkeys. */

// ── Connected logins ────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<LoginIdentity['provider'], string> = {
  microsoft: 'Microsoft',
  google: 'Google',
  oidc: 'Firmen-Login (SSO)',
  email: 'E-Mail (Link oder Code)',
};

const providerIcon = (provider: LoginIdentity['provider']): ReactNode =>
  provider === 'microsoft' ? (
    <MicrosoftMark size={18} />
  ) : provider === 'google' ? (
    <GoogleMark size={18} />
  ) : (
    <Icon name={provider === 'email' ? 'at' : 'key'} size={20} className="text-fg-muted" />
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
    <SettingsSection
      title="Verbundene Anmeldungen"
      description="Mit jeder davon kommst du in dieses Konto."
    >
      {identities.isPending ? (
        <Spinner size={20} className="text-fg-subtle" />
      ) : identities.isError ? (
        <p className="text-sm text-danger">{identities.error.message}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {identities.data.map((identity) => (
            <li
              key={`${identity.provider}:${identity.email ?? ''}:${identity.createdAt}`}
              className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-white/6">
                {providerIcon(identity.provider)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-fg">
                  {PROVIDER_LABELS[identity.provider]}
                </span>
                <span className="truncate text-xs text-fg-subtle">
                  {identity.email ?? '–'}
                </span>
              </span>
              {identity.provider === 'microsoft' && microsoftConnected && (
                <span title="Verbunden mit OneDrive & SharePoint" className="text-fg-subtle">
                  <Icon name="cloud" size={18} label="Verbunden mit OneDrive & SharePoint" />
                </span>
              )}
              {identity.provider !== 'email' && (
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
              )}
            </li>
          ))}
          {identities.data.length === 0 && (
            <li className="text-[13px] text-fg-subtle">
              {providers.data?.devLogin
                ? 'Entwicklungsmodus: Du bist ohne Anmeldung drin.'
                : 'Noch keine Anmeldung verknüpft.'}
            </li>
          )}
          {linkable.map((provider) => (
            <li key={provider.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-white/6 opacity-60">
                {providerIcon(provider.id)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-fg-muted">
                  {PROVIDER_LABELS[provider.id]}
                </span>
                <span className="text-xs text-fg-subtle">Nicht verbunden</span>
              </span>
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
            </li>
          ))}
        </ul>
      )}
      {unlinking && (
        <UnlinkDialog identity={unlinking} onClose={() => setUnlinking(null)} onNotify={onNotify} />
      )}
    </SettingsSection>
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
    <Dialog
      open
      onClose={onClose}
      title={`${label} trennen?`}
      description={
        identity.provider === 'microsoft'
          ? `Mit ${identity.email ?? 'diesem Microsoft-Konto'} kommst du dann nicht mehr in dieses Konto, und Slider verliert den Zugriff auf deine OneDrive- und SharePoint-Dateien. Du kannst Microsoft jederzeit wieder verbinden.`
          : `Mit ${identity.email ?? `diesem ${label}-Konto`} kommst du dann nicht mehr in dieses Konto. Du kannst es jederzeit wieder verbinden.`
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            variant="danger"
            loading={unlink.isPending}
            onClick={() =>
              unlink.mutate(identity.id, {
                onSuccess: () => {
                  onNotify(`${label} getrennt`);
                  onClose();
                },
                onError: (error) => onNotify(error.message, 'danger'),
              })
            }
          >
            Trennen
          </Button>
        </>
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
    <SettingsSection
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
        <p className="flex items-center gap-2 text-[13px] text-fg-subtle">
          <Icon name="warning" size={18} className="text-warning" />
          Dieser Browser unterstützt keine Passkeys.
        </p>
      )}
      {passkeys.isPending ? (
        <Spinner size={20} className="text-fg-subtle" />
      ) : passkeys.isError ? (
        <p className="text-sm text-danger">{passkeys.error.message}</p>
      ) : passkeys.data.length === 0 ? (
        <p className="rounded-control bg-white/5 px-4 py-3 text-[13px] leading-5 text-fg-subtle">
          Noch kein Passkey. Mit einem Passkey meldest du dich auf diesem Gerät mit einem Klick an.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {passkeys.data.map((passkey) => (
            <li key={passkey.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-white/6 text-fg-muted">
                <PasskeyMark size={20} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-fg">{passkey.name}</span>
                  {passkey.synced && <Badge tone="info">Synchronisiert</Badge>}
                </span>
                <span className="truncate text-xs text-fg-subtle">
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
                </span>
              </span>
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
            </li>
          ))}
        </ul>
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
    </SettingsSection>
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
    <Dialog
      open
      onClose={onClose}
      title="Passkey umbenennen"
      description="Ein Name, an dem du das Gerät oder den Passwort-Manager wiedererkennst."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button onClick={save} disabled={!parsed.success} loading={rename.isPending}>
            Speichern
          </Button>
        </>
      }
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
    </Dialog>
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
    <Dialog
      open
      onClose={onClose}
      title={`„${passkey.name}“ entfernen?`}
      description="Mit diesem Passkey kannst du dich dann nicht mehr anmelden. Lösche ihn danach auch im Passwort-Manager deines Geräts."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() =>
              remove.mutate(passkey.id, {
                onSuccess: () => {
                  onNotify('Passkey entfernt');
                  onClose();
                },
                onError: (error) => onNotify(error.message, 'danger'),
              })
            }
          >
            Entfernen
          </Button>
        </>
      }
    />
  );
}
