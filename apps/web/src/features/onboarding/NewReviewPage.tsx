import { Navigate } from 'react-router';
import { routes } from '@/lib/routes';
import { CenteredMessage } from '@/shell/CenteredMessage';
import { TextLink } from '@/ui';
import {
  canCreateDecks,
  deckLimitMessage,
  deckState,
  useActiveWorkspace,
} from '@/features/workspaces';
import { NewReview } from './components/NewReview';

/**
 * A1 "Neue Review" (BER-91, BER-92) with the A3 "no access" state.
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
        <TextLink to={routes.workspace(workspace.id)} variant="underline" size="sm">
          Zurück zu den Reviews
        </TextLink>
      </CenteredMessage>
    );
  }
  if (deckState(workspace.usage).full) {
    // The plan's deck limit (BER-130) – the API would refuse the import anyway.
    return (
      <CenteredMessage title="Keine Präsentation mehr frei" message={deckLimitMessage(workspace)}>
        <TextLink to={routes.workspace(workspace.id)} variant="underline" size="sm">
          Zu den Reviews
        </TextLink>
      </CenteredMessage>
    );
  }
  // Keyed, so another `?workspace=` starts over.
  return <NewReview key={workspace.id} workspace={workspace} />;
}
