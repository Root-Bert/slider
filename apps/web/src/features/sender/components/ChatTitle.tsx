import { Link, useLocation } from 'react-router';
import {
  startViewSwitch,
  useViewSwitchTop,
  VIEW_LINK_CLASS,
  VIEW_NAMES,
} from '@/features/workspaces';
import { cn } from '@/ui';
import { PAGE_TITLE } from '../lib/title';

/** A chat's views; `areas` only beside the workspace's own chat, a page of its own. */
export type ChatView = 'chat' | 'files' | 'areas';

/** The address's mark for a chat's „Dateien“ (`?ansicht=dateien`); without it, the chat. */
const VIEW_PARAM = 'ansicht';

/**
 * Which of a chat's two views is open – the chat or its „Dateien“ – and the address of each.
 * In the address, so back goes back and a reload stays. `enabled: false`: always the chat.
 */
export function useChatView(enabled = true) {
  const { pathname, search } = useLocation();
  const view: ChatView =
    enabled && new URLSearchParams(search).get(VIEW_PARAM) === 'dateien' ? 'files' : 'chat';
  const href = (to: Exclude<ChatView, 'areas'>) => {
    const next = new URLSearchParams(search);
    if (to === 'files') next.set(VIEW_PARAM, 'dateien');
    else next.delete(VIEW_PARAM);
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  };
  return { view, href };
}

/** A chat's view by its address, from a page that is not the chat (its „Bereiche“). */
export const chatViewPath = (path: string, to: Exclude<ChatView, 'areas'>) =>
  to === 'files' ? `${path}?${VIEW_PARAM}=dateien` : path;

/**
 * A chat's title, as an area's (`AreaViews`): its name is the chat, „Dateien“ beside it – the
 * open one large, the other smaller and lighter, a link to it; switching morphs the two. The same
 * for a group, a person and an agent, in Sender and in Cloud (the user, 2026-11-23: „der name
 * selbst ist chat. und dann steht da rechts noch dateien“). A long name shortens, „Dateien“
 * stays whole. The words alone – inside a page's own heading (Cloud's `CloudPage`). The
 * workspace's own chat has „Bereiche“ last (`areas`, where that page is), as its area has in
 * Cloud – its people, to find whom to write to (the user, 2026-11-24).
 */
export function ChatViews({
  name,
  view,
  href,
  areas,
}: {
  name: string;
  view: ChatView;
  href: (to: Exclude<ChatView, 'areas'>) => string;
  areas?: string;
}) {
  useViewSwitchTop(view);
  const views: { key: ChatView; label: string; morph: string; grow: boolean; to: string }[] = [
    { key: 'chat', label: name, morph: VIEW_NAMES.first, grow: true, to: href('chat') },
    { key: 'files', label: 'Dateien', morph: VIEW_NAMES.second, grow: false, to: href('files') },
    ...(areas
      ? [{ key: 'areas' as const, label: 'Bereiche', morph: VIEW_NAMES.areas, grow: false, to: areas }]
      : []),
  ];
  return (
    <span className="flex min-w-0 items-baseline gap-5 max-sm:gap-3">
      {views.map((each) =>
        each.key === view ? (
          <span
            key={each.key}
            aria-current="page"
            className={cn(each.morph, each.grow ? 'min-w-0 truncate' : 'shrink-0')}
          >
            {each.label}
          </span>
        ) : (
          <Link
            key={each.key}
            to={each.to}
            viewTransition
            onClick={startViewSwitch}
            className={cn(
              each.morph,
              VIEW_LINK_CLASS,
              each.grow ? 'min-w-0 truncate' : 'shrink-0',
              'focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none',
            )}
          >
            {each.label}
          </Link>
        ),
      )}
    </span>
  );
}

/** `ChatViews` as a Sender page's heading. */
export function ChatTitle({
  className,
  ...views
}: {
  name: string;
  view: ChatView;
  href: (to: Exclude<ChatView, 'areas'>) => string;
  areas?: string;
  className?: string;
}) {
  return (
    <h1 className={cn(PAGE_TITLE, 'flex min-w-0', className)}>
      <ChatViews {...views} />
    </h1>
  );
}
