import type { ReactNode } from 'react';
import { searchFold, type CloudNode, type CloudScope } from '@slider/shared';
import { useCloudList } from '@/lib/api';
import type { IconName } from '@/ui';
import { useCloud } from '../hooks/useCloud';
import { useStoredChoice } from '../hooks/useStoredChoice';
import { CLOUD_VIEWS, type CloudView } from '../lib/kinds';
import { CloudPage } from './CloudPage';
import { Empty, LoadFailed } from './Empty';
import { FileBrowser, FileBrowserSkeleton, type BrowserMode } from './FileBrowser';
import { ListToolbar } from './ListToolbar';

/** A list across folders – „Geteilt“, „Gelöscht“: where each thing lies beside it. */
export function AcrossPage({
  scope,
  title,
  subtitle,
  mode = 'across',
  empty,
  actions,
  lead,
  above,
  filled = false,
  query = '',
}: {
  scope: CloudScope;
  title: string;
  subtitle?: string;
  mode?: BrowserMode;
  empty: { icon: IconName; title: string; message: string };
  actions?: (nodes: readonly CloudNode[]) => ReactNode;
  /** First in the toolbar, e.g. the tabs of „Geteilt“. */
  lead?: ReactNode;
  /** Between toolbar and list. */
  above?: (nodes: readonly CloudNode[], view: CloudView) => ReactNode;
  /** Something else fills the page (`above`): no „nothing here“ under it. */
  filled?: boolean;
  /** What the page's search field says: only the names with it in them. */
  query?: string;
}) {
  const ui = useCloud();
  const listing = useCloudList(ui.workspace.id, { scope });
  const [view, setView] = useStoredChoice('slider.cloud.view', CLOUD_VIEWS, 'list');
  const all = listing.data?.nodes ?? [];
  const needle = searchFold(query.trim());
  const nodes = needle ? all.filter((node) => searchFold(node.name).includes(needle)) : all;
  return (
    <CloudPage
      docTitle={title}
      title={title}
      // A page of the workspace's, as Entwürfe and Mail: its name over it.
      crumbs={[{ label: ui.workspace.name }, { label: title }]}
      subtitle={subtitle}
      nodes={nodes}
      actions={actions?.(all)}
      toolbar={<ListToolbar lead={lead} view={view} onViewChange={setView} />}
    >
      {(selection) => (
        <>
          {above?.(nodes, view)}
          {listing.isPending ? (
            <FileBrowserSkeleton view={view} />
          ) : listing.isLoadingError ? (
            <LoadFailed message={listing.error.message} onRetry={() => void listing.refetch()} />
          ) : nodes.length === 0 ? (
            !filled &&
            (needle ? (
              <Empty
                icon="search"
                title={`Keine Treffer für „${query.trim()}“`}
                message="Gesucht wird in den Namen."
              />
            ) : (
              <Empty {...empty} />
            ))
          ) : (
            <FileBrowser nodes={nodes} mode={mode} view={view} selection={selection} />
          )}
        </>
      )}
    </CloudPage>
  );
}
