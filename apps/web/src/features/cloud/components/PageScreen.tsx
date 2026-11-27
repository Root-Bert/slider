import { useState, type ReactNode } from 'react';
import { useDocument, useRenameCloudNode } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { PageEditor, PageHostProvider, type PageSyncState } from '@/features/pages';
import { Button, LoadingState } from '@/ui';
import { useCloud } from '../hooks/useCloud';
import { pageTitle } from '../lib/pages';
import { CloudPage, type Crumb } from './CloudPage';
import { Empty, LoadFailed } from './Empty';
import { useCloudPageHost, type PagePlace } from './PageLive';

/*
 * A page open in Cloud: its title, „Bearbeiten“ right of it, the page under it in one column.
 * It opens to be read; „Bearbeiten“ makes the title and the page typable where they stand,
 * „Fertig“ (or Esc, ⌘↵) ends it – the page is the same picture either way. Who may not change
 * the file has no button.
 */

const SYNC_LABEL: Record<PageSyncState, string | null> = {
  saved: null,
  saving: null,
  offline: 'Offline',
  signedOut: 'Abgemeldet',
};

export interface PageScreenProps {
  pageId: string;
  place: Omit<PagePlace, 'selfId'>;
  crumbs?: (title: string) => Crumb[];
  barRow?: string;
  lead?: ReactNode;
  /** In the title's place (an area's views); the page's own title otherwise, renamed in it. */
  title?: ReactNode;
  docTitle?: string;
  /** Before „Bearbeiten“ (an area's people). */
  aside?: ReactNode;
  /** Opened to be written in at once (a page just made). */
  editing?: boolean;
}

export function PageScreen({
  pageId,
  place,
  crumbs,
  barRow,
  lead,
  title,
  docTitle,
  aside,
  editing: startEditing = false,
}: PageScreenProps) {
  const { workspace } = useCloud();
  const opened = useDocument(pageId);
  const rename = useRenameCloudNode(workspace.id);
  const host = useCloudPageHost({ ...place, selfId: pageId });
  const [editing, setEditing] = useState(startEditing);
  const [sync, setSync] = useState<PageSyncState>('saved');
  const [named, setNamed] = useState<string | null>(null);

  const document = opened.data?.document;
  const name = named ?? (document ? pageTitle(document.fileName) : '');
  const canEdit = document?.permissions.canEdit ?? false;
  const status = opened.error instanceof ApiError ? opened.error.status : 0;

  const commitName = (next: string) => {
    const clean = next.trim();
    if (!document || !clean || clean === pageTitle(document.fileName)) {
      setNamed(null);
      return;
    }
    const ending = /\.(md|markdown)$/i.exec(document.fileName)?.[0] ?? '.md';
    setNamed(clean);
    rename.mutate(
      { id: document.id, name: `${clean}${ending}` },
      {
        onError: (error) => {
          setNamed(null);
          host.notify(error.message, 'danger');
        },
      },
    );
  };

  const heading =
    title ??
    (editing && canEdit ? (
      <input
        key={name}
        defaultValue={name}
        aria-label="Titel"
        placeholder="Ohne Titel"
        className="w-full min-w-0 bg-transparent outline-none placeholder:text-fg-faint"
        onBlur={(event) => commitName(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault();
            if (event.key === 'Escape') event.currentTarget.value = name;
            event.currentTarget.blur();
            // Named, on to its text (as Notion's title).
            if (event.key === 'Enter') {
              window.document
                .querySelector<HTMLElement>('.page-body[contenteditable="true"]')
                ?.focus();
            }
          }
        }}
      />
    ) : (
      name || ' '
    ));

  const label = SYNC_LABEL[sync];
  const actions = (
    <div className="flex items-center gap-3">
      {aside}
      {canEdit && label && <span className="text-body text-fg-subtle">{label}</span>}
      {!canEdit ? null : editing ? (
        <Button variant="primary" size="sm" icon="check" onClick={() => setEditing(false)}>
          Fertig
        </Button>
      ) : (
        <Button variant="secondary" size="sm" icon="edit" onClick={() => setEditing(true)}>
          Bearbeiten
        </Button>
      )}
    </div>
  );

  return (
    <CloudPage
      docTitle={docTitle ?? (name || 'Seite')}
      title={heading}
      lead={lead}
      crumbs={crumbs?.(name)}
      barRow={barRow}
      actions={actions}
      nodes={[]}
    >
      {() =>
        opened.data ? (
          <PageHostProvider value={host}>
            <div className="w-full pt-2">
              <PageEditor
                opened={opened.data}
                editing={editing && canEdit}
                onDone={() => setEditing(false)}
                onSync={setSync}
              />
            </div>
          </PageHostProvider>
        ) : status === 404 ? (
          <Empty
            icon="article"
            title="Seite nicht gefunden"
            message="Sie wurde gelöscht oder der Link stimmt nicht."
          />
        ) : status === 403 ? (
          <Empty
            icon="lock"
            title="Kein Zugriff"
            message="Diese Seite ist nicht für dich freigegeben."
          />
        ) : opened.error ? (
          <LoadFailed message={opened.error.message} onRetry={() => void opened.refetch()} />
        ) : (
          <LoadingState />
        )
      }
    </CloudPage>
  );
}
