import { Navigate } from 'react-router';
import { useOtherAccounts } from '@/lib/api';
import { routes } from '@/lib/routes';
import { CenteredMessage } from '@/shell/CenteredMessage';
import { TextLink } from '@/ui';
import { OtherAccounts } from './OtherAccounts';

/**
 * A workspace the account in use does not belong to: one of another account signed in on this
 * browser is offered with a switch to it; anything else goes to `/`.
 */
export function ForeignWorkspace({ workspaceId }: { workspaceId: string }) {
  const others = useOtherAccounts();
  if (others.isPending) return null;
  const owner = others.data?.find((other) =>
    other.workspaces.some((workspace) => workspace.id === workspaceId),
  );
  if (!owner) return <Navigate to={routes.reviews()} replace />;
  const name = owner.workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? '';
  return (
    <CenteredMessage
      title="Workspace eines anderen Kontos"
      message={`„${name}“ gehört zu ${owner.user.email}. Du bist gerade mit einem anderen Konto angemeldet.`}
    >
      <OtherAccounts
        to={`${window.location.pathname}${window.location.search}`}
        only={owner.user.email}
        label={(email) => `Zu ${email} wechseln`}
      />
      <TextLink to={routes.reviews()} variant="underline" size="sm">
        Zu den Präsentationen
      </TextLink>
    </CenteredMessage>
  );
}
