import { useState, type ReactNode } from 'react';
import { editsUnsentBeforeSignOut } from '@/features/viewer';
import { useSignOutAccount, useSwitchAccount } from '@/lib/api';
import { desktopBridge } from '@/lib/desktop-bridge';
import { routes } from '@/lib/routes';
import { ConfirmDialog } from '@/ui';

/** Accounts kept beside the one in use, as the server does (`auth/session.ts`). */
export const MAX_OTHER_ACCOUNTS = 4;

/**
 * Switching to another account signed in on this browser, or signing in to one more – as
 * „Abmelden“ does: it waits a moment for edits still on their way, and asks first if some would
 * be left unsent (they go with the account's offline data, never out under the other account).
 * Render `dialog`.
 */
export function useAccountSwitch(): {
  switchTo: (userId: string, path?: string) => void;
  /** `returnTo`: where the browser goes once signed in (not in the desktop app). */
  addAccount: (returnTo?: string) => void;
  /** Signs the account in use out; another one signed in here takes over. */
  signOut: () => void;
  busy: boolean;
  error: string | null;
  dialog: ReactNode;
} {
  const switchAccount = useSwitchAccount();
  const signOutAccount = useSignOutAccount();
  const [checking, setChecking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [unsent, setUnsent] = useState<{
    count: number;
    go: () => void;
    signingOut: boolean;
  } | null>(null);
  const pending = switchAccount.isPending || signOutAccount.isPending;
  const failed = switchAccount.error ?? signOutAccount.error;

  const guarded = async (go: () => void, signingOut = false) => {
    if (checking || leaving || pending) return;
    setChecking(true);
    const left = await editsUnsentBeforeSignOut().finally(() => setChecking(false));
    if (left > 0) setUnsent({ count: left, go, signingOut });
    else go();
  };

  const switchTo = (userId: string, path = '/') =>
    void guarded(() =>
      switchAccount.mutate(userId, { onSuccess: () => window.location.assign(path) }),
    );
  const addAccount = (returnTo?: string) =>
    void guarded(() => {
      // In the desktop app the browser signs in (it knows the person's accounts, and logins
      // like Google's refuse an app's window); the app then loads its pages as the new account.
      const bridge = desktopBridge();
      if (bridge?.addAccount) return void bridge.addAccount();
      // What the browser keeps of this account stays until another one is signed in
      // (`pageIsFor`): „Abbrechen“ there loses nothing.
      setLeaving(true);
      window.location.assign(routes.addAccount(returnTo));
    });
  const signOut = () =>
    void guarded(
      () => signOutAccount.mutate(undefined, { onSuccess: () => window.location.assign('/') }),
      true,
    );

  return {
    switchTo,
    addAccount,
    signOut,
    busy: checking || leaving || pending,
    error: failed?.message ?? null,
    dialog: unsent && (
      <ConfirmDialog
        title={unsent.signingOut ? 'Trotzdem abmelden?' : 'Trotzdem wechseln?'}
        description={`${
          unsent.count === 1
            ? 'Eine Änderung ist noch nicht gespeichert.'
            : `${unsent.count} Änderungen sind noch nicht gespeichert.`
        } ${unsent.signingOut ? 'Beim Abmelden' : 'Beim Wechseln des Kontos'} gehen sie verloren.`}
        confirmLabel={unsent.signingOut ? 'Abmelden' : 'Wechseln'}
        confirmIcon={unsent.signingOut ? 'logout' : 'manageAccounts'}
        pending={pending || leaving}
        error={failed?.message}
        onClose={() => {
          switchAccount.reset();
          signOutAccount.reset();
          setUnsent(null);
        }}
        onConfirm={unsent.go}
      />
    ),
  };
}
