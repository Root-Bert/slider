import { useState, type ReactNode } from 'react';
import { editsUnsentBeforeSignOut } from '@/features/viewer';
import { routes } from '@/lib/routes';
import { desktopBridge } from '@/lib/desktop-bridge';
import { forgetOffline } from '@/lib/offline';
import {
  useAuthProviders,
  useCloudSignOut,
  useCloudStatus,
  useDesktopState,
  useLogout,
  useMe,
  useOtherAccounts,
} from '@/lib/api';
import { ConfirmDialog, type MenuAction } from '@/ui';
import { useAccountSwitch } from './useAccountSwitch';

/**
 * Signing out, as the account menu offers it – in the browser, in the desktop app's server pages
 * (the bridge) and in the desktop app itself (its Slider server). Signing out waits a moment for
 * edits still on their way; any left unsent would go with it, so it asks first. `actions` are the
 * menu's sign-out rows (the command panel shows them), `dialog` its questions – render it.
 */
export function useSignOut() {
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
  const cloudSignOut = useCloudSignOut();
  const [confirmCloudSignOut, setConfirmCloudSignOut] = useState(false);
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

  const leave = () =>
    logout.mutate(undefined, { onSuccess: () => window.location.assign(routes.login()) });
  const signOutHere = async () => {
    if (checking || logout.isPending) return;
    setChecking(true);
    const left = await editsUnsentBeforeSignOut().finally(() => setChecking(false));
    if (left > 0) setUnsent(left);
    else leave();
  };
  /** Every account here – „Abmelden“, or „Von allen Konten abmelden“ beside others. `asking`: just before the bridge's question opens. */
  const signOutAll = (asking?: () => void) => {
    if (!bridge) return void signOutHere();
    if (checking) return;
    setChecking(true);
    void editsUnsentBeforeSignOut()
      .then((left) => {
        asking?.();
        setBridgeUnsent(left);
        setBridgeSignOutFailed(false);
        setConfirmBridgeSignOut(true);
      })
      .finally(() => setChecking(false));
  };
  const askCloudSignOut = () => setConfirmCloudSignOut(true);
  /** Only this account (others are signed in here): the next one takes over. */
  const signsOutOne = others.length > 0 && (!bridge || offlineAccount !== null);
  const allLabel = others.length > 0 ? 'Von allen Konten abmelden' : 'Abmelden';

  const actions: MenuAction[] = !me?.user
    ? []
    : desktop
      ? cloudAccount
        ? [{ key: 'sign-out', label: 'Abmelden', icon: 'logout', onSelect: askCloudSignOut }]
        : []
      : [
          ...(signsOutOne
            ? [
                {
                  key: 'sign-out-one',
                  label: 'Abmelden',
                  icon: 'logout',
                  disabled: accounts.busy,
                  onSelect: accounts.signOut,
                } satisfies MenuAction,
              ]
            : []),
          { key: 'sign-out', label: allLabel, icon: 'logout', onSelect: () => signOutAll() },
        ];

  const dialog: ReactNode = (
    <>
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
            // Every account of the app's pages signs out (`desktop:signOut`), their drafts too.
            void forgetOffline('everyone')
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

  return {
    actions,
    dialog,
    desktop,
    bridge,
    cloud,
    cloudAccount,
    others,
    accounts,
    desktopState,
    offlineAccount,
    signsOutOne,
    allLabel,
    signOutAll,
    askCloudSignOut,
    /** Waiting for edits on their way, or signing out with none left. */
    busy: checking || (logout.isPending && unsent === null),
    logoutFailed: logout.isError,
    /** Signing out failed where no question stands to say it. */
    failed:
      unsent === null && logout.isError
        ? 'Abmelden hat nicht geklappt. Bitte erneut versuchen.'
        : (accounts.error ?? null),
  };
}
