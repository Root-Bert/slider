import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useCreateBlankDeck, useRemoveWorkspaceMaster, useWorkspaceMasters } from '@/lib/api';
import { routes } from '@/lib/routes';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  GlassPanel,
  Icon,
  LoadingState,
  Menu,
  PageHeader,
  Toast,
  useToast,
  type MenuAction,
} from '@/ui';
import { MasterLayouts } from './components/material/MasterCollection';
import { MasterNameInput } from './components/material/MasterNameInput';
import { MasterSpecimens } from './components/material/MasterSpecimens';
import { WorkspaceViews } from './components/WorkspaceViews';
import { useWorkspace } from './hooks/useWorkspace';
import { downloadMaster, metaLine } from './lib/masters';
import { atLeast } from './lib/roles';

/**
 * `/w/:workspaceId/material/folienmaster/:masterId` – one uploaded design with every layout,
 * large. Laid out like "Bibliothek": its title, and where the filter sits a pill like the filter's,
 * the slide masters (the way back) and this one's name, selected.
 */
export function Component() {
  const workspace = useWorkspace();
  const { masterId } = useParams();
  const navigate = useNavigate();
  const [toast, showToast] = useToast();
  const [renaming, setRenaming] = useState(false);
  const masters = useWorkspaceMasters(workspace.id);
  const remove = useRemoveWorkspaceMaster(workspace.id);
  // A presentation built on the design: its first layout, straight into the editor.
  const create = useCreateBlankDeck(workspace.id);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const master = masters.data?.find((item) => item.id === masterId);
  const actions: MenuAction[] = [
    ...(master
      ? [{ label: 'Herunterladen', icon: 'download', onSelect: () => downloadMaster(master) }]
      : []),
    ...(atLeast(workspace.role, 'member')
      ? [{ label: 'Umbenennen', icon: 'edit', onSelect: () => setRenaming(true) }]
      : []),
    ...(atLeast(workspace.role, 'admin')
      ? [
          {
            label: 'Löschen',
            icon: 'delete',
            tone: 'danger',
            onSelect: () => {
              setRemoveError(null);
              setRemoving(true);
            },
          } satisfies MenuAction,
        ]
      : []),
  ];
  const back = routes.workspaceMaterial(workspace.id, 'vorlagen');

  return (
    <div className="dot-grid relative min-h-full overflow-x-clip">
      <title>{`${master?.name ?? 'Vorlage'} | ${workspace.name} | Slider`}</title>
      <main className="flex flex-col gap-6 px-4 pt-2 pb-16 md:px-14">
        <PageHeader
          titleRow
          title={<WorkspaceViews workspaceId={workspace.id} current="material" />}
        />

        {/* The material's toolbar: where its filter sits, the way back and the design's name with
            its ⋯; beside it, as in the Präsentationen overview, "Neue Präsentation". */}
        <div className="flex flex-wrap items-center gap-3">
          <GlassPanel className="flex min-w-0 items-center gap-1 p-1">
            <Link
              to={back}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control px-2.5 text-body whitespace-nowrap text-fg-muted transition-colors hover:bg-hover hover:text-fg"
            >
              <Icon name="arrowBack" size={18} />
              Vorlagen
              {masters.data && (
                <span className="text-xs font-medium text-fg-subtle">{masters.data.length}</span>
              )}
            </Link>
            {master && (
              <span
                id="master-name"
                title={metaLine(master)}
                className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-control bg-selected px-2.5 text-body font-medium text-fg"
              >
                <Icon name="slideMaster" size={18} />
                {renaming ? (
                  <MasterNameInput
                    workspaceId={workspace.id}
                    master={master}
                    onDone={() => setRenaming(false)}
                    onNotify={showToast}
                    className="w-[24ch]"
                  />
                ) : (
                  <span className="truncate">{master.name}</span>
                )}
                <span className="text-xs font-medium text-fg-muted">{master.layouts.length}</span>
              </span>
            )}
            {master && actions.length > 0 && (
              <Menu label={`Aktionen für „${master.name}“`} actions={actions} />
            )}
          </GlassPanel>
          {master?.format === 'odp' && atLeast(workspace.role, 'member') && (
            <Button
              variant="secondary"
              size="toolbar"
              icon="add"
              aria-label="Neue Präsentation"
              loading={create.isPending}
              onClick={() =>
                create.mutate(master.id, {
                  onSuccess: (deck) =>
                    void navigate(routes.deck(deck.id), { viewTransition: true }),
                  onError: (error) => showToast(error.message, 'danger'),
                })
              }
            >
              <span className="max-sm:hidden">Neue Präsentation</span>
            </Button>
          )}
        </div>

        {masters.isPending ? (
          <LoadingState />
        ) : masters.isError ? (
          <EmptyState
            title="Vorlagen konnten nicht geladen werden"
            message={masters.error.message}
            action={
              <Button variant="secondary" icon="refresh" onClick={() => void masters.refetch()}>
                Erneut versuchen
              </Button>
            }
          />
        ) : !master ? (
          <EmptyState
            illustration={<MasterSpecimens />}
            title="Diese Vorlage gibt es nicht mehr"
            message="Vielleicht hat sie jemand gelöscht."
          />
        ) : (
          <section aria-labelledby="master-name">
            <MasterLayouts master={master} />
          </section>
        )}
      </main>
      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        title={`${master?.name ?? 'Vorlage'} löschen?`}
        description="Die Datei und die Bilder ihrer Layouts werden gelöscht. Präsentationen bleiben, wie sie sind."
        confirmLabel="Löschen"
        confirmIcon="delete"
        pending={remove.isPending}
        error={removeError ?? undefined}
        onConfirm={() => {
          if (!master) return;
          remove.mutate(master.id, {
            onSuccess: () => {
              setRemoving(false);
              void navigate(back);
            },
            onError: (error) => setRemoveError(error.message),
          });
        }}
      />
      <Toast toast={toast} />
    </div>
  );
}
