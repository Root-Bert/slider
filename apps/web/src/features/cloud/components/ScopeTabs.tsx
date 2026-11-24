import type { CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { startViewSwitch, useViewSwitchTop, VIEW_LINK_CLASS } from '@/features/workspaces';
import { cn } from '@/ui';
import { DEFAULT_SCOPE, SCOPE_PARAM, type ScopeTab } from '../lib/scopes';

/**
 * Tabs as the page's title, as the mailboxes on „Post“ (`MailboxTabs`): the open one large, the
 * others smaller links beside it; switching morphs the names into each other. Too many for a
 * phone: the row scrolls.
 */
export function ScopeTabs({ tabs, current }: { tabs: readonly ScopeTab[]; current: string }) {
  useViewSwitchTop(current);
  // What else the address says (a filter on, a to-do open) stays through a switch.
  const [params] = useSearchParams();
  const searchFor = (key: string) => {
    const next = new URLSearchParams(params);
    if (key === DEFAULT_SCOPE) next.delete(SCOPE_PARAM);
    else next.set(SCOPE_PARAM, key);
    const text = next.toString().replace(/=(?=&|$)/g, '');
    return text ? `?${text}` : '';
  };
  return (
    // On a phone the row fades out at its end: there is more to scroll to.
    <span className="-m-1 flex min-w-0 items-baseline gap-5 overflow-x-auto p-1 [scrollbar-width:none] max-sm:pr-8 max-sm:mask-r-from-80%">
      {tabs.map((tab, at) => {
        // Each its own name to morph under, by its place (the order stays).
        const name = { viewTransitionName: `scope-title-${at}` } satisfies CSSProperties;
        const title = tab.hint ? `${tab.label} | ${tab.hint}` : undefined;
        return tab.key === current ? (
          <span
            key={tab.key}
            aria-current="page"
            title={title}
            style={name}
            className="shrink-0 [view-transition-class:view-title]"
          >
            {tab.label}
          </span>
        ) : (
          <Link
            key={tab.key}
            to={{ search: searchFor(tab.key) }}
            viewTransition
            onClick={startViewSwitch}
            title={title}
            style={name}
            className={cn(
              VIEW_LINK_CLASS,
              'shrink-0 rounded-control-sm outline-none [view-transition-class:view-title] focus-visible:ring-2 focus-visible:ring-focus',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </span>
  );
}
