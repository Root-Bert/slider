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

export function LoginsSection({ microsoftConnected }: { microsoftConnected: boolean }) {
  const identities = useIdentities();
  const providers = useAuthProviders();
  const connected = new Set(identities.data?.map((identity) => identity.provider));
  // Google and SSO can be added while signed in; Microsoft links itself on its first login.
  const linkable =
    providers.data?.providers.filter(
      (provider) => provider.id !== 'microsoft' && !connected.has(provider.id),
    ) ?? [];

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
                  {identity.email ?? '–'} · seit{' '}
                  <span title={formatDateTime(identity.createdAt)}>
                    {formatRelativeTime(identity.createdAt)}
                  </span>
                </span>
              </span>
              {identity.provider === 'microsoft' && microsoftConnected && (
                <Badge tone="success">Dateizugriff</Badge>
              )}
            </li>
          ))}
          {identities.data.length === 0 && (
            <li className="text-[13px] text-fg-subtle">
              Noch keine Anmeldung verknüpft (Entwicklungsmodus).
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
    </SettingsSection>
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
