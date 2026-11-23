import { useEffect, useId, useRef, useState } from 'react';
import { Outlet, useLocation, useSearchParams } from 'react-router';
import { routes } from '@/lib/routes';
import {
  isNewKind,
  NewConversation,
  SenderMenuContext,
  SenderProvider,
  SenderToast,
  useSenderOrNull,
  type ChannelPlace,
} from '@/features/sender';
import { useWorkspace } from '@/features/workspaces';
import { IconButton, SidePanel, SidePanelHeader, useMediaQuery } from '@/ui';
import { CloudChat } from './components/CloudChat';
import { BarFolded } from './lib/crumb-search';
import { CloudSidebar } from './components/CloudSidebar';
import { Preview } from './components/Preview';
import { TodoPanel } from './components/todos/TodoList';
import { EventPanel } from './components/calendar/EventPanel';
import { CallPanel } from './components/CallPanel';
import { SearchPalette } from './components/SearchPalette';
import { useBarSearch } from './hooks/useBarSearch';
import { SearchResults } from './SearchResults';
import { CloudProvider } from './hooks/useCloud';
import { useStoredChoice } from './hooks/useStoredChoice';
import { SIDEBAR_KEY, SIDEBAR_STATES } from './lib/kinds';

/**
 * Cloud – the workspace's files, below the app's header: the side bar with the places, the
 * page beside it, and over both whatever is open – a file, the search, a dialog, the uploads.
 */
export function Component() {
  const workspace = useWorkspace();
  const location = useLocation();
  // On narrow screens the side bar slides in over the page; a place picked closes it.
  const [menu, setMenu] = useState<string | null>(null);
  // Below lg there is no room beside the page: the places come as a panel from the left.
  const narrow = useMediaQuery('(max-width: 1023px)');
  const open = narrow && menu === location.pathname;
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus({ preventScroll: true });
    const leave = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('keydown', leave);
    return () => window.removeEventListener('keydown', leave);
  }, [open]);
  // Beside the page it folds in to its icons; how it opens is one's own setting (`/einstellungen`).
  const [sidebar, setSidebar] = useStoredChoice(SIDEBAR_KEY, SIDEBAR_STATES, 'open');
  // Sender lives in Cloud: an area's channels are its „Chat“, people and groups under the areas.
  const chatPath = (channel: ChannelPlace) =>
    channel.areaId
      ? routes.cloudAreaChat(
          workspace.id,
          channel.areaId,
          channel.kind === 'area' ? undefined : channel.id,
        )
      : routes.cloudChat(workspace.id, channel.id);
  return (
    <SenderProvider
      workspace={workspace}
      pathOf={chatPath}
      agentPath={(agentId) => routes.cloudAgent(workspace.id, agentId)}
      homePath={routes.cloud(workspace.id)}
      draftsPath={routes.cloudDrafts(workspace.id)}
      mailPath={routes.cloudMail(workspace.id)}
      mailThreadPath={(threadId) => routes.cloudMailThread(workspace.id, threadId)}
      mailAccountsPath={routes.cloudMailAccounts(workspace.id)}
      newMailboxPath={routes.cloudNewMailbox(workspace.id)}
      newBase={routes.cloud(workspace.id)}
    >
      <CloudProvider workspace={workspace}>
        <div className="relative flex min-h-0 flex-1 items-start">
          {narrow ? (
            open && (
              // The panel of the file's details (`SidePanel`), at the left.
              <SidePanel ref={panelRef} side="left" aria-labelledby={titleId}>
                <SidePanelHeader gap="sm">
                  <div className="flex items-center gap-2">
                    <h2
                      id={titleId}
                      className="min-w-0 flex-1 truncate text-base font-semibold text-fg"
                    >
                      Orte
                    </h2>
                    <IconButton
                      icon="close"
                      label="Schließen (Esc)"
                      size="sm"
                      onClick={() => setMenu(null)}
                    />
                  </div>
                </SidePanelHeader>
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                  <CloudSidebar className="min-h-full w-full" onFold={() => {}} />
                </div>
              </SidePanel>
            )
          ) : (
            // Over the header's box: the fold button stands in the gap that box reaches into.
            // `data-cloud-sidebar`: out of the page's crossfade when a view switches (index.css).
            <div
              data-cloud-sidebar
              className="sticky top-0 z-(--z-overlay) flex h-[calc(100dvh-88px)] shrink-0 py-4 pl-6"
            >
              <CloudSidebar
                className="h-full"
                folded={sidebar === 'icons'}
                onFold={(folded) => setSidebar(folded ? 'icons' : 'open')}
              />
            </div>
          )}
          {/* The details' and the chat's panel (`data-cloud-panel`) stand beside the page, not
              over it – as over Slider's presentations and the header's right end. A page's own
              column beside its content (`data-page-aside`: the calendar's, „KI zur Mail“) is lain
              over instead: only the content gives way, as far as the panel reaches past it. */}
          <div className="min-w-0 flex-1 px-4 pt-4 transition-[margin] duration-300 ease-out md:[body:has([data-cloud-panel]):not(:has([data-page-aside]))_&]:mr-[400px] lg:pr-6 lg:pl-9">
            <BarFolded value={!narrow && sidebar === 'icons'}>
              {/* Below lg the places' button stands at the start of the page's head, as in
                  Sender (`MenuButton`): nothing floats over the page or its composer. */}
              <SenderMenuContext.Provider
                value={
                  narrow
                    ? {
                        open,
                        toggle: () => setMenu(open ? null : location.pathname),
                        label: 'Orte zeigen',
                      }
                    : null
                }
              >
                <Page />
              </SenderMenuContext.Provider>
            </BarFolded>
          </div>
        </div>
        <CloudChat />
        <Preview />
        <TodoPanel />
        <EventPanel />
        <CallPanel />
        <SearchPalette />
        <SenderToast />
      </CloudProvider>
    </SenderProvider>
  );
}

/**
 * The page – or, while „Neu“ asks for one (`?neu=`), the form for a conversation in its place;
 * while the side bar searches (`?suche=`), what it finds in detail.
 */
function Page() {
  const [params] = useSearchParams();
  const asked = params.get('neu');
  const sender = useSenderOrNull();
  const { searching } = useBarSearch();
  if (searching) return <SearchResults />;
  if (sender && isNewKind(asked)) {
    return (
      <div className="flex h-[calc(100dvh-104px)] flex-col">
        <NewConversation kind={asked} inCloud />
      </div>
    );
  }
  return <Outlet />;
}
