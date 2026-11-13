import { useLayoutEffect } from 'react';
import { Link } from 'react-router';
import { routes } from '@/lib/routes';
import { cn } from '@/ui';

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

export type WorkspaceView = (typeof VIEWS)[number]['key'];

/** Longer than the switch's view transition (see `styles/index.css`), so it isn't cut short. */
const SWITCH_MS = 600;

/** Set by a click on the other view, taken by the view that mounts next. */
let switching = false;
/** Clears `data-transition` after the last switch – one timer, so a quick second switch keeps it. */
let transitionReset: ReturnType<typeof setTimeout> | undefined;

/**
 * The page title of a workspace's views, "Projekte  Bibliothek": the open one in full size and
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
  // The other view starts at the top. Without this it kept the scroll offset (a trackpad nudge
  // of 1px is enough): on a view too short to scroll, Safari only clamps it to 0 a moment after
  // the switch, and the whole page dropped by that much. Before paint – and inside the view
  // transition's update, so its new snapshot already shows the page at the top.
  useLayoutEffect(() => {
    if (!switching) return;
    switching = false;
    window.scrollTo(0, 0);
  }, []);
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
              switching = true;
              // Picks the light switch transition instead of the import stage's (index.css).
              const root = document.documentElement;
              root.dataset.transition = 'workspace-view';
              // An earlier click's timer would clear it in the middle of this switch: the page
              // then fell back to the import stage's blur and the header to the crossfade.
              clearTimeout(transitionReset);
              transitionReset = setTimeout(() => delete root.dataset.transition, SWITCH_MS);
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
