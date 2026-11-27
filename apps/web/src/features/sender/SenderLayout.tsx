import { useEffect, useId, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { WorkspaceChat } from '@/features/cloud';
import { useMailThreads } from '@/lib/api';
import { useWorkspace } from '@/features/workspaces';
import { IconButton, SidePanel, SidePanelHeader, Toast, useMediaQuery } from '@/ui';
import { SenderMenuContext } from './components/MenuButton';
import { NewConversation } from './components/NewConversation';
import { SenderSidebar } from './components/SenderSidebar';
import { allChannels, SenderProvider, useSenderOrNull } from './hooks/useSender';
import { isNewKind } from './lib/new';

/** The tab says how much is unread, as long as Sender is open. */
function useUnreadTitle(count: number) {
  useEffect(() => {
    const before = document.title;
    return () => {
      document.title = before;
    };
  }, []);
  useEffect(() => {
    document.title = count > 0 ? `(${count}) Sender` : 'Sender';
  }, [count]);
}

/** What Sender's desktop app's menu says (`desktop/sender/main.mjs`): „Neue Gruppe …“ and the like. */
const DESKTOP_EVENT = 'sender:desktop';

/** The app's menu opens what „Neu“ opens – a new channel in the area of the one open. */
function useDesktopMenu() {
  const ui = useSenderOrNull();
  const navigate = useNavigate();
  const location = useLocation();
  const latest = useRef({ ui, location, navigate });
  useEffect(() => {
    latest.current = { ui, location, navigate };
  });
  useEffect(() => {
    const onAction = (event: Event) => {
      const kind = (event as CustomEvent<unknown>).detail;
      const { ui: now, navigate: go } = latest.current;
      if (!now || typeof kind !== 'string' || !isNewKind(kind)) return;
      void go(now.newPath(kind));
    };
    window.addEventListener(DESKTOP_EVENT, onAction);
    return () => window.removeEventListener(DESKTOP_EVENT, onAction);
  }, []);
}

/**
 * Sender – the workspace's conversations, below the app's header: the side bar with the areas'
 * channels, the groups, the direct ones and the agents, and the conversation beside it. What
 * „Neu“ opens stands in the page in its place.
 */
export function Component() {
  const workspace = useWorkspace();
  return (
    <SenderProvider workspace={workspace}>
      <Layout />
    </SenderProvider>
  );
}

function Layout() {
  const ui = useSenderOrNull();
  const location = useLocation();
  const [params] = useSearchParams();
  const asked = params.get('neu');
  const [menu, setMenu] = useState<string | null>(null);
  const narrow = useMediaQuery('(max-width: 1023px)');
  const open = narrow && menu === location.pathname + location.search;
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  useDesktopMenu();
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus({ preventScroll: true });
    const leave = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('keydown', leave);
    return () => window.removeEventListener('keydown', leave);
  }, [open]);
  return (
    // The side bar stands on the plain canvas, the dots behind the conversation only.
    <div className="relative flex min-h-0 flex-1 items-start bg-canvas">
      {ui && <Unread workspaceId={ui.workspace.id} count={unreadOf(ui.home)} />}
      {ui &&
        (narrow ? (
          open && (
            <SidePanel ref={panelRef} side="left" aria-labelledby={titleId}>
              <SidePanelHeader gap="sm">
                <div className="flex items-center gap-2">
                  <h2
                    id={titleId}
                    className="min-w-0 flex-1 truncate text-base font-semibold text-fg"
                  >
                    Unterhaltungen
                  </h2>
                  <IconButton
                    icon="close"
                    label="Schließen (Esc)"
                    size="sm"
                    onClick={() => setMenu(null)}
                  />
                </div>
              </SidePanelHeader>
              <div className="flex min-h-0 flex-1 flex-col p-4">
                <SenderSidebar className="min-h-full w-full" />
              </div>
            </SidePanel>
          )
        ) : (
          <div className="sticky top-0 flex h-[calc(100dvh-88px)] shrink-0 py-4 pl-6">
            <SenderSidebar className="h-full" />
          </div>
        ))}
      {/* The AI's panel stands beside the page, not over it – as in Cloud (`CloudLayout`); a page's
          own column (`data-page-aside`, the mail's) is lain over instead. */}
      <div className="dot-grid flex h-[calc(100dvh-88px)] min-w-0 flex-1 flex-col px-4 [--dot-fade-l:120px] pt-4 pb-4 md:[body:has([data-cloud-panel]):not(:has([data-page-aside]))_&]:mr-[400px] lg:pr-6 lg:pl-9">
        <SenderMenuContext.Provider
          value={
            narrow
              ? {
                  open,
                  toggle: () => setMenu(open ? null : location.pathname + location.search),
                }
              : null
          }
        >
          {ui && (isNewKind(asked) ? <NewConversation kind={asked} /> : <Outlet />)}
        </SenderMenuContext.Provider>
      </div>
      {/* ✨ in the header: the workspace's AI, as in Cloud – the same chat. */}
      {ui && <WorkspaceChat workspace={ui.workspace} notify={ui.notify} />}
      {ui && <Toast toast={ui.toast} />}
    </div>
  );
}

const unreadOf = (home: Parameters<typeof allChannels>[0]) =>
  allChannels(home).reduce((sum, channel) => sum + channel.unread, 0) +
  (home?.agents.reduce((sum, agent) => sum + agent.unread, 0) ?? 0);

/** The chats' and the mails' (spam aside). */
function Unread({ workspaceId, count }: { workspaceId: string; count: number }) {
  const threads = useMailThreads(workspaceId).data ?? [];
  useUnreadTitle(count + threads.reduce((sum, each) => sum + (each.spam ? 0 : each.unread), 0));
  return null;
}
