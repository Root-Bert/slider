import { currentPath, routes } from '@/app/routes';
import { MicrosoftMark } from '@/features/auth/components/MicrosoftMark';
import { providerLoginUrl } from '@/features/auth/lib/return-to';
import { useMe } from '@/lib/queries';
import { useAuthProviders, useLogout } from '@/lib/workspace-queries';
import { Avatar, Icon, Spinner } from '@/ui';
import { HeaderPopover, PopoverDivider, PopoverItem } from './HeaderPopover';

const MICROSOFT_CONNECT_URL = '/api/auth/microsoft/login';

/** Header avatar with the account menu: who is signed in, Microsoft connection, sign out. */
export function AccountMenu() {
  const { data: me } = useMe();
  const providers = useAuthProviders();
  const logout = useLogout();
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
      trigger={() => (
        <Avatar author={{ ...me.viewer.author, avatarUrl: user.avatarUrl }} size={32} />
      )}
    >
      {() => (
        <>
          <div className="flex items-center gap-3 px-2.5 pt-2 pb-2.5">
            <Avatar author={{ ...me.viewer.author, avatarUrl: user.avatarUrl }} size={32} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium text-fg">{user.name}</span>
              <span className="truncate text-xs text-fg-subtle">{user.email}</span>
            </span>
          </div>
          {microsoftAvailable && (
            <>
              <PopoverDivider />
              {user.microsoftConnected ? (
                <div className="flex min-h-9 items-center gap-2.5 px-2.5 py-1.5 text-[13px] text-fg">
                  <MicrosoftMark />
                  <span className="flex-1">Microsoft verbunden</span>
                  <Icon name="checkCircle" size={18} className="text-success" />
                </div>
              ) : (
                <PopoverItem
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
                </PopoverItem>
              )}
            </>
          )}
          <PopoverDivider />
          <PopoverItem
            icon={
              logout.isPending ? (
                <Spinner size={18} />
              ) : (
                <Icon name="logout" size={18} className="text-fg-subtle" />
              )
            }
            onSelect={signOut}
          >
            Abmelden
          </PopoverItem>
        </>
      )}
    </HeaderPopover>
  );
}
