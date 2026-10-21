import { Navigate } from 'react-router';
import { routes } from '@/lib/routes';
import { CenteredMessage } from '@/shell/CenteredMessage';
import { TextLink } from '@/ui';
import {
  canCreateDecks,
  deckLimitMessage,
  deckState,
  LOCKED_MESSAGE,
  useActiveWorkspace,
} from '@/features/workspaces';
import { NewReview } from './components/NewReview';
import { noCreateMessage } from './lib/no-create';

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
      <CenteredMessage title="Keine Berechtigung zum Anlegen" message={noCreateMessage(workspace)}>
        <TextLink to={routes.workspace(workspace.id)} variant="underline" size="sm">
          Zurück zu den Reviews
        </TextLink>
      </CenteredMessage>
    );
  }
  if (workspace.locked) {
    // Over the plan's limits (BER-155) – the API would refuse the import anyway.
    return (
      <CenteredMessage title="Gerade keine neue Review" message={LOCKED_MESSAGE}>
        <TextLink to={routes.usage(workspace.id)} variant="underline" size="sm">
          Zur Nutzung
        </TextLink>
      </CenteredMessage>
    );
  }
  if (deckState(workspace.usage).full) {
    // The plan's deck limit (BER-130) – the API would refuse the import anyway.
    return (
      <CenteredMessage title="Keine Review mehr frei" message={deckLimitMessage(workspace)}>
        <TextLink to={routes.workspace(workspace.id)} variant="underline" size="sm">
          Zu den Reviews
        </TextLink>
      </CenteredMessage>
    );
  }
  // Keyed, so another `?workspace=` starts over.
  return <NewReview key={workspace.id} workspace={workspace} />;
}
