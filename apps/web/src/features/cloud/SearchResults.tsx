import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { AccountAuthor, SenderAgent, SenderChannel } from '@slider/shared';
import { useCloudSearch, useMembers, useOpenSenderDirect } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import { searchConversations, useSenderOrNull } from '@/features/sender';
import { Avatar, cn, Icon, Select, useDebounced } from '@/ui';
import { AgentAvatar } from './components/AgentAvatar';
import { AreaMark } from './components/AreaMark';
import { CloudPage } from './components/CloudPage';
import { FileBrowser, FileBrowserSkeleton } from './components/FileBrowser';
import { useBarSearch, type SearchPlace } from './hooks/useBarSearch';
import { useCloud } from './hooks/useCloud';

const rowClass =
  'flex h-14 w-full items-center gap-3 rounded-control px-3 text-left transition-colors hover:bg-hover focus-visible:-outline-offset-2';

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="flex items-baseline gap-2 text-base font-semibold text-fg">
        {title}
        {count !== undefined && (
          <span className="text-body font-normal text-fg-subtle tabular-nums">{count}</span>
        )}
      </h2>
      {children}
    </section>
  );
}

function Lines({ title, note }: { title: string; note?: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-body font-medium text-fg">{title}</span>
      {note && <span className="truncate text-xs text-fg-subtle">{note}</span>}
    </span>
  );
}

/**
 * What the side bar's search finds, in detail, in the page's place while one searches: the
 * files as a list (picked, opened, moved as anywhere) – what is called so, then what says so –,
 * the areas, the chats and people. „Ort“ and „Von“ narrow the files; the bar shows names only,
 * short. What was searched for stands where the path stands; going to a hit ends the search.
 */
