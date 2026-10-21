import { useState } from 'react';
import { useNavigate } from 'react-router';
import { currentPath, routes } from '@/lib/routes';
import { dismissPasskeyHint, passkeyHintDismissed, passkeysSupported } from '@/lib/passkeys';
import { providerLoginUrl } from '@/features/auth';
import { useAuthProviders, useLogout, useMe, usePasskeys } from '@/lib/api';
import {
  Avatar,
  ErrorText,
  Icon,
  IconButton,
  ListRow,
  MenuDivider,
  MenuHeading,
  MenuItem,
  MicrosoftMark,
  PasskeyMark,
  Spinner,
} from '@/ui';
import { HeaderPopover } from './HeaderPopover';

const MICROSOFT_CONNECT_URL = '/api/auth/microsoft/login';

/**
 * Header avatar with the account menu: who is signed in, "Konto & Anmeldung", "Nutzung" (plan
 * and storage of the organisations), "Einstellungen" (its own page, kept apart from the
 * account), for the instance admin "Instanz" (dashboard and setup, BER-167), Microsoft
 * connections, sign out – and once, until dismissed, a nudge to add a passkey.
 */
export function AccountMenu() {
  const { data: me } = useMe();
  const providers = useAuthProviders();
  const logout = useLogout();
  const navigate = useNavigate();
  const [hintWanted, setHintWanted] = useState(
    () => passkeysSupported() && !passkeyHintDismissed(),
  );
  const passkeys = usePasskeys(Boolean(me?.user) && hintWanted);
  if (!me) return null;
  const user = me.user;
  if (!user) return <Avatar author={me.viewer.author} size={32} />;

  const microsoftAvailable =
    user.microsoftConnected || providers.data?.providers.some((p) => p.id === 'microsoft');
  const signOut = () =>
    logout.mutate(undefined, { onSuccess: () => window.location.assign(routes.login()) });

  return (
    <HeaderPopover
      label={`Konto: ${user.name}`}
      align="right"
      triggerClassName="flex rounded-full transition-opacity hover:opacity-85"
      trigger={() => <Avatar author={me.viewer.author} size={32} />}
    >
      {(close) => (
        <>
          <ListRow
            as="div"
            variant="flush"
            padding="header"
            size="body"
            leading={<Avatar author={me.viewer.author} size={32} />}
            title={user.name}
            subtitle={user.email}
          />
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
          {microsoftAvailable && (
            <>
              <MenuDivider />
              {user.microsoftConnected ? (
                // Several accounts can be connected: they are managed on /konto.
                <MenuItem
                  icon={<MicrosoftMark />}
                  trailing={<Icon name="checkCircle" size={18} className="text-success" />}
                  onClick={() => {
                    close();
                    void navigate(routes.account());
                  }}
                >
                  <span className="flex flex-col">
                    <span>Microsoft verbunden</span>
                    <span className="text-xs text-fg-subtle">
                      {user.microsoftConnections > 1
                        ? `${user.microsoftConnections} Konten | verwalten`
                        : 'Konten verwalten'}
                    </span>
                  </span>
                </MenuItem>
              ) : (
                <MenuItem
                  as="a"
                  icon={<MicrosoftMark />}
                  href={providerLoginUrl(MICROSOFT_CONNECT_URL, currentPath())}
                  trailing={<Icon name="arrowForward" size={16} className="text-fg-subtle" />}
                >
                  <span className="flex flex-col">
                    <span>Microsoft verbinden</span>
                    <span className="text-xs text-fg-subtle">
                      Für OneDrive- und SharePoint-Links
                    </span>
                  </span>
                </MenuItem>
              )}
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
