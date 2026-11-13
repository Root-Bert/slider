import { useState } from 'react';
import type { CloudSync } from '@slider/shared';
import { useNavigate } from 'react-router';
import { editsUnsentBeforeSignOut } from '@/features/viewer';
import { routes } from '@/lib/routes';
import { desktopBridge } from '@/lib/desktop-bridge';
import { forgetOffline } from '@/lib/offline';
import { dismissPasskeyHint, passkeyHintDismissed, passkeysSupported } from '@/lib/passkeys';
import {
  useAuthProviders,
  useCloudSignOut,
  useCloudStatus,
  useCloudSyncNow,
  useLogout,
  useMe,
  usePasskeys,
  useStartCloudSignIn,
} from '@/lib/api';
import { type ThemePreference, useThemePreference } from '@/lib/theme';
import {
  Avatar,
  ConfirmDialog,
  ErrorText,
  Icon,
  IconButton,
  MenuDivider,
  MenuHeading,
  MenuItem,
  PasskeyMark,
  type Segment,
  SegmentedControl,
  Spinner,
} from '@/ui';
import { HeaderPopover } from './HeaderPopover';

const THEMES: readonly Segment<ThemePreference>[] = [
  { value: 'light', label: 'Hell', icon: 'lightMode' },
  { value: 'system', label: 'System', icon: 'desktopWindows' },
  { value: 'dark', label: 'Dunkel', icon: 'darkMode' },
];

/**
 * Header avatar with the account menu: who is signed in, "Konto & Anmeldung", "Nutzung" (plan
 * and storage of the workspaces), "Einstellungen" (its own page, kept apart from the
 * account), the theme (Hell, System, Dunkel), for the instance admin "Instanz" (dashboard and setup, BER-167), sign out – and once,
 * until dismissed, a nudge to add a passkey. Signing out waits a moment for edits still on their
 * way; any left unsent would go with it, so it asks first. Logins and connections live on "Konto & Anmeldung".
 * The panel unfolds out of the avatar: it stays where it is, in the panel's top-right corner.
 */
