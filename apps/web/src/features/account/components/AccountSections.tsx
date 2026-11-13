import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { passkeyNameSchema, USER_NAME_MAX, type LoginIdentity, type Passkey } from '@slider/shared';
import { isPasskeyCancel, passkeyErrorMessage, passkeysSupported } from '@/lib/passkeys';
import { NextcloudSignIn, providerLoginUrl } from '@/features/auth';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import {
  useAuthProviders,
  useCloudStatus,
  useDeletePasskey,
  useIdentities,
  usePasskeys,
  useRegisterPasskey,
  useRenamePasskey,
  useStartCloudSignIn,
  useUnlinkIdentity,
  useUpdateMe,
} from '@/lib/api';
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorText,
  GoogleMark,
  Icon,
  IconTile,
  ListRow,
  Menu,
  MicrosoftMark,
  NextcloudMark,
  Notice,
  PasskeyMark,
  RowList,
  Spinner,
  Subsection,
  TextField,
  type ShowToast,
} from '@/ui';

/** Groups of `/konto`'s "Anmeldung" card: connected logins and passkeys. */

// ── Connected logins ────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<LoginIdentity['provider'], string> = {
  microsoft: 'Microsoft',
  google: 'Google',
  oidc: 'Firmen-Login (SSO)',
  nextcloud: 'Nextcloud',
  sso: 'Firmen-Login (SSO)',
  email: 'E-Mail-Link',
};

const providerIcon = (provider: LoginIdentity['provider']): ReactNode =>
  provider === 'microsoft' ? (
    <MicrosoftMark size={18} />
  ) : provider === 'google' ? (
    <GoogleMark size={18} />
  ) : provider === 'nextcloud' ? (
    <NextcloudMark size={18} />
  ) : provider === 'email' ? (
    <Icon name="send" size={20} className="text-fg-muted" />
  ) : (
    <Icon name="key" size={20} className="text-fg-muted" />
  );

/**
 * Your name as others see it (BER-145: correct your own data). Saved as you type, once typing
 * pauses, and at once on Enter or leaving the field; your comments show the new name too.
 */
export function NameField({ name }: { name: string }) {
  const [draft, setDraft] = useState(name);
  const { mutate, isPending, error } = useUpdateMe();
  const timer = useRef<number | undefined>(undefined);
  const trimmed = draft.trim();
  const save = useCallback(() => {
    window.clearTimeout(timer.current);
    if (trimmed && trimmed !== name) mutate({ name: trimmed });
  }, [trimmed, name, mutate]);
  useEffect(() => {
    timer.current = window.setTimeout(save, 600);
    return () => window.clearTimeout(timer.current);
  }, [save]);
  // Left before typing paused: still saved.
  const flush = useEffectEvent(save);
  useEffect(() => () => flush(), []);
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <TextField
        label="Name"
        value={draft}
        maxLength={USER_NAME_MAX}
        autoComplete="name"
        error={!trimmed ? 'Der Name darf nicht leer sein.' : (error?.message ?? null)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        trailing={isPending ? <Spinner size={16} className="text-fg-subtle" /> : undefined}
      />
    </form>
  );
}

/**
 * The desktop app has no login of its own (BER-201): its account is the one on its Slider server,
 * signed in in the browser – there with Microsoft, Google, Nextcloud or a passkey. „Anmelden“ as
 * in the account menu, to the server signed in to last; „Anderer Server“ for a self-hosted one,
 * like Bitwarden. „Abmelden“ stays in the account menu.
 */
