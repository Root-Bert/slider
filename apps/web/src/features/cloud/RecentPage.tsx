import { Link, useNavigate } from 'react-router';
import type { CloudAgentSummary, CloudNode, Deck } from '@slider/shared';
import { UnreadRow, useUnreadNow } from '@/features/sender';
import { canCreateDecks, WorkspaceViews } from '@/features/workspaces';
import {
  useCloudActivity,
  useCloudAgents,
  useCloudList,
  useDecks,
  useOrderCloudAgent,
} from '@/lib/api';
import { draftKeys } from '@/lib/drafts';
import { formatRelativeTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import { Button, cn, LogoMark, RowList, TextLink } from '@/ui';
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
  const unread = (useUnreadNow().unread.data?.items ?? []).slice(0, UNREAD_SHOWN);
  const nodes = listing.data?.nodes ?? [];

  // A presentation's file is the presentation: shown once, as that.
  const standIns = new Set((decks.data ?? []).map((deck) => deck.cloudNodeId));
  const work: Work[] = [
    ...nodes
      .filter((file) => !standIns.has(file.id))
      .slice(0, 5)
      .map((file) => ({ at: file.updatedAt, file })),
    ...(decks.data ?? [])
      .filter((deck) => !deck.archivedAt)
      .map((deck) => ({ at: deck.updatedAt, deck })),
    ...(agents.data ?? []).map((agent) => ({ at: agent.updatedAt, agent })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5);
  const target = { name: 'Meine Dateien' };
  const beside = unread.length > 0 && work.length > 0;

  return (
    <CloudPage
      docTitle="Zuletzt"
      // Beside it the library, as in Slider: one click across.
      title={<WorkspaceViews workspaceId={workspace.id} current="reviews" app="cloud" />}
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
              onSend={(text) =>
                order.mutateAsync(text).then(
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

          {/* What waits for an answer and what to go on with – each only while there is some.
              Both there: side by side in the columns of the lists below (the unread over
              „Aktivität“), stacked the unread first. No „all“ links: the side bar has every chat
              bold with its count and „Post“; the files of every app stand right below. */}
          {(unread.length > 0 || work.length > 0) && (
            <div
              className={cn(
                'grid shrink-0 grid-cols-1 gap-x-6 gap-y-3 pt-3',
                beside && 'lg:grid-cols-[minmax(0,1fr)_368px]',
              )}
            >
              {unread.length > 0 && (
                <section
                  aria-labelledby="cloud-unread"
                  className="flex min-w-0 flex-col gap-2 lg:col-start-2 lg:row-start-1"
                >
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
              {work.length > 0 && (
                <section
                  aria-labelledby="cloud-continue"
                  className="flex min-w-0 flex-col gap-3.5 lg:col-start-1 lg:row-start-1"
                >
                  <h2 id="cloud-continue" className="text-base font-semibold text-fg">
                    Weiterarbeiten
                  </h2>
                  <div
                    className={cn(
                      'grid grid-cols-2 gap-4 md:grid-cols-3',
                      // Beside the unread one row of cards, as many as fit.
                      beside
                        ? 'lg:grid-cols-3 lg:[&>*:nth-child(n+4)]:hidden 2xl:grid-cols-4 2xl:[&>*:nth-child(4)]:flex'
                        : 'xl:grid-cols-5',
                    )}
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
          )}

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