export function AccountMenu() {
  const { data: me } = useMe();
  const logout = useLogout();
  // The desktop app is one person on their own machine, no login of its own: „Anmelden“ and
  // „Abmelden“ there are about its Slider server (BER-201).
  const desktop = useAuthProviders().data?.desktop ?? false;
  // The server's pages inside the desktop app (online, BER-201): „Abmelden“ signs this computer
  // out – its session there ends with it, its copies go as on this computer's own pages.
  const bridge = desktop ? null : desktopBridge();
  const [confirmBridgeSignOut, setConfirmBridgeSignOut] = useState(false);
  const [bridgeSigningOut, setBridgeSigningOut] = useState(false);
  const [bridgeSignOutFailed, setBridgeSignOutFailed] = useState(false);
  /** Edits not sent yet when „Abmelden“ was picked there: they go with the account's copies. */
  const [bridgeUnsent, setBridgeUnsent] = useState(0);
  const cloud = useCloudStatus(desktop);
  const cloudAccount = cloud.data?.account ?? null;
  const startCloud = useStartCloudSignIn();
  const cloudSignOut = useCloudSignOut();
  const syncNow = useCloudSyncNow();
  const [confirmCloudSignOut, setConfirmCloudSignOut] = useState(false);
  const navigate = useNavigate();
  const [hintWanted, setHintWanted] = useState(
    () => passkeysSupported() && !passkeyHintDismissed(),
  );
  const passkeys = usePasskeys(Boolean(me?.user) && hintWanted);
  const [theme, setTheme] = useThemePreference();
  // Waiting for edits on their way before signing out, and how many were left unsent (to confirm).
  const [checking, setChecking] = useState(false);
  const [unsent, setUnsent] = useState<number | null>(null);
  if (!me) return null;
  const user = me.user;
  if (!user) return <Avatar author={me.viewer.author} size={32} />;

  const leave = () =>
    logout.mutate(undefined, { onSuccess: () => window.location.assign(routes.login()) });
  const signOut = async () => {
    if (checking || logout.isPending) return;
    setChecking(true);
    const left = await editsUnsentBeforeSignOut().finally(() => setChecking(false));
    if (left > 0) setUnsent(left);
    else leave();
  };

  return (
    <>
      <HeaderPopover
        label={`Konto: ${user.name}`}
        align="right"
        unfold
        // The header's room for the avatar (10px from the right, 8px from the top) plus the
        // panel's 6px padding: the panel's corner lies around the avatar, not below it.
        panelClassName="-top-3.5 -right-4"
        triggerClassName="flex rounded-full transition-opacity hover:opacity-85"
        trigger={() => <Avatar author={me.viewer.author} size={32} />}
      >
        {(close) => (
          <>
            <div className="flex items-start gap-3 px-2.5 pt-2 pb-2.5">
              <div className="flex min-h-8 min-w-0 flex-1 flex-col justify-center">
                <span className="truncate text-body font-medium text-fg">
                  {cloudAccount?.name ?? user.name}
                </span>
                <span className="truncate text-xs text-fg-subtle">
                  {!desktop
                    ? user.email
                    : cloudAccount
                      ? (cloudAccount.email ?? new URL(cloud.data!.server).host)
                      : 'Nicht angemeldet'}
                </span>
              </div>
              {/* The trigger's avatar shows here, above the panel. */}
              <span aria-hidden className="size-8 shrink-0" />
            </div>
            {!desktop && hintWanted && passkeys.data?.length === 0 && (
              <div
                data-passkey-hint
                className="mx-1 mb-1.5 flex items-start gap-2.5 rounded-control bg-surface-1 py-2.5 pr-1.5 pl-3"
              >
                <PasskeyMark size={18} className="mt-0.5 text-fg-muted" />
                <button
                  type="button"
                  className="group/hint flex min-w-0 flex-1 flex-col text-left"
                  onClick={() => {
                    close();
                    void navigate(routes.account());
                  }}
                >
                  <span className="text-body font-medium text-fg group-hover/hint:underline">
                    Schneller anmelden
                  </span>
                  <span className="text-xs text-fg-subtle">Passkey hinzufügen</span>
                </button>
                <IconButton
                  icon="close"
                  label="Hinweis ausblenden"
                  size="sm"
                  onClick={(event) => {
                    // The focused button goes away with the hint: the focus moves on to the next
                    // item instead of dropping to <body>.
                    const hint = event.currentTarget.closest('[data-passkey-hint]');
                    const next = [
                      ...(hint?.parentElement?.querySelectorAll<HTMLElement>('a[href], button') ??
                        []),
                    ].find((element) => !hint?.contains(element));
                    next?.focus();
                    dismissPasskeyHint();
                    setHintWanted(false);
                  }}
                />
              </div>
            )}
            <MenuDivider />
            <MenuItem
              icon="person"
              onClick={() => {
                close();
                void navigate(routes.account());
              }}
            >
              Konto & Anmeldung
            </MenuItem>
            <MenuItem
              icon="cloud"
              onClick={() => {
                close();
                void navigate(routes.usage());
              }}
            >
              Nutzung
            </MenuItem>
            <MenuItem
              icon="settings"
              onClick={() => {
                close();
                void navigate(routes.preferences());
              }}
            >
              Einstellungen
            </MenuItem>
            <div className="px-1.5 pt-1 pb-1.5">
              <SegmentedControl
                label="Darstellung"
                segments={THEMES}
                value={theme}
                onChange={setTheme}
                size="sm"
                track="soft"
                fill
              />
            </div>
            {user.isInstanceAdmin && (
              <>
                <MenuDivider />
                <MenuHeading>Instanz</MenuHeading>
                <MenuItem
                  icon="settings"
                  onClick={() => {
                    close();
                    void navigate(routes.setup());
                  }}
                >
                  Instanz-Einstellungen
                </MenuItem>
                <MenuItem
                  icon="manageAccounts"
                  onClick={() => {
                    close();
                    void navigate(routes.instance());
                  }}
                >
                  Instanz-Dashboard
                </MenuItem>
              </>
            )}
            {desktop && (
              <>
                <MenuDivider />
                {cloudAccount ? (
                  <>
                    <MenuItem
                      icon={
                        syncNow.isPending || cloud.data?.sync?.state === 'syncing' ? (
                          <Spinner size={18} />
                        ) : (
                          <Icon name="sync" size={18} className="text-fg-subtle" />
                        )
                      }
                      onClick={() => syncNow.mutate()}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span>Jetzt synchronisieren</span>
                        <span className="truncate text-xs text-fg-subtle">
                          {syncLine(cloud.data?.sync ?? null)}
                        </span>
                      </span>
                    </MenuItem>
                    <MenuItem
                      icon="logout"
                      onClick={() => {
                        close();
                        setConfirmCloudSignOut(true);
                      }}
                    >
                      Abmelden
                    </MenuItem>
                  </>
                ) : (
                  <MenuItem
                    icon="person"
                    onClick={() => startCloud.mutate(undefined, { onSuccess: close })}
                  >
                    {/* Where it goes: another server is picked on „Konto & Anmeldung“. */}
                    <span className="flex min-w-0 flex-col">
                      <span>Anmelden</span>
                      {cloud.data && (
                        <span className="truncate text-xs text-fg-subtle">
                          {new URL(cloud.data.server).host}
                        </span>
                      )}
                    </span>
                  </MenuItem>
                )}
                {startCloud.isError && (
                  <ErrorText role="alert" size="xs" className="px-3 pt-0.5 pb-1.5">
                    {startCloud.error.message}
                  </ErrorText>
                )}
              </>
            )}
            {!desktop && (
              <>
                <MenuDivider />
                <MenuItem
                  icon={
                    checking || (logout.isPending && unsent === null) ? (
                      <Spinner size={18} />
                    ) : (
                      <Icon name="logout" size={18} className="text-fg-subtle" />
                    )
                  }
                  onClick={() => {
                    if (!bridge) return void signOut();
                    if (checking) return;
                    setChecking(true);
                    void editsUnsentBeforeSignOut()
                      .then((left) => {
                        close();
                        setBridgeUnsent(left);
                        setBridgeSignOutFailed(false);
                        setConfirmBridgeSignOut(true);
                      })
                      .finally(() => setChecking(false));
                  }}
                >
                  Abmelden
                </MenuItem>
                {logout.isError && (
                  <ErrorText role="alert" size="xs" className="px-3 pt-0.5 pb-1.5">
                    Abmelden hat nicht geklappt. Bitte erneut versuchen.
                  </ErrorText>
                )}
              </>
            )}
          </>
        )}
      </HeaderPopover>
      {confirmCloudSignOut && cloud.data && (
        <ConfirmDialog
          title="Abmelden?"
          description={`Die Präsentationen des Kontos verschwinden von diesem Computer und bleiben auf ${
            new URL(cloud.data.server).host
          }. Was hier erstellt oder auf diesem Computer behalten wurde, bleibt hier.`}
          confirmLabel="Abmelden"
          confirmIcon="logout"
          pending={cloudSignOut.isPending}
          error={cloudSignOut.error?.message}
          onClose={() => {
            cloudSignOut.reset();
            setConfirmCloudSignOut(false);
          }}
          onConfirm={() =>
            cloudSignOut.mutate(undefined, { onSuccess: () => setConfirmCloudSignOut(false) })
          }
        />
      )}
      {confirmBridgeSignOut && bridge && (
        <ConfirmDialog
          title="Abmelden?"
          description={`Die Präsentationen des Kontos verschwinden von diesem Computer und bleiben auf ${window.location.host}. Was hier erstellt oder auf diesem Computer behalten wurde, bleibt hier.${
            bridgeUnsent === 0
              ? ''
              : bridgeUnsent === 1
                ? ' Eine Änderung ist noch nicht gespeichert und geht verloren.'
                : ` ${bridgeUnsent} Änderungen sind noch nicht gespeichert und gehen verloren.`
          }`}
          confirmLabel="Abmelden"
          confirmIcon="logout"
          pending={bridgeSigningOut}
          error={
            bridgeSignOutFailed ? 'Abmelden hat nicht geklappt. Bitte erneut versuchen.' : undefined
          }
          onClose={() => setConfirmBridgeSignOut(false)}
          onConfirm={() => {
            setBridgeSigningOut(true);
            setBridgeSignOutFailed(false);
            // What this browser session kept for the account (stored answers, the edits not sent)
            // goes first, as on signing out in the browser – the app then moves the tabs to this
            // computer's pages, this one with them.
            void forgetOffline()
              .then(() => bridge.signOut())
              .then(
                (done) => setBridgeSignOutFailed(!done),
                () => setBridgeSignOutFailed(true),
              )
              .finally(() => setBridgeSigningOut(false));
          }}
        />
      )}
      {unsent !== null && (
        <ConfirmDialog
          title="Trotzdem abmelden?"
          description={`${
            unsent === 1
              ? 'Eine Änderung ist noch nicht gespeichert.'
              : `${unsent} Änderungen sind noch nicht gespeichert.`
          } Beim Abmelden gehen sie verloren.`}
          confirmLabel="Abmelden"
          confirmIcon="logout"
          pending={logout.isPending}
          error={
            logout.isError ? 'Abmelden hat nicht geklappt. Bitte erneut versuchen.' : undefined
          }
          onClose={() => setUnsent(null)}
          onConfirm={leave}
        />
      )}
    </>
  );
}

/** Under „Jetzt synchronisieren“: how bringing this machine and the account together goes. */
function syncLine(sync: CloudSync | null): string {
  if (!sync) return '';
  if (sync.state === 'syncing') return 'Wird synchronisiert';
  if (sync.state === 'offline') return 'Offline, Änderungen warten';
  if (sync.state === 'error') return sync.message ?? 'Hat nicht geklappt';
  if (!sync.at) return 'Wird gleich synchronisiert';
  const time = new Date(sync.at).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `Synchronisiert um ${time}`;
}