export function CloudLoginSection() {
  const cloud = useCloudStatus(true);
  const startCloud = useStartCloudSignIn();
  const startOther = useStartCloudSignIn();
  const [choosing, setChoosing] = useState(false);
  const [typed, setTyped] = useState('');
  const account = cloud.data?.account ?? null;
  const host = cloud.data ? new URL(cloud.data.server).host : '';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    startOther.mutate(typed, {
      onSuccess: () => {
        setChoosing(false);
        setTyped('');
      },
    });
  };

  return (
    <Subsection title="Anmelden mit">
      {cloud.isPending ? (
        <Spinner size={20} className="text-fg-subtle" />
      ) : cloud.isError ? (
        <p className="text-sm text-danger">{cloud.error.message}</p>
      ) : (
        <RowList>
          <ListRow
            dimmed={!account}
            leading={
              <IconTile tone="inherit">
                <Icon name="person" size={20} className="text-fg-muted" />
              </IconTile>
            }
            title={account ? account.name : `Slider-Konto auf ${host}`}
            subtitle={
              account
                ? account.email
                  ? `${account.email} · ${host}`
                  : host
                : 'Nicht angemeldet. Im Browser mit Microsoft, Google, Nextcloud oder Passkey.'
            }
            trailing={
              !account &&
              !choosing && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={startCloud.isPending}
                  onClick={() => startCloud.mutate(undefined)}
                >
                  Anmelden
                </Button>
              )
            }
          />
          {startCloud.isError && !choosing && (
            <li>
              <ErrorText role="alert" size="xs">
                {startCloud.error.message}
              </ErrorText>
            </li>
          )}
          {!account &&
            (choosing ? (
              <li>
                <form
                  onSubmit={submit}
                  className="flex animate-pop-in flex-col gap-3 rounded-panel p-3 glass-control"
                >
                  <TextField
                    label="Adresse des Slider-Servers"
                    placeholder="slider.firma.de"
                    inputMode="url"
                    autoComplete="url"
                    autoFocus
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    disabled={startOther.isPending}
                    error={startOther.isError ? startOther.error.message : null}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      type="submit"
                      className="flex-1"
                      loading={startOther.isPending}
                      disabled={!typed.trim()}
                    >
                      Anmelden
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setChoosing(false);
                        startOther.reset();
                      }}
                    >
                      Abbrechen
                    </Button>
                  </div>
                </form>
              </li>
            ) : (
              <li>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    startCloud.reset();
                    setChoosing(true);
                  }}
                >
                  Anderer Server
                </Button>
              </li>
            ))}
        </RowList>
      )}
    </Subsection>
  );
}

/** Logins stay: only the file access below can be disconnected. */
export function LoginsSection() {
  const identities = useIdentities();
  const providers = useAuthProviders();
  const [unlinking, setUnlinking] = useState<LoginIdentity | null>(null);
  // Never the last login: a passkey alone doesn't count (the server checks the same).
  const canUnlink = (identities.data?.length ?? 0) > 1;
  const connected = new Set(identities.data?.map((identity) => identity.provider));
  const linkable =
    providers.data?.providers.filter((provider) => !connected.has(provider.id)) ?? [];
  // Any Nextcloud (Login Flow v2) when the organisation's has no OAuth button of its own.
  const nextcloudAny =
    providers.data?.nextcloudAnyServer &&
    !connected.has('nextcloud') &&
    !providers.data.providers.some((provider) => provider.id === 'nextcloud');
  const [linkingNextcloud, setLinkingNextcloud] = useState(false);

  return (
    <Subsection title="Anmelden mit">
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
                canUnlink && (
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
                )
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
          {nextcloudAny && (
            <ListRow
              dimmed={!linkingNextcloud}
              leading={<IconTile tone="inherit">{providerIcon('nextcloud')}</IconTile>}
              title={PROVIDER_LABELS.nextcloud}
              subtitle="Nicht verbunden"
              trailing={
                !linkingNextcloud && (
                  <Button variant="secondary" size="sm" onClick={() => setLinkingNextcloud(true)}>
                    Verbinden
                  </Button>
                )
              }
            />
          )}
          {nextcloudAny && linkingNextcloud && (
            <li>
              <NextcloudSignIn
                intent="connect"
                returnTo="/konto"
                onCancel={() => setLinkingNextcloud(false)}
              />
            </li>
          )}
        </RowList>
      )}
      {unlinking && <UnlinkDialog identity={unlinking} onClose={() => setUnlinking(null)} />}
    </Subsection>
  );
}

function UnlinkDialog({ identity, onClose }: { identity: LoginIdentity; onClose: () => void }) {
  const unlink = useUnlinkIdentity();
  const label = PROVIDER_LABELS[identity.provider];
  return (
    <ConfirmDialog
      onClose={onClose}
      title={`${label} trennen?`}
      description={`Mit ${identity.email ?? `diesem ${label}-Konto`} meldest du dich dann nicht mehr an. Du kannst es jederzeit wieder verbinden.`}
      confirmLabel="Trennen"
      pending={unlink.isPending}
      // In the dialog: a toast would sit behind its backdrop.
      error={unlink.error?.message}
      onConfirm={() => unlink.mutate(identity.id, { onSuccess: onClose })}
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
    <Subsection
      title="Passkeys"
      icon={<PasskeyMark size={16} />}
      description="Anmelden mit Fingerabdruck, Gesicht oder Geräte-PIN – ohne Passwort und ohne Mail. Ein Passkey gilt nur für dieses Konto und diese Slider-Adresse."
      aside={
        supported ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={add}
            loading={register.isPending}
            className="max-sm:hidden"
          >
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
                  {' | '}
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
    </Subsection>
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
      // In the dialog: a toast would sit behind its backdrop.
      error={rename.error?.message}
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
      // In the dialog: a toast would sit behind its backdrop.
      error={remove.error?.message}
      onConfirm={() =>
        remove.mutate(passkey.id, {
          onSuccess: () => {
            onNotify('Passkey entfernt');
            onClose();
          },
        })
      }
    />
  );
}
