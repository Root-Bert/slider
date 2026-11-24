import { Navigate } from 'react-router';
import { appHome, useCurrentApp } from '@/lib/apps';
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
  // Back into the app it was opened from (Cloud's „Neu“, Slider's Präsentationen).
  const app = useCurrentApp();
  if (!workspace) return <Navigate to={routes.home()} replace />;
  const back = appHome(app, workspace.id);
  if (!canCreateDecks(workspace.role)) {
    return (
      <CenteredMessage title="Keine Berechtigung zum Anlegen" message={noCreateMessage(workspace)}>
        <TextLink to={back.to} variant="underline" size="sm">
          {back.label}
        </TextLink>
      </CenteredMessage>
    );
  }
  if (workspace.locked) {
    // Over the plan's limits (BER-155) – the API would refuse the import anyway.
    return (
      <CenteredMessage title="Gerade keine neue Präsentation" message={LOCKED_MESSAGE}>
        <TextLink to={routes.usage(workspace.id)} variant="underline" size="sm">
          Zur Nutzung
        </TextLink>
      </CenteredMessage>
    );
  }
  if (deckState(workspace.usage).full) {
    // The plan's deck limit (BER-130) – the API would refuse the import anyway.
    return (
      <CenteredMessage title="Keine Präsentation mehr frei" message={deckLimitMessage(workspace)}>
        <TextLink to={back.to} variant="underline" size="sm">
          {back.label}
        </TextLink>
      </CenteredMessage>
    );
  }
  // Keyed, so another `?workspace=` starts over.
  return <NewReview key={workspace.id} workspace={workspace} />;
}
