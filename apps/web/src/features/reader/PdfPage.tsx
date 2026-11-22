import { useRef } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { isSignedOutError } from '@/features/auth';
import { useImportPdf, useMe, usePdf } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { READER_START } from '@/lib/apps';
import { routes } from '@/lib/routes';
import { CenteredMessage } from '@/shell/CenteredMessage';
import { LoadingState, TextLink, useToast } from '@/ui';
import { inReaderDesktopBar, useReaderDesktopActions } from './hooks/useReaderDesktop';
import { PDF_ACCEPT } from './lib/pdfs';
import { Viewer } from './viewer/Viewer';

/** `/r/:pdfId` – one PDF, open. */
export function Component() {
  const { pdfId = '' } = useParams();
  const location = useLocation();
  const me = useMe();
  const opened = usePdf(pdfId);

  if (isSignedOutError(me.error) || isSignedOutError(opened.error)) {
    return <Navigate to={routes.login(location.pathname + location.search)} replace />;
  }
  const error = opened.error ?? me.error;
  if (error) {
    const status = error instanceof ApiError ? error.status : 0;
    // As a presentation's: never a dead end.
    const back = (
      <TextLink to={READER_START} variant="underline" size="sm">
        Zu den PDFs
      </TextLink>
    );
    return status === 404 ? (
      <CenteredMessage
        title="PDF nicht gefunden"
        message="Es wurde gelöscht oder der Link stimmt nicht."
      >
        {back}
      </CenteredMessage>
    ) : status === 403 ? (
      <CenteredMessage title="Kein Zugriff" message="Dieses PDF ist nicht für dich freigegeben.">
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
  // A PDF of its own each time: nothing filled into one reaches the next.
  return (
    <>
      <Viewer key={opened.data.pdf.id} opened={opened.data} me={author} />
      {inReaderDesktopBar() && <DesktopOpen workspaceId={opened.data.pdf.workspaceId} />}
    </>
  );
}

/**
 * „PDF hinzufügen …“ in Reader's desktop app works from an open PDF too, as Writer's „Öffnen …“
 * from a document: the picked PDF comes into this one's workspace and opens.
 */
function DesktopOpen({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const importPdf = useImportPdf(workspaceId);
  const input = useRef<HTMLInputElement>(null);
  const [toast, notify] = useToast();
  useReaderDesktopActions((action) => {
    if (action === 'open' && !importPdf.isPending) input.current?.click();
  });
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={PDF_ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          importPdf.mutate(file, {
            onSuccess: (pdf) => void navigate(routes.pdf(pdf.id)),
            onError: (error) =>
              notify(error instanceof Error ? error.message : 'Das hat nicht geklappt', 'danger'),
          });
        }}
      />
      {toast}
    </>
  );
}