export function SearchResults() {
  const ui = useCloud();
  const sender = useSenderOrNull();
  const navigate = useNavigate();
  const { query, setQuery, place, setPlace, owner, setOwner } = useBarSearch();
  const narrowed = place !== '' || owner !== '';
  const settled = useDebounced(query, 150);
  const search = useCloudSearch(ui.workspace.id, settled.trim(), {
    in: 'all',
    area: place || undefined,
    owner: owner || undefined,
  });
  const members = useMembers(ui.workspace.id);
  const places: { value: SearchPlace; label: string }[] = [
    { value: '', label: 'Alle Orte' },
    ...(ui.home?.ownFiles !== false ? [{ value: 'own', label: 'Meine Dateien' }] : []),
    { value: 'shared', label: 'Mit mir geteilt' },
    ...(ui.home?.areas ?? []).map((area) => ({ value: area.id, label: area.name })),
  ];
  const owners = [
    { value: '', label: 'Von allen' },
    { value: ui.userId, label: 'Von mir' },
    ...(members.data ?? [])
      .filter((member) => member.userId !== ui.userId)
      .map((member) => ({ value: member.userId, label: member.name })),
  ];
  const open = useOpenSenderDirect(ui.workspace.id);
  const [starting, setStarting] = useState<string | null>(null);
  const words = query.trim().toLocaleLowerCase('de');
  const nodes = search.data?.nodes ?? [];
  // „Ort“ and „Von“ narrow the files: the areas, chats and people stand only while nothing does.
  const areas = narrowed
    ? []
    : (ui.home?.areas ?? []).filter((area) => area.name.toLocaleLowerCase('de').includes(words));
  // An area's own chat is the area's: found as the area, it stands there once.
  const shown = new Set(areas.map((area) => area.id));
  const chats = (
    !narrowed && sender ? searchConversations(sender.home, sender.me.id, query) : []
  ).filter((chat) => !('kind' in chat && chat.kind === 'area' && shown.has(chat.areaId ?? '')));
  const settling = settled !== query || search.isFetching;
  const go = (to: string) => {
    setQuery('');
    void navigate(to);
  };
  const start = (person: AccountAuthor) => {
    if (!sender || starting) return;
    setStarting(person.id);
    open.mutate(person.id, {
      onSuccess: (channel) => go(sender.pathOf(channel)),
      onError: (error) => sender.notify(error.message, 'danger'),
      onSettled: () => setStarting(null),
    });
  };
  const areaOf = (id: string | null) => sender?.home?.areas.find((area) => area.id === id);
  const noteOf = (chat: SenderChannel | SenderAgent) => {
    const when = formatRelativeTime(chat.updatedAt);
    if ('title' in chat) return `Agent | ${when}`;
    if (chat.kind === 'direct') return `Direkt | ${when}`;
    if (chat.kind === 'group') return `Gruppe, ${chat.members.length} Personen | ${when}`;
    const where = areaOf(chat.areaId)?.name;
    return [chat.kind === 'area' ? 'Chat des Bereichs' : `Kanal in ${where}`, chat.topic, when]
      .filter(Boolean)
      .join(' | ');
  };
  const markOf = (chat: SenderChannel | SenderAgent) => {
    if ('title' in chat) return <AgentAvatar id={chat.id} size={32} className="rounded-chip" />;
    if (chat.person) return <Avatar author={chat.person} size={32} />;
    if (chat.kind === 'group') return <Icon name="groups" size={20} />;
    if (chat.kind === 'channel') return <Icon name="chatBubble" size={20} />;
    const area = areaOf(chat.areaId);
    return area ? <AreaMark area={area} size="lg" /> : <Icon name="chatBubble" size={20} />;
  };
  const nothing = !settling && nodes.length === 0 && areas.length === 0 && chats.length === 0;
  return (
    <CloudPage
      docTitle="Suche"
      title="Suche"
      crumbs={[{ label: `Suche nach: „${query.trim()}“` }]}
      nodes={nodes}
      target={null}
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Ort"
            size="toolbar"
            value={place}
            onChange={setPlace}
            options={places}
          />
          <Select
            aria-label="Von"
            size="toolbar"
            value={owner}
            onChange={setOwner}
            options={owners}
          />
        </div>
      }
    >
      {(selection) => (
        <div className="flex flex-col gap-8 pt-2 pb-10">
          {selection.bar}
          {(nodes.length > 0 || (search.isPending && !nothing)) && (
            <Section title="Dateien" count={search.data ? nodes.length : undefined}>
              {search.isPending ? (
                <FileBrowserSkeleton view="list" />
              ) : (
                // Found by what it says: the place stands under its name.
                <FileBrowser
                  nodes={nodes}
                  mode="across"
                  view="list"
                  selection={selection}
                  notes={search.data?.snippets}
                />
              )}
              {search.data?.more && (
                <p className="px-3 text-xs text-fg-subtle">
                  Es gibt mehr Treffer. Tippe weiter, um sie einzugrenzen.
                </p>
              )}
            </Section>
          )}
          {areas.length > 0 && (
            <Section title="Bereiche" count={areas.length}>
              <div className="flex flex-col">
                {areas.map((area) => (
                  <Link
                    key={area.id}
                    to={routes.cloudArea(ui.workspace.id, area.id)}
                    onClick={() => setQuery('')}
                    className={rowClass}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center">
                      <AreaMark area={area} size="lg" />
                    </span>
                    <Lines title={area.name} note={area.description || undefined} />
                  </Link>
                ))}
              </div>
            </Section>
          )}
          {chats.length > 0 && sender && (
            <Section title="Chats und Personen" count={chats.length}>
              <div className="flex flex-col">
                {chats.map((chat) =>
                  'type' in chat ? (
                    <button
                      key={chat.id}
                      type="button"
                      aria-busy={starting === chat.id}
                      onClick={() => start(chat)}
                      className={cn(rowClass, starting === chat.id && 'bg-hover')}
                    >
                      <Avatar author={chat} size={32} />
                      <Lines title={chat.name} note="Noch kein Chat – ein Klick beginnt ihn" />
                    </button>
                  ) : (
                    <button
                      key={chat.id}
                      type="button"
                      onClick={() =>
                        go('title' in chat ? sender.agentPath(chat.id) : sender.pathOf(chat))
                      }
                      className={rowClass}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center text-fg-muted">
                        {markOf(chat)}
                      </span>
                      <Lines
                        title={
                          'title' in chat
                            ? chat.title
                            : chat.kind === 'channel'
                              ? `#${chat.name}`
                              : chat.name
                        }
                        note={noteOf(chat)}
                      />
                    </button>
                  ),
                )}
              </div>
            </Section>
          )}
          {nothing && (
            <p className="text-body text-fg-muted">
              {search.data?.pending
                ? 'Die Dateien werden noch gelesen.'
                : narrowed
                  ? 'Hier heißt nichts so, und in keiner Datei steht das.'
                  : 'Nichts heißt so, und in keiner Datei steht das – keine Datei, kein Bereich, kein Chat, niemand.'}
            </p>
          )}
        </div>
      )}
    </CloudPage>
  );
}
