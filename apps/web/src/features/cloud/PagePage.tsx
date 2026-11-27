import { useParams, useSearchParams } from 'react-router';
import { useCloudNode } from '@/lib/api';
import { routes } from '@/lib/routes';
import type { Crumb } from './components/CloudPage';
import { PageScreen } from './components/PageScreen';
import { OWN_FILES, useCloud } from './hooks/useCloud';
import { areaTrail } from './lib/areas';
import { NEW_PAGE_PARAM, NOTES_FOLDER } from './lib/pages';

/**
 * `/dateien/seite/:pageId` – a page (a Markdown file) wherever it lies: its path from the area or
 * „Meine Dateien“ through its folders, the side bar's row of where it lies lit („Seiten“ for
 * one's own pages).
 */
export function Component() {
  const { pageId = '' } = useParams();
  const [params] = useSearchParams();
  const ui = useCloud();
  const { workspace } = ui;
  const areas = ui.home?.areas ?? [];
  const detail = useCloudNode(workspace.id, pageId);
  const node = detail.data?.node;
  const area = detail.data?.area ?? null;
  // The folders it lies in, from the top; the page itself is not one of them.
  const folders = (detail.data?.path ?? []).filter((each) => each.id !== pageId);
  // One's own pages: in „Notizen“ (or a folder in it) – „Seiten“ leads back, not „Meine Dateien“.
  const inNotes = !area && folders[0]?.name === NOTES_FOLDER;

  const crumbs = (title: string): Crumb[] => {
    const out: Crumb[] = [];
    if (area) out.push(...areaTrail(workspace.id, areas, area));
    else if (inNotes) out.push({ label: 'Seiten', to: routes.cloudPages(workspace.id) });
    else if (node) {
      out.push({ label: 'Meine Dateien', to: routes.cloudOwn(workspace.id), into: OWN_FILES });
    }
    for (const each of inNotes ? folders.slice(1) : folders) {
      out.push({ label: each.name, to: routes.cloudFolder(workspace.id, each.id) });
    }
    out.push({ label: title });
    return out;
  };

  return (
    <PageScreen
      key={pageId}
      pageId={pageId}
      place={{
        workspaceId: workspace.id,
        areaId: node?.areaId ?? null,
        parentId: node?.parentId ?? null,
      }}
      crumbs={node ? crumbs : undefined}
      barRow={
        area
          ? routes.cloudArea(workspace.id, area.id)
          : inNotes
            ? routes.cloudPages(workspace.id)
            : node
              ? routes.cloudFiles(workspace.id)
              : undefined
      }
      editing={params.has(NEW_PAGE_PARAM)}
    />
  );
}
