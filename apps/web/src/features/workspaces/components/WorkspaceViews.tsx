import { Link } from 'react-router';
import { routes } from '@/lib/routes';
import { cn } from '@/ui';
import { startViewSwitch, useViewSwitchTop, VIEW_LINK_CLASS } from './viewSwitch';

const VIEWS = [
  // Written out in full so Tailwind finds the classes; the names are styled in index.css.
  {
    key: 'reviews',
    label: 'Präsentationen',
    to: routes.workspace,
    name: '[view-transition-name:workspace-view-reviews]',
  },
  {
    key: 'material',
    label: 'Bibliothek',
    to: routes.workspaceMaterial,
    name: '[view-transition-name:workspace-view-material]',
  },
] as const;

/** An area's second view in Cloud, its agents (`AreaViews`) – written out in full for Tailwind. */
const AGENTS_NAME = '[view-transition-name:workspace-view-agents]';
const TODOS_NAME = '[view-transition-name:workspace-view-todos]';
const AREAS_NAME = '[view-transition-name:workspace-view-areas]';

/** Cloud's two: its start and the same library, beside the files – its agents are in its side bar. */
const CLOUD_VIEWS = [
  { ...VIEWS[0], label: 'Zuletzt', to: routes.cloud },
  { ...VIEWS[1], to: (workspaceId: string) => routes.cloudLibrary(workspaceId) },
] as const;

/** Writer's two: its documents and the same library, beside them. */
const WRITER_VIEWS = [
  { ...VIEWS[0], label: 'Dokumente', to: routes.documents },
  { ...VIEWS[1], to: (workspaceId: string) => routes.writerLibrary(workspaceId) },
] as const;

export type WorkspaceView = (typeof VIEWS)[number]['key'];

/**
 * The page title of a workspace's views, „Präsentationen  Bibliothek“: the open one in
 * full size and colour, the others smaller and lighter, links to them. Switching morphs the two labels into
 * each other (view transition) while the page below crossfades. Meant as `PageHeader`'s title
 * with `titleRow`.
 */
export function WorkspaceViews({
  workspaceId,
  current,
  app = 'slider',
}: {
  workspaceId: string;
  current: WorkspaceView;
  /** Whose pages these are – Cloud's start is „Zuletzt“, Writer's „Dokumente“. */
  app?: 'slider' | 'cloud' | 'writer';
}) {
  return (
    <ViewTitles
      views={(app === 'cloud' ? CLOUD_VIEWS : app === 'writer' ? WRITER_VIEWS : VIEWS).map(
        (view) => ({
          ...view,
          to: view.to(workspaceId),
        }),
      )}
      current={current}
    />
  );
}

/** A view's name in the title, where it leads, and the name its label morphs under. */
export interface ViewTitle {
  key: string;
  label: string;
  to: string;
  name: string;
}
/**
 * The names the labels morph under (`styles/index.css`): the first view's, the second's (an
 * area's „Chat“ takes the library's), an area's files and to-dos, the agents', and the workspace's
 * areas.
 */
export const VIEW_NAMES = {
  first: VIEWS[0].name,
  second: VIEWS[1].name,
  agents: AGENTS_NAME,
  files: 'workspace-view-files',
  todos: TODOS_NAME,
  areas: AREAS_NAME,
} as const;

/**
 * Views as a page's title – the open one large, the others links beside it. A workspace's
 * (`WorkspaceViews`), and an area's in Cloud: its files and its agents.
 */
export function ViewTitles({ views, current }: { views: readonly ViewTitle[]; current: string }) {
  useViewSwitchTop(current);
  return (
    <span className="flex min-w-0 items-baseline gap-5">
      {views.map((view) =>
        view.key === current ? (
          <span key={view.key} aria-current="page" className={view.name}>
            {view.label}
          </span>
        ) : (
          <Link
            key={view.key}
            to={view.to}
            viewTransition
            onClick={startViewSwitch}
            className={cn(view.name, VIEW_LINK_CLASS)}
          >
            {view.label}
          </Link>
        ),
      )}
    </span>
  );
}
