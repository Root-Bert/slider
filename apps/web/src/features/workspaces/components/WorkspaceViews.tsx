import { Link } from 'react-router';
import { routes } from '@/lib/routes';
import { cn } from '@/ui';

const VIEWS = [
  // Written out in full so Tailwind finds the classes; the names are styled in index.css.
  {
    key: 'reviews',
    label: 'Reviews',
    to: routes.workspace,
    name: '[view-transition-name:workspace-view-reviews]',
  },
  {
    key: 'material',
    label: 'Workspace',
    to: routes.workspaceMaterial,
    name: '[view-transition-name:workspace-view-material]',
  },
] as const;

export type WorkspaceView = (typeof VIEWS)[number]['key'];

/** Longer than the switch's view transition (see `styles/index.css`), so it isn't cut short. */
const SWITCH_MS = 600;

/**
 * The page title of a workspace's views, "Reviews  Workspace": the open one in full size and
 * colour, the other smaller and lighter, a link to it. Switching morphs the two labels into
 * each other (view transition) while the page below crossfades. Meant as `PageHeader`'s title
 * with `titleRow`.
 */
export function WorkspaceViews({
  workspaceId,
  current,
}: {
  workspaceId: string;
  current: WorkspaceView;
}) {
  return (
    <span className="flex min-w-0 items-baseline gap-5">
      {VIEWS.map((view) =>
        view.key === current ? (
          <span key={view.key} aria-current="page" className={view.name}>
            {view.label}
          </span>
        ) : (
          <Link
            key={view.key}
            to={view.to(workspaceId)}
            viewTransition
            onClick={() => {
              // Picks the light switch transition instead of the import stage's (index.css).
              const root = document.documentElement;
              root.dataset.transition = 'workspace-view';
              setTimeout(() => delete root.dataset.transition, SWITCH_MS);
            }}
            className={cn(
              view.name,
              'text-xl font-medium text-fg-subtle transition-colors duration-200 hover:text-fg',
            )}
          >
            {view.label}
          </Link>
        ),
      )}
    </span>
  );
}
