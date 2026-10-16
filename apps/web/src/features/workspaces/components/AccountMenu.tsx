import { useState } from 'react';
import { useNavigate } from 'react-router';
import { currentPath, routes } from '@/lib/routes';
import { dismissPasskeyHint, passkeyHintDismissed, passkeysSupported } from '@/lib/passkeys';
import { providerLoginUrl } from '@/features/auth';
import { useAuthProviders, useLogout, useMe, usePasskeys } from '@/lib/api';
import {
  Avatar,
  Icon,
  IconButton,
  ListRow,
  MenuDivider,
  MenuItem,
  MicrosoftMark,
  PasskeyMark,
  Spinner,
} from '@/ui';
import { HeaderPopover } from './HeaderPopover';

const MICROSOFT_CONNECT_URL = '/api/auth/microsoft/login';

/**
 * Header avatar with the account menu: who is signed in, "Konto & Anmeldung", "Einstellungen"
 * (its own page, kept apart from the account), Microsoft connection, sign out – and once, until
 * dismissed, a nudge to add a passkey.
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
            <div className="mx-1 mb-1.5 flex items-start gap-2.5 rounded-control bg-surface-1 py-2.5 pr-1.5 pl-3">
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
                onClick={() => {
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
            icon="settings"
            onClick={() => {
              close();
              void navigate(routes.preferences());
            }}
          >
            Einstellungen
          </MenuItem>
          {microsoftAvailable && (
            <>
              <MenuDivider />
              {user.microsoftConnected ? (
                <MenuItem
                  as="div"
                  icon={<MicrosoftMark />}
                  trailing={<Icon name="checkCircle" size={18} className="text-success" />}
                >
                  Microsoft verbunden
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
        </>
      )}
    </HeaderPopover>
  );
}
