import { useCallback } from 'react';
import { Navigate, useLocation, useParams } from 'react-router';
import { isSignedOutError } from '@/features/auth';
import { usePageCommands } from '@/features/commands';
import { useStoredChoice } from '@/features/reviews';
import { registerOfficeFonts } from '@/features/viewer';
import { useDocument, useMe } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { WRITER_START } from '@/lib/apps';
import { routes } from '@/lib/routes';
import { CenteredMessage } from '@/shell/CenteredMessage';
import { LoadingState, TextLink } from '@/ui';
import { Editor } from './editor/Editor';
import { MARKDOWN_VIEWS, type MarkdownView } from './lib/markdown';

registerOfficeFonts();

/** `/t/:documentId` – one document, open. */
export function Component() {
  const { documentId = '' } = useParams();
  const location = useLocation();
  const me = useMe();
  const opened = useDocument(documentId);
  // ⌘K: „Gehe zu“ and the apps lead into the document's workspace, which the address does not say.
  const workspaceId = opened.data?.document.workspaceId;
  usePageCommands({ group: 'Dokument', actions: [], workspaceId }, Boolean(workspaceId));
  // A Markdown file is shown as last chosen: rendered or as written.
  const [markdownView, setMarkdownView] = useStoredChoice(
    'writer.markdown.view',
    MARKDOWN_VIEWS,
    'rendered',
  );
  const { refetch } = opened;
  const showMarkdown = useCallback(
    async (view: MarkdownView) => {
      await refetch();
      setMarkdownView(view);
    },
    [refetch, setMarkdownView],
  );

  if (isSignedOutError(me.error) || isSignedOutError(opened.error)) {
    return <Navigate to={routes.login(location.pathname + location.search)} replace />;
  }
  const error = opened.error ?? me.error;
  if (error) {
    const status = error instanceof ApiError ? error.status : 0;
    // As a presentation's: never a dead end.
    const back = (
      <TextLink to={WRITER_START} variant="underline" size="sm">
        Zu den Dokumenten
      </TextLink>
    );
    return status === 404 ? (
      <CenteredMessage
        title="Dokument nicht gefunden"
        message="Es wurde gelöscht oder der Link stimmt nicht."
      >
        {back}
      </CenteredMessage>
    ) : status === 403 ? (
      <CenteredMessage
        title="Kein Zugriff"
        message="Dieses Dokument ist nicht für dich freigegeben."
      >
        {back}
      </CenteredMessage>
    ) : (
      <CenteredMessage title="Das hat nicht geklappt" message={error.message}>
        {back}
      </CenteredMessage>
    );
  }
  const author = me.data?.viewer.author;
  if (!opened.data || !author) return <LoadingState fullPage height="screen" />;
  // A Markdown file is a page: read and written in Cloud, where it lies.
  const { document } = opened.data;
  if (/\.(md|markdown)$/i.test(document.fileName)) {
    return <Navigate to={routes.cloudPage(document.workspaceId, document.id)} replace />;
  }
  // A document of its own each time: nothing typed into one reaches the next. Another view of a
  // Markdown file is drawn anew from the file as it is now.
  return (
    <Editor
      key={`${opened.data.document.id}:${markdownView}`}
      opened={opened.data}
      me={author}
      markdownView={markdownView}
      onMarkdownView={showMarkdown}
    />
  );
}
