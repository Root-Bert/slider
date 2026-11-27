import type { CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { mailboxLabels, type Calendar } from '@slider/shared';
import { startViewSwitch, useViewSwitchTop, VIEW_LINK_CLASS } from '@/features/workspaces';
import { cn } from '@/ui';
import { useCloud } from '../../hooks/useCloud';
import { useCalendarAccounts } from './CalendarAccounts';
import { CALENDAR_SOURCE_PARAM, WORKSPACE_SOURCE } from './sources';

/**
 * The calendar's sources as the page's title, as Post's mailboxes: „Alle“ first, the workspace's
 * own calendars by its name, then each account with calendars by its mailbox's name
 * (`mailboxLabels`) – the open one large, the others smaller links; switching morphs the names
 * into each other and the page crossfades, as there. Only one source: „Kalender“.
 * Day, view and the open event stay as they are; too many for a phone: the row scrolls.
 */
export function CalendarSourceTabs({
  calendars,
  source,
}: {
  calendars: readonly Calendar[] | undefined;
  source: string | null;
}) {
  const ui = useCloud();
  const [params] = useSearchParams();
  useViewSwitchTop(source ?? '');
  const accounts = (useCalendarAccounts(ui.workspace.id, calendars) ?? []).filter(
    (account) => account.calendars.length > 0,
  );
  if (accounts.length === 0) return <>Kalender</>;
  const labels = mailboxLabels(accounts);
  const tabs = [
    { id: null, label: 'Alle', title: 'Alle Kalender' },
    { id: WORKSPACE_SOURCE, label: ui.workspace.name, title: `Kalender von ${ui.workspace.name}` },
    ...accounts.map((account) => ({
      id: account.id,
      label: labels.get(account.id) ?? account.address,
      title: account.address,
    })),
  ];
  const hrefOf = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set(CALENDAR_SOURCE_PARAM, id);
    else next.delete(CALENDAR_SOURCE_PARAM);
    const query = next.toString();
    return query ? `?${query}` : '?';
  };
  return (
    // On a phone the row fades out at its end: there is more to scroll to.
    <span className="-m-1 flex min-w-0 items-baseline gap-5 overflow-x-auto p-1 [scrollbar-width:none] max-sm:pr-8 max-sm:mask-r-from-80%">
      {tabs.map((tab, at) => {
        // Each its own name to morph under, by its place (the order stays).
        const name = { viewTransitionName: `calendar-title-${at}` } satisfies CSSProperties;
        return tab.id === source ? (
          <span
            key={tab.id ?? ''}
            aria-current="page"
            title={tab.title}
            style={name}
            className="shrink-0 [view-transition-class:view-title]"
          >
            {tab.label}
          </span>
        ) : (
          <Link
            key={tab.id ?? ''}
            to={hrefOf(tab.id)}
            replace
            viewTransition
            onClick={startViewSwitch}
            title={tab.title}
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
