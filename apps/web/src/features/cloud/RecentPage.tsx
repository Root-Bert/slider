import { useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router';
import { cloudFileType, type CloudAgentSummary, type CloudNode, type Deck } from '@slider/shared';
import { SummaryAside, UnreadRow, useUnreadNow, type FileSummaryPart } from '@/features/sender';
import { canCreateDecks, WorkspaceViews } from '@/features/workspaces';
import {
  useCloudActivity,
  useCloudAgents,
  useCloudList,
  useCloudSummary,
  useDecks,
  useOrderCloudAgent,
} from '@/lib/api';
import { draftKeys } from '@/lib/drafts';
import { formatRelativeTime } from '@/lib/format';
import { lastVisitsStore, openedIn } from '@/lib/last-visits';
import { routes } from '@/lib/routes';
import { Button, cn, Icon, LogoMark, RowList, TextLink } from '@/ui';
import { ActivityFeed } from './components/ActivityFeed';
import { AgentAvatar } from './components/AgentAvatar';
import { AgentComposer } from './components/AgentComposer';
import { CloudPage } from './components/CloudPage';
import { Empty, LoadFailed } from './components/Empty';
import {
  FileBrowser,
  FileBrowserSkeleton,
  FilePicture,
  fileClicks,
} from './components/FileBrowser';
import { FileIcon } from './components/FileIcon';
import { MyTodos } from './components/todos/TodoList';
import { UpcomingEvents } from './components/calendar/UpcomingEvents';
import { useCloud } from './hooks/useCloud';
import { useLastVisit } from './lib/last-visit';

type Work =
  | { at: string; file: CloudNode }
  | { at: string; deck: Deck }
  | { at: string; agent: CloudAgentSummary };

/** One thing to go on with: a file, a presentation from Slider or an agent – its picture, its name. */
function WorkCard({ work }: { work: Work }) {
  const ui = useCloud();
  const card = 'group flex min-w-0 flex-col gap-2.5 outline-none';
  const frame =
    'relative aspect-[5/3] overflow-hidden rounded-panel bg-surface-1 ring-hairline transition-colors group-hover:bg-surface-2 group-focus-visible:ring-2 group-focus-visible:ring-focus';
  if ('agent' in work) {
    const { agent } = work;
    return (
      <Link to={routes.cloudAgent(ui.workspace.id, agent.id)} className={card}>
        <span className={frame}>
          <span className="flex size-full items-center justify-center">
            <AgentAvatar id={agent.id} size={56} className="shadow-float" />
          </span>
        </span>
        <span className="flex min-w-0 items-start gap-2.5 px-0.5">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
            <AgentAvatar id={agent.id} size={18} className="rounded-[5px]" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-body font-medium text-fg">{agent.title}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
              <span className="truncate">
                Agent | {agent.running ? 'Arbeitet' : formatRelativeTime(work.at)}
              </span>
              {agent.running && (
                <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-fg-subtle" />
              )}
            </span>
          </span>
        </span>
      </Link>
    );
  }
  if ('deck' in work) {
    const { deck } = work;
    return (
      <Link to={routes.deck(deck.id)} className={card}>
        <span className={frame}>
          {deck.thumbnailUrl ? (
            <img
              src={deck.thumbnailUrl}
              alt=""
              loading="lazy"
              className="absolute inset-0 m-auto max-h-[78%] max-w-[78%] rounded-thumb shadow-float"
            />
          ) : (
            <span className="flex size-full items-center justify-center">
              <LogoMark width={40} />
            </span>
          )}
        </span>
        <span className="flex min-w-0 items-start gap-2.5 px-0.5">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
            <LogoMark width={16} />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-body font-medium text-fg">{deck.title}</span>
            <span className="truncate text-xs text-fg-muted">
              Präsentation | {formatRelativeTime(work.at)}
            </span>
          </span>
        </span>
      </Link>
    );
  }
  const { file } = work;
  return (
    <Link
      to={ui.hrefOf(file)}
      className={card}
      // As the file's row in a list: its details at a click, opened at a double click or Enter.
      {...fileClicks(ui, file)}
    >
      <span className={frame}>
        <FilePicture node={file} />
      </span>
      <span className="flex min-w-0 items-start gap-2.5 px-0.5">
        <FileIcon kind="file" type={file.fileType} size={20} className="mt-0.5" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-body font-medium text-fg">{file.name}</span>
          <span className="truncate text-xs text-fg-muted">
            {file.updatedBy.id === ui.userId ? 'Du' : file.updatedBy.name} |{' '}
            {formatRelativeTime(file.updatedAt)}
          </span>
        </span>
      </span>
    </Link>
  );
}

/** A file's part of „Seit deinem letzten Besuch“: its mark, its name – opened while still there. */
function FilePart({ part }: { part: FileSummaryPart }) {
  const ui = useCloud();
  const { id, nodeKind } = part;
  return (
    <>
      <span className="flex size-5 shrink-0 items-center justify-center text-fg-muted">
        {nodeKind ? (
          <FileIcon
            kind={nodeKind}
            type={nodeKind === 'file' ? cloudFileType(part.name) : null}
            size={20}
          />
        ) : (
          <Icon name="cloud" size={16} />
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        {id && nodeKind ? (
          <button
            type="button"
            className="truncate text-left text-body font-medium text-fg hover:underline focus-visible:underline focus-visible:outline-none"
            onClick={() =>
              nodeKind === 'folder' ? ui.open({ id, kind: 'folder' } as never) : ui.openFile(id)
            }
          >
            {part.name}
          </button>
        ) : (
          <span className="truncate text-body font-medium text-fg">{part.name}</span>
        )}
        <span className="text-body text-fg-muted">{part.text}</span>
      </span>
    </>
  );
}

/** How many unread conversations „Zuletzt“ shows – the rest stand bold in the side bar. */
const UNREAD_SHOWN = 5;

/**
 * „Zuletzt“ – Cloud's start: the way into the search, what is unread (chats, agents, mail), what
 * to go on with (files and Slider's presentations alike), one's tasks, what changed last, and
 * beside it what happened around.
 */
export function Component() {
  const ui = useCloud();
  const { workspace } = ui;
  const listing = useCloudList(workspace.id, { scope: 'recent' });
  const decks = useDecks(workspace.id);
  const agents = useCloudAgents(workspace.id);
  const activity = useCloudActivity(workspace.id, null);
  const order = useOrderCloudAgent(workspace.id);
  const navigate = useNavigate();
  // As Sender's „Aktuell“: asked anew when something comes in or is read, so a read one goes.
  const unreadNow = useUnreadNow();
  const unread = (unreadNow.unread.data?.items ?? []).slice(0, UNREAD_SHOWN);
  // „Seit deinem letzten Besuch“: asked anew when something comes in, is read, or others did
  // something with the files (one's own doings are no news to oneself).
  const since = useLastVisit(ui.userId, workspace.id);
  const othersLast = activity.data?.find((event) => event.actor.id !== ui.userId);
  const summary = useCloudSummary(
    workspace.id,
    since,
    unreadNow.stamp === null || !activity.data
      ? null
      : `${unreadNow.stamp}|${othersLast ? `${othersLast.id}:${othersLast.more}` : ''}`,
  );
  const nodes = listing.data?.nodes ?? [];

  // A presentation's file is the presentation: shown once, as that.
  const standIns = new Set((decks.data ?? []).map((deck) => deck.cloudNodeId));
  // What one opened counts as much as what changed: a file by when the server says (changed or
  // opened, as it sorts them), a presentation also by when this browser last showed it.
  const opened = openedIn(
    useSyncExternalStore(lastVisitsStore.subscribe, lastVisitsStore.getSnapshot),
    ui.userId,
  );
  const latest = (iso: string, ms: number | undefined) =>
    ms !== undefined && ms > Date.parse(iso) ? new Date(ms).toISOString() : iso;
  const work: Work[] = [
    ...nodes
      .filter((file) => !standIns.has(file.id))
      .slice(0, 5)
      .map((file) => ({ at: file.recentAt ?? file.updatedAt, file })),
    ...(decks.data ?? [])
      .filter((deck) => !deck.archivedAt)
      .map((deck) => ({ at: latest(deck.updatedAt, opened[deck.id]), deck })),
    ...(agents.data ?? []).map((agent) => ({ at: agent.updatedAt, agent })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5);
  const target = { name: 'Meine Dateien' };

  return (
    <CloudPage
      docTitle="Zuletzt"
      // Beside it the library, as in Slider: one click across.
      title={<WorkspaceViews workspaceId={workspace.id} current="reviews" app="cloud" />}
      crumbs={[{ label: 'Zuletzt' }]}
      nodes={nodes}
      target={target}
      fill
    >
      {(selection) => (
        <>
          {/* This page has no toolbar: the picked ones' actions stand over the lists. The search
              is the side bar's. */}
          {selection.bar}

          {/* What is to be done, right at the start – as on „Agenten“: the order becomes an
              agent of one's own, opened at once. For members and admins, as the server says. */}
          {canCreateDecks(workspace.role) && (
            <AgentComposer
              top
              placeholder="Was soll erledigt werden?"
              keep={{
                key: draftKeys.newAgent(workspace.id),
                target: { kind: 'agent-new', workspaceId: workspace.id },
              }}
              busy={order.isPending}
              workspaceId={workspace.id}
              onSend={(text, attachments) =>
                order.mutateAsync({ text, attachments }).then(
                  (agent) => {
                    void navigate(routes.cloudAgent(workspace.id, agent.id));
                    return true;
                  },
                  (error: Error) => {
                    ui.notify(error.message, 'danger');
                    return false;
                  },
                )
              }
            />
          )}

          {/* What happened since the last visit and what waits for an answer (as Sender's
              „Aktuell“), beside it what to go on with, while there is some: side by side in the
              columns of the lists below (over „Aktivität“), stacked the summary first. No „all“
              links: the side bar has every chat bold with its count and „Post“; the files of
              every app stand right below. */}
          <div
            className={cn(
              'grid shrink-0 grid-cols-1 items-start gap-x-6 gap-y-6 pt-3',
              work.length > 0 && 'lg:grid-cols-[minmax(0,1fr)_368px]',
            )}
          >
            <div className="flex min-w-0 flex-col gap-y-6 lg:col-start-2 lg:row-start-1">
              <SummaryAside
                summary={summary.data}
                pending={summary.isPending}
                fetching={summary.isFetching}
                error={summary.isError && !summary.data ? summary.error.message : null}
                onRetry={() => void summary.refetch()}
                filePart={(part) => <FilePart part={part} />}
                sinceLabel="Neu seit"
              />
              {unread.length > 0 && (
                <section aria-labelledby="cloud-unread" className="flex min-w-0 flex-col gap-2">
                  <h2 id="cloud-unread" className="text-base font-semibold text-fg">
                    Ungelesen
                  </h2>
                  <RowList variant="hover" aria-label="Ungelesen">
                    {unread.map((item) => (
                      <UnreadRow key={`${item.kind}:${item.id}`} item={item} />
                    ))}
                  </RowList>
                </section>
              )}
            </div>
            {work.length > 0 && (
              <section
                aria-labelledby="cloud-continue"
                className="flex min-w-0 flex-col gap-3.5 lg:col-start-1 lg:row-start-1"
              >
                <h2 id="cloud-continue" className="text-base font-semibold text-fg">
                  Weiterarbeiten
                </h2>
                <div
                  // One row of cards, as many as fit – never one left alone below (the ranges apart: one
                  // rule each).
                  className="grid grid-cols-2 gap-4 max-md:[&>*:nth-child(n+3)]:hidden md:grid-cols-3 md:max-2xl:[&>*:nth-child(n+4)]:hidden 2xl:grid-cols-4 2xl:[&>*:nth-child(n+5)]:hidden"
                >
                  {work.map((each) => (
                    <WorkCard
                      key={
                        'agent' in each
                          ? each.agent.id
                          : 'deck' in each
                            ? each.deck.id
                            : each.file.id
                      }
                      work={each}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* What is one's to do – one's own and those given to one, the most pressing first –
              and what comes up in one's calendars; side by side where there is room. */}
          <div className="flex shrink-0 flex-col gap-x-6 gap-y-8 pt-3 empty:hidden xl:flex-row">
            <div className="min-w-0 flex-1 empty:hidden">
              <MyTodos />
            </div>
            <div className="min-w-0 flex-1 empty:hidden">
              <UpcomingEvents />
            </div>
          </div>

          {/* Side by side each scrolls in itself; stacked, the page does. */}
          <div className="grid grid-cols-1 items-start gap-x-6 gap-y-8 pt-3 2xl:min-h-0 2xl:flex-1 2xl:grid-cols-[minmax(0,1fr)_368px] 2xl:grid-rows-[minmax(0,1fr)]">
            <section
              aria-labelledby="cloud-changed"
              className="flex min-w-0 flex-col gap-2 2xl:max-h-full 2xl:min-h-0"
            >
              <div className="flex items-baseline justify-between">
                <h2 id="cloud-changed" className="text-base font-semibold text-fg">
                  Zuletzt geändert
                </h2>
                {ui.home?.ownFiles !== false && (
                  <TextLink to={routes.cloudOwn(workspace.id)} size="body">
                    Meine Dateien
                  </TextLink>
                )}
              </div>
              {listing.isPending ? (
                <FileBrowserSkeleton view="list" />
              ) : listing.isLoadingError ? (
                <LoadFailed
                  message={listing.error.message}
                  onRetry={() => void listing.refetch()}
                />
              ) : nodes.length === 0 ? (
                <Empty
                  icon="cloud"
                  title="Noch keine Dateien"
                  message="Zieh Dateien oder ganze Ordner hierher, sie landen in „Meine Dateien“."
                  action={
                    <Button
                      variant="primary"
                      icon="upload"
                      onClick={() => ui.pickAndUpload(target)}
                    >
                      Dateien hochladen
                    </Button>
                  }
                />
              ) : (
                <div className="2xl:-mx-2 2xl:min-h-0 2xl:overflow-y-auto 2xl:overscroll-contain 2xl:px-2">
                  <FileBrowser nodes={nodes} mode="across" view="list" selection={selection} />
                </div>
              )}
            </section>
            <aside
              aria-labelledby="cloud-activity"
              className="glass flex flex-col gap-1 rounded-panel p-4 2xl:max-h-full 2xl:min-h-0"
            >
              <h2 id="cloud-activity" className="shrink-0 pb-1 text-base font-semibold text-fg">
                Aktivität
              </h2>
              <div className="2xl:-mx-2 2xl:min-h-0 2xl:overflow-y-auto 2xl:overscroll-contain 2xl:px-2">
                <ActivityFeed events={(activity.data ?? []).slice(0, 30)} compact />
              </div>
            </aside>
          </div>
        </>
      )}
    </CloudPage>
  );
}
