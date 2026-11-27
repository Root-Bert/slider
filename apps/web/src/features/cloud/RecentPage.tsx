import { useState } from 'react';
import { WorkspaceViews } from '@/features/workspaces';
import { useCloudList } from '@/lib/api';
import { Button } from '@/ui';
import { CloudPage } from './components/CloudPage';
import { HomeBoard } from './home/HomeBoard';
import { CLOUD_KIT, RECENT, useAvailable } from './home/widgets';
import { useCloud } from './hooks/useCloud';

/**
 * „Zuletzt“ – Cloud's start, as widgets one arranges oneself (`home/`): the order field, what
 * waits for one, what to go on with, what is new and unread, one's tasks and dates, the files
 * that changed and what happened around – and more from the panel „Anpassen“ opens.
 */
export function Component() {
  const ui = useCloud();
  const { workspace } = ui;
  // The files „Zuletzt geändert“ lists – picked as on every page of Cloud.
  const listing = useCloudList(workspace.id, RECENT);
  const nodes = listing.data?.nodes ?? [];
  const [editing, setEditing] = useState(false);
  const available = useAvailable();

  return (
    <CloudPage
      docTitle="Zuletzt"
      // Beside it the library, as in Slider: one click across.
      title={<WorkspaceViews workspaceId={workspace.id} current="reviews" app="cloud" />}
      crumbs={[{ label: 'Zuletzt' }]}
      // While the widgets are arranged no file is picked: the page's ⌫, ↵, ↑/↓ and ⌘A sleep.
      nodes={editing ? [] : nodes}
      target={{ name: 'Meine Dateien' }}
      actions={
        !editing && (
          <Button variant="ghost" icon="dashboard" onClick={() => setEditing(true)}>
            Anpassen
          </Button>
        )
      }
    >
      {(selection) => (
        <>
          {/* This page has no toolbar: the picked ones' actions stand over the widgets. The
              search is the side bar's. */}
          {selection.bar}
          <HomeBoard
            kit={CLOUD_KIT}
            userId={ui.userId}
            workspaceId={workspace.id}
            notify={ui.notify}
            available={available}
            selection={selection}
            editing={editing}
            onEdit={setEditing}
          />
        </>
      )}
    </CloudPage>
  );
}
