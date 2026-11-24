import { Link } from 'react-router';
import { Icon } from '@/ui';

export interface PageCrumb {
  label: string;
  /** Where it leads; none for the page itself (the last). */
  to?: string;
}

/**
 * Where a Sender page lies („Post › Postfächer“), as Cloud's pages show their path: in the gap
 * under the app's header, so the title stays where it is on every page. Its header is
 * `relative`.
 */
export function PageCrumbs({ crumbs }: { crumbs: PageCrumb[] }) {
  return (
    <nav
      aria-label="Pfad"
      className="absolute inset-x-0 -top-8 flex h-6 min-w-0 items-center gap-1 text-body"
    >
      {crumbs.map((crumb, index) => (
        <span key={index} className="flex min-w-0 items-center gap-1">
          {index > 0 && <Icon name="chevronRight" size={14} className="shrink-0 text-fg-faint" />}
          {crumb.to ? (
            <Link
              to={crumb.to}
              className="-mx-1 truncate rounded-control-sm px-1 text-fg-subtle transition-colors hover:text-fg"
            >
              {crumb.label}
            </Link>
          ) : (
            <span className="truncate text-fg">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
