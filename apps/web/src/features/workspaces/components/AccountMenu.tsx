import { useState } from 'react';
import { useNavigate } from 'react-router';
import { routes } from '@/lib/routes';
import { dismissPasskeyHint, passkeyHintDismissed, passkeysSupported } from '@/lib/passkeys';
import { useLogout, useMe, usePasskeys } from '@/lib/api';
import {
  Avatar,
  ErrorText,
  Icon,
  IconButton,
  MenuDivider,
  MenuHeading,
  MenuItem,
  PasskeyMark,
  Spinner,
} from '@/ui';
import { HeaderPopover } from './HeaderPopover';

/**
 * Header avatar with the account menu: who is signed in, "Konto & Anmeldung", "Nutzung" (plan
 * and storage of the workspaces), "Einstellungen" (its own page, kept apart from the
 * account), for the instance admin "Instanz" (dashboard and setup, BER-167), sign out – and once,
 * until dismissed, a nudge to add a passkey. Logins and connections live on "Konto & Anmeldung".
 * The panel unfolds out of the avatar: it stays where it is, in the panel's top-right corner.
 */
export function AccountMenu() {
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const [hintWanted, setHintWanted] = useState(
    () => passkeysSupported() && !passkeyHintDismissed(),
  );
  const passkeys = usePasskeys(Boolean(me?.user) && hintWanted);
  if (!me) return null;
  const user = me.user;
  if (!user) return <Avatar author={me.viewer.author} size={32} />;

  const signOut = () =>
    logout.mutate(undefined, { onSuccess: () => window.location.assign(routes.login()) });

  return (
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
              <span className="truncate text-body font-medium text-fg">{user.name}</span>
              <span className="truncate text-xs text-fg-subtle">{user.email}</span>
            </div>
            {/* The trigger's avatar shows here, above the panel. */}
            <span aria-hidden className="size-8 shrink-0" />
          </div>
          {hintWanted && passkeys.data?.length === 0 && (
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
          <MenuDivider />
          <MenuItem
            icon={
              logout.isPending ? (
                <Spinner size={18} />
              ) : (
                <Icon name="logout" size={18} className="text-fg-subtle" />
              )
            }
            onClick={signOut}
          >
            Abmelden
          </MenuItem>
          {logout.isError && (
            <ErrorText role="alert" size="xs" className="px-3 pt-0.5 pb-1.5">
              Abmelden hat nicht geklappt – bitte erneut versuchen.
            </ErrorText>
          )}
        </>
      )}
    </HeaderPopover>
  );
}
