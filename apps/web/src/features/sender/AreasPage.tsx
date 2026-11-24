import { useState } from 'react';
import { Empty, PeopleGraph, peopleFound } from '@/features/cloud';
import { ViewSearch, WorkspaceMark } from '@/features/workspaces';
import { useCloudHome } from '@/lib/api';
import { pluralize } from '@/lib/format';
import { ChatTitle, chatViewPath } from './components/ChatTitle';
import { MenuButton } from './components/MenuButton';
import { useSender } from './hooks/useSender';
import { PAGE_HEADER, PAGE_TITLE } from './lib/title';

/**
 * Sender's „Bereiche“: the last tab of the workspace's own chat, as of its area in Cloud – every
 * area's people as Cloud's net, to find whom to write to (the user, 2026-11-24: „um alle leute
 * zu finden denen ich schreiben wollen könnte“). A click on someone opens the chat with them; a
 * picked area's name leads to its channel. A name typed beside the title lights them up.
 */
export function Component() {
  const ui = useSender();
  const cloud = useCloudHome(ui.workspace.id).data;
  const own = ui.home?.areas.find((area) => area.root)?.channels[0];
  // The workspace's own area is the net's middle, not one of its areas.
  const areas = (cloud?.areas ?? []).filter((area) => !area.root);
  const channelOf = (areaId: string) =>
    ui.home?.areas.find((area) => area.id === areaId)?.channels[0];
  const [query, setQuery] = useState('');
  const found = peopleFound(areas, query);
  return (
    <section aria-label="Bereiche" className="flex min-h-0 flex-1 flex-col gap-3">
      <header className={PAGE_HEADER}>
        <MenuButton />
        <WorkspaceMark name={ui.workspace.name} logoUrl={ui.workspace.logoUrl} size={32} />
        <div className="flex min-w-0 flex-1 flex-col">
          {own ? (
            <ChatTitle
              name={own.name}
              view="areas"
              href={(to) => chatViewPath(ui.pathOf(own), to)}
              areas={ui.areasPath}
            />
          ) : (
            <h1 className={PAGE_TITLE}>Bereiche</h1>
          )}
        </div>
        {query.trim() !== '' && (
          <span className="shrink-0 text-xs text-fg-muted" role="status">
            {found === 0 ? 'Niemand gefunden' : pluralize(found, 'Person', 'Personen')}
          </span>
        )}
        <ViewSearch
          label="Person suchen"
          value={query}
          onChange={setQuery}
          className="w-64 max-sm:order-last max-sm:w-full"
        />
      </header>
      <div className="flex min-h-0 flex-1 flex-col pt-2 pb-2">
        {!cloud ? (
          <div aria-hidden className="skeleton min-h-[320px] flex-1 rounded-panel" />
        ) : areas.length === 0 ? (
          <Empty
            icon="workspaces"
            title="Noch kein Bereich"
            message="Ein Bereich ist der Ort eines Teams: mit Farbe, Leuten und allem, woran es arbeitet."
          />
        ) : (
          <PeopleGraph
            areas={areas}
            query={query}
            workspace={ui.workspace}
            userId={ui.me.id}
            areaTo={(area) => {
              const channel = channelOf(area.id);
              return channel ? ui.pathOf(channel) : ui.areasPath;
            }}
          />
        )}
      </div>
    </section>
  );
}
