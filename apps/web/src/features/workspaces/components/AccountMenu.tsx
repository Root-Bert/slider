import { useEffect, useState } from 'react';
import type { CloudSync } from '@slider/shared';
import { useNavigate } from 'react-router';
import { editsUnsentBeforeSignOut } from '@/features/viewer';
import { takeAccountNotice } from '@/lib/api-client';
import { routes } from '@/lib/routes';
import { desktopBridge } from '@/lib/desktop-bridge';
import { forgetOffline } from '@/lib/offline';
import { dismissPasskeyHint, passkeyHintDismissed, passkeysSupported } from '@/lib/passkeys';
import {
  useAuthProviders,
  useCloudSignOut,
  useCloudStatus,
  useDesktopState,
  useLogout,
  useMe,
  useOtherAccounts,
  useSignOutOtherAccount,
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
  Toast,
  useToast,
} from '@/ui';
import { MAX_OTHER_ACCOUNTS, useAccountSwitch } from '../hooks/useAccountSwitch';
import { HeaderPopover } from './HeaderPopover';

const THEMES: readonly Segment<ThemePreference>[] = [
  { value: 'light', label: 'Hell', icon: 'lightMode' },
  { value: 'system', label: 'System', icon: 'desktopWindows' },
  { value: 'dark', label: 'Dunkel', icon: 'darkMode' },
];

/**
 * Header avatar with the account menu: who is signed in, "Konto & Anmeldung", "Nutzung" (plan
 * and storage of the workspaces), "Einstellungen" (its own page, kept apart from the
 * account), "Wörterbuch" (the words one taught the spell check), the theme (Hell, System, Dunkel), for the instance admin "Instanz" (dashboard and setup, BER-167), sign out – and once,
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
  // More accounts on this browser – and in the desktop app's server pages, as in Figma (not on
  // this computer's own pages: they are the app's one account).
  const accountsShown = Boolean(me?.user) && !desktop;
  const desktopState = useDesktopState();
  /** The app's account, when the pages are on another one: only its decks are kept offline. */
  const offlineAccount =
    bridge && desktopState?.account && desktopState.account.email !== me?.user?.email
      ? desktopState.account
      : null;
  const others = useOtherAccounts(accountsShown).data ?? [];
  const accounts = useAccountSwitch();
  const signOutOther = useSignOutOtherAccount();
  // On another account than this browser was on before: said once, whoever changed it.
  const [toast, showToast] = useToast();
  const email = me?.user?.email;
  useEffect(() => {
    if (email && takeAccountNotice()) showToast(`Angemeldet als ${email}`);
  }, [email, showToast]);
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
            {accountsShown && (
              <>
                <MenuDivider />
                {others.map((other) => (
                  // As a workspace's row: its own button over the right edge – here „Abmelden“.
                  <div key={other.user.id} className="group relative">
                    <MenuItem
                      icon={
                        <Avatar
                          author={{ ...other.user, type: 'owner' }}
                          size={20}
                          nativeTitle={false}
                        />
                      }
                      title={`Zu ${other.user.name} wechseln`}
                      disabled={accounts.busy}
                      dimDisabled={false}
                      className="pr-10 group-hover:bg-hover"
                      onClick={() => accounts.switchTo(other.user.id)}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{other.user.name}</span>
                        <span className="truncate text-xs text-fg-subtle">{other.user.email}</span>
                      </span>
                    </MenuItem>
                    {/* Not the desktop app's own account: that goes with its copies („Von allen
                        Konten abmelden“). */}
                    {other.user.email !== desktopState?.account?.email && (
                      <IconButton
                        icon="logout"
                        label={`${other.user.email} abmelden`}
                        variant="subtle"
                        size="compact"
                        className="absolute top-1/2 right-1 -translate-y-1/2"
                        disabled={signOutOther.isPending}
                        onClick={() => signOutOther.mutate(other.user.id)}
                      />
                    )}
                  </div>
                ))}
                {bridge && !bridge.addAccount ? null : others.length < MAX_OTHER_ACCOUNTS ? (
                  <MenuItem
                    icon="personAdd"
                    disabled={accounts.busy}
                    onClick={() => {
                      // In the desktop app the browser comes to the front for it.
                      if (bridge) close();
                      accounts.addAccount();
                    }}
                  >
                    Weiteres Konto hinzufügen
                  </MenuItem>
                ) : (
                  // One more would push the oldest out unseen.
                  <p className="px-3 py-1.5 text-xs text-fg-subtle">
                    Mehr als fünf Konten gehen hier nicht. Melde zuerst eins ab.
                  </p>
                )}
                {(accounts.error ?? signOutOther.error?.message) && (
                  <ErrorText role="alert" size="xs" className="px-3 pt-0.5 pb-1.5">
                    {accounts.error ?? signOutOther.error?.message}
                  </ErrorText>
                )}
                {offlineAccount && (
                  <p className="px-3 pt-0.5 pb-1.5 text-xs text-fg-subtle">
                    Offline verfügbar: nur Präsentationen von{' '}
                    {offlineAccount.email ?? offlineAccount.name}
                  </p>
                )}
              </>
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
            <MenuItem
              icon="spellcheck"
              onClick={() => {
                close();
                void navigate(routes.dictionary());
              }}
            >
              Wörterbuch
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
                    {syncTrouble(cloud.data?.sync ?? null) && (
                      <p className="px-3 pt-0.5 pb-1.5 text-xs text-fg-subtle">
                        {syncTrouble(cloud.data?.sync ?? null)}
                      </p>
                    )}
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
                {/* Only this account; the next one signed in here takes over. In the desktop app
                    its own account goes with its copies – „Von allen Konten abmelden“ there. */}
                {others.length > 0 && (!bridge || offlineAccount) && (
                  <MenuItem icon="logout" disabled={accounts.busy} onClick={accounts.signOut}>
                    Abmelden
                  </MenuItem>
                )}
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
                  {/* Every account on this browser goes: a shared computer is left clean. */}
                  {others.length > 0 ? 'Von allen Konten abmelden' : 'Abmelden'}
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
          title={others.length > 0 ? 'Von allen Konten abmelden?' : 'Abmelden?'}
          description={`${
            others.length > 0 ? 'Alle Konten in dieser App werden abgemeldet. ' : ''
          }Die Präsentationen ${
            desktopState?.account?.email ? `von ${desktopState.account.email}` : 'des Kontos'
          } verschwinden von diesem Computer und bleiben auf ${window.location.host}. Was hier erstellt oder auf diesem Computer behalten wurde, bleibt hier.${
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
      {accounts.dialog}
      <Toast toast={toast} />
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

/**
 * When bringing this machine and the account together is held up – offline, or refused. Else
 * nothing: it runs by itself every few seconds, online the pages are the server's anyway.
 */
function syncTrouble(sync: CloudSync | null): string | null {
  if (sync?.state === 'offline') return 'Offline, Änderungen warten';
  if (sync?.state === 'error') return sync.message ?? 'Synchronisieren hat nicht geklappt';
  return null;
}
