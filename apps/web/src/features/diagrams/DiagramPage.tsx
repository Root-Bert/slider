import { Navigate, useLocation, useParams } from 'react-router';
import { isSignedOutError } from '@/features/auth';
import { usePageCommands } from '@/features/commands';
import { useDiagram, useMe } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { CLOUD_START } from '@/lib/apps';
import { routes } from '@/lib/routes';
import { CenteredMessage } from '@/shell/CenteredMessage';
import { LoadingState, TextLink } from '@/ui';
import { DiagramEditor } from './components/DiagramEditor';

/** `/diagramm/:diagramId` – one diagram, open. */
export function Component() {
  const { diagramId = '' } = useParams();
  const location = useLocation();
  const me = useMe();
  const opened = useDiagram(diagramId);
  // ⌘K: „Gehe zu“ and the apps lead into the diagram's workspace, which the address does not say.
  const workspaceId = opened.data?.file.workspaceId;
  usePageCommands({ group: 'Diagramm', actions: [], workspaceId }, Boolean(workspaceId));

  if (isSignedOutError(me.error) || isSignedOutError(opened.error)) {
    return <Navigate to={routes.login(location.pathname + location.search)} replace />;
  }
  const error = opened.error ?? me.error;
  if (error) {
    const status = error instanceof ApiError ? error.status : 0;
    const back = (
      <TextLink to={CLOUD_START} variant="underline" size="sm">
        Zu den Dateien
      </TextLink>
    );
    return status === 404 ? (
      <CenteredMessage title="Diagramm nicht gefunden" message="Es wurde gelöscht oder der Link stimmt nicht.">
        {back}
      </CenteredMessage>
    ) : status === 403 ? (
      <CenteredMessage title="Kein Zugriff" message="Dieses Diagramm ist nicht für dich freigegeben.">
        {back}
      </CenteredMessage>
    ) : (
      <CenteredMessage title="Das hat nicht geklappt" message={error.message}>
        {back}
      </CenteredMessage>
    );
  }
  const author = me.data?.viewer.author;
  // Read anew on each opening: what was drawn last time (here or by someone else) is the start.
  if (!opened.data || !opened.isFetchedAfterMount || !author) return <LoadingState fullPage height="screen" />;
  // One editor per diagram: nothing drawn on one reaches the next.
  return <DiagramEditor key={opened.data.file.id} opened={opened.data} me={author} />;
}
