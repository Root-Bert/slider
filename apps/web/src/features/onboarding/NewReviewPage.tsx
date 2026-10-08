import { Link, Navigate } from 'react-router';
import { CenteredMessage } from '@/app/RouteError';
import { routes } from '@/app/routes';
import { deckLimitMessage, deckState } from '@/features/workspaces/lib/plan';
import { canCreateDecks } from '@/features/workspaces/lib/roles';
import { useActiveWorkspace } from '@/features/workspaces/useWorkspace';
import { NewReview } from './NewReview';

/**
 * A1 "Neuer Review" (BER-91, BER-92) with the A3 "no access" state.
 * Both paths end on the deck page, which shows the import progress (BER-97).
 * The deck goes into `?workspace=` (else the last used workspace).
 */
export function Component() {
  const workspace = useActiveWorkspace();
  if (!workspace) return <Navigate to={routes.reviews()} replace />;
  if (!canCreateDecks(workspace.role)) {
    return (
      <CenteredMessage
        title="Nur ansehen und kommentieren"
        message={`Als Reviewer in „${workspace.name}“ kannst du keine Präsentationen hinzufügen. Bitte einen Admin, dich zum Mitglied zu machen.`}
      >
        <Link
          to={routes.workspace(workspace.id)}
          className="text-sm text-fg-muted underline underline-offset-4 hover:text-fg"
        >
          Zurück zu den Reviews
        </Link>
      </CenteredMessage>
    );
  }
  if (deckState(workspace.usage).full) {
    // The plan's deck limit (BER-130) – the API would refuse the import anyway.
    return (
      <CenteredMessage title="Keine Präsentation mehr frei" message={deckLimitMessage(workspace)}>
        <Link
          to={routes.workspace(workspace.id)}
          className="text-sm text-fg-muted underline underline-offset-4 hover:text-fg"
        >
          Zu den Reviews
        </Link>
      </CenteredMessage>
    );
  }
  // Keyed, so another `?workspace=` starts over.
  return <NewReview key={workspace.id} workspace={workspace} />;
}
