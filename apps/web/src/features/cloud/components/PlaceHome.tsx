import { cloudAccessAtLeast, type CloudNode } from '@slider/shared';
import { useState, type ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useCloudList } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { routes } from '@/lib/routes';
import { LIVE_KINDS, type LiveKind } from '@/features/pages';
import { AvatarStack, Button, LoadingState } from '@/ui';
import { useCloud } from '../hooks/useCloud';
import { areaTrail } from '../lib/areas';
import { HOME_PAGE_NAME, HOME_TEMPLATE, useCreatePage, type NewPage } from '../lib/pages';
import { AreaMark } from './AreaMark';
import { AreaViews } from './AreaViews';
import { CloudPage, type Crumb } from './CloudPage';
import { useCloudPageHost } from './PageLive';
import { PageScreen } from './PageScreen';

/*
 * A place's Startseite – an area's, the workspace's (its own area's), one's own: the page
 * „Startseite.md“ where the place's pages lie, read first, „Bearbeiten“ beside. Its pages are made
 * from it („/Seite“) and lie beside it, as Notion's under a page. Before anyone wrote one it shows
 * what the first would – what lives in the place – and „Bearbeiten“ makes it so and opens it to be
 * written in.
 */

/** What lies where the place's pages lie – nothing yet while that folder is not made. */
const IN_PLACE = new Set<LiveKind>(['unterseiten', 'dateien']);

const isHome = (name: string) => name.toLowerCase() === HOME_PAGE_NAME.toLowerCase();

/** The template's lines as the page will show them: its headings and its live blocks. */
type TemplateBlock = { live: LiveKind; heading?: never } | { live: null; heading: string };
const blocksOf = (template: string) =>
  template.split('\n').flatMap((line): TemplateBlock[] => {
    const live = /^\{\{(\w+)\}\}$/.exec(line)?.[1];
    if (live && (LIVE_KINDS as readonly string[]).includes(live)) {
      return [{ live: live as LiveKind }];
    }
    const heading = /^## (.+)$/.exec(line)?.[1];
    return heading ? [{ live: null, heading }] : [];
  });

export interface PlaceChrome {
  docTitle: string;
  title: ReactNode;
  lead?: ReactNode;
  barRow?: string;
  crumbs: Crumb[];
  /** Before „Bearbeiten“ (an area's people). */
  aside?: ReactNode;
}

export function PlaceHome({
  nodes,
  onTaken,
  place,
  newHome,
  template,
  canWrite,
  chrome,
}: {
  /** What lies where the place's pages lie; `undefined` while it is read. */
  nodes: readonly CloudNode[] | undefined;
  /** Someone wrote the first one meanwhile: the list is read anew, theirs opens. */
  onTaken: () => void;
  /** Where its pages lie – `null` while that folder is not made yet (nothing in it to show). */
  place: { areaId: string | null; parentId: string | null } | null;
  /** Where the first Startseite is made. */
  newHome: Omit<NewPage, 'title' | 'markdown' | 'onlyNew'>;
  template: string;
  canWrite: boolean;
  chrome: PlaceChrome;
}) {
  const ui = useCloud();
  const { workspace } = ui;
  const createPage = useCreatePage(workspace.id);
  const host = useCloudPageHost({
    workspaceId: workspace.id,
    areaId: place?.areaId ?? null,
    parentId: place?.parentId ?? null,
    selfId: null,
  });
  const [made, setMade] = useState<{ id: string; parentId: string | null } | null>(null);
  const [making, setMaking] = useState(false);

  const home = nodes?.find((node) => node.kind === 'file' && isHome(node.name));
  // The one made here stays open while one is on it, whatever the list says meanwhile.
  const pageId = made?.id ?? home?.id;
  const { crumbs, aside, ...frame } = chrome;

  if (pageId) {
    return (
      <PageScreen
        key={pageId}
        pageId={pageId}
        place={{
          workspaceId: workspace.id,
          areaId: place?.areaId ?? null,
          parentId: place?.parentId ?? made?.parentId ?? null,
        }}
        crumbs={() => crumbs}
        aside={aside}
        editing={made?.id === pageId}
        {...frame}
      />
    );
  }

  const start = async () => {
    setMaking(true);
    try {
      const node = await createPage({
        title: 'Startseite',
        ...newHome,
        markdown: template,
        onlyNew: true,
      });
      setMade({ id: node.id, parentId: node.parentId });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        onTaken();
        return;
      }
      ui.notify(error instanceof Error ? error.message : 'Startseite nicht angelegt', 'danger');
    } finally {
      setMaking(false);
    }
  };

  return (
    <CloudPage
      {...frame}
      crumbs={crumbs}
      nodes={[]}
      actions={
        <div className="flex items-center gap-3">
          {aside}
          {canWrite && nodes && (
            <Button
              variant="secondary"
              size="sm"
              icon="edit"
              disabled={making}
              onClick={() => void start()}
            >
              Bearbeiten
            </Button>
          )}
        </div>
      }
    >
      {() =>
        nodes ? (
          // What the first Startseite says, as it will look: the template's blocks, live.
          <div className="page-frame w-full pt-2">
            <div className="page-body">
              {blocksOf(template).map((block) =>
                block.live ? (
                  <div key={block.live} className="page-live">
                    {place || !IN_PLACE.has(block.live) ? (
                      host.live(block.live)
                    ) : (
                      <p className="page-live-empty">Noch nichts hier.</p>
                    )}
                  </div>
                ) : (
                  <h2 key={block.heading} className="page-h2">
                    {block.heading}
                  </h2>
                ),
              )}
            </div>
          </div>
        ) : (
          <LoadingState />
        )
      }
    </CloudPage>
  );
}

/**
 * An area's Startseite (the workspace's: its own area's) – at `/bereich/:id` with the area's
 * views as its title, on „Seiten“ under its tabs (`chrome`).
 */
export function AreaHome({
  areaId,
  chrome: given,
}: {
  areaId: string;
  chrome?: Pick<PlaceChrome, 'docTitle' | 'title' | 'barRow' | 'crumbs'>;
}) {
  const ui = useCloud();
  const { workspace } = ui;
  const areas = ui.home?.areas;
  const area = areas?.find((each) => each.id === areaId) ?? null;
  const list = useCloudList(workspace.id, { scope: 'folder', area: areaId }, Boolean(areaId));

  // Gone or not one's to see: its files' page says so.
  if (areas && !area) return <Navigate to={routes.cloudAreaFiles(workspace.id, areaId)} replace />;

  const people =
    area && area.members.length > 0 ? (
      <AvatarStack authors={area.members} max={4} size={28} interactive />
    ) : null;
  const chrome: PlaceChrome = given
    ? { ...given, aside: people }
    : area
      ? {
          docTitle: area.name,
          title: <AreaViews area={area} current="home" />,
          lead: <AreaMark area={area} size="lg" />,
          barRow: routes.cloudArea(workspace.id, area.id),
          crumbs: [
            ...areaTrail(workspace.id, areas ?? [], area).slice(0, -1),
            { label: area.name },
          ],
          aside: people,
        }
      : { docTitle: 'Bereich', title: ' ', crumbs: [] };
  return (
    <PlaceHome
      nodes={list.data?.nodes}
      onTaken={() => void list.refetch()}
      place={{ areaId, parentId: null }}
      newHome={{ areaId }}
      template={HOME_TEMPLATE}
      canWrite={cloudAccessAtLeast(list.data?.access ?? area?.access ?? null, 'edit')}
      chrome={chrome}
    />
  );
}
