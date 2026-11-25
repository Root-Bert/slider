import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { bringsIntoCall, type CallState } from '@slider/shared';
import { useWorkspaceAgentAvatars } from '@/features/workspaces';
import { AgentAsks } from '@/features/cloud';
import { cloudAgentKeys, useCloudAgent, useCloudAgents, useMembers } from '@/lib/api';
import { Avatar, Button, cn, Icon, IconButton, Menu, type MenuAction, TextLink } from '@/ui';
import { useCalls } from '../CallProvider';
import { callTitle, duration } from '../lib/names';
import { CallOrders } from './CallOrders';
import { AgentTile, CallAudio, CallTile, StreamVideo } from './CallTile';
import { NotesBadge } from './NotesBadge';

/** Ticks once a second while shown – the call's clock. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** Most tiles shown at once when large: 4 × 4, the rest on further pages. */
const PAGE = 16;
/** Small, up to this many tiles side by side; more and it shows who speaks and how many are there. */
const SMALL_MOST = 4;

/**
 * In which turn each one in the call last spoke (tab id, `agent` for the agent; higher is later) –
 * who comes first. Counted while rendering, when the voices that speak change.
 */
function useSpokeAt(speaking: ReadonlySet<string>): ReadonlyMap<string, number> {
  const [seen, setSeen] = useState(speaking);
  const [spoke, setSpoke] = useState<{ turn: number; at: ReadonlyMap<string, number> }>(() => ({
    turn: 0,
    at: new Map(),
  }));
  if (seen !== speaking) {
    setSeen(speaking);
    if (speaking.size > 0) {
      const turn = spoke.turn + 1;
      const at = new Map(spoke.at);
      for (const id of speaking) at.set(id, turn);
      setSpoke({ turn, at });
    }
  }
  return spoke.at;
}

interface Entry {
  key: string;
  render: (className: string) => ReactNode;
}

/**
 * Large with more than a page: the first page has oneself and those who spoke last (in the order
 * they joined, so nobody jumps around while two talk), the others follow page by page – in an
 * order held while one looks at a later page (`heldSpoke`).
 */
function pagesOf(entries: Entry[], me: string, spoke: ReadonlyMap<string, number>): Entry[][] {
  if (entries.length <= PAGE) return [entries];
  const order = new Map(entries.map((entry, index) => [entry.key, index]));
  const recent = entries
    .filter((entry) => entry.key !== me)
    .sort(
      (a, b) =>
        (spoke.get(b.key) ?? 0) - (spoke.get(a.key) ?? 0) || order.get(a.key)! - order.get(b.key)!,
    );
  const firstKeys = new Set(
    [...(order.has(me) ? [me] : []), ...recent.map((entry) => entry.key)].slice(0, PAGE),
  );
  const rest = entries.filter((entry) => !firstKeys.has(entry.key));
  const pages = [entries.filter((entry) => firstKeys.has(entry.key))];
  for (let i = 0; i < rest.length; i += PAGE) pages.push(rest.slice(i, i + PAGE));
  return pages;
}

/** Who to show small when many are there: who spoke last but oneself, else the first who came. */
function speakerOf(entries: Entry[], me: string, spoke: ReadonlyMap<string, number>): Entry {
  const others = entries.filter((entry) => entry.key !== me);
  return (
    others.reduce<Entry | null>(
      (best, entry) =>
        !best || (spoke.get(entry.key) ?? 0) > (spoke.get(best.key) ?? 0) ? entry : best,
      null,
    ) ?? entries[0]!
  );
}

/**
 * The call one is in, over every page: small in the corner (who is there, the buttons), or – one
 * click – as large as the window, a shared screen first. Its title opens the conversation (or the
 * called agent's chat). Where an agent writes along, a mark in its head says so; what the agent
 * proposed for other agents waits below the tiles for a yes, what was sent shows how far it got.
 * On the called agent's own page it is a card there instead (`box`, `CallBoxes`): the same call,
 * its orders a card of their own below it; „Vergrößern“ grows it over the window as everywhere.
 * Many people: small it shows who speaks and how many are there, large up to 4 × 4 at once –
 * who spoke last on the first page, the others on further pages.
 */
export function CallDock({
  call,
  place = 'dock',
  inPanel = false,
}: {
  call: CallState;
  place?: 'dock' | 'box';
  /** The card in the AI's side panel: it can be let float. */
  inPanel?: boolean;
}) {
  const {
    snap,
    client,
    open,
    openAgent,
    expanded: grown,
    setExpanded,
    panelHere,
    setFloating,
  } = useCalls();
  const box = place === 'box';
  // The card stays in its column; grown, the window-wide dock shows the call (and plays it).
  const expanded = grown && !box;
  const now = useNow();
  const voices = useMemo(
    () => (snap.saying ? new Set([...snap.speaking, 'agent']) : snap.speaking),
    [snap.speaking, snap.saying],
  );
  const spoke = useSpokeAt(voices);
  const [page, setPage] = useState(0);
  // Away from the first page the order holds still: who speaks does not pull a tile off the page
  // one is looking at.
  const [heldSpoke, setHeldSpoke] = useState<ReadonlyMap<string, number> | null>(null);
  const turnTo = (next: number) => {
    setPage(next);
    setHeldSpoke(next === 0 ? null : (heldSpoke ?? spoke));
  };
  const me = snap.peerId;
  const self = call.peers.find((peer) => peer.peerId === me);
  const others = call.peers.filter((peer) => peer.peerId !== me);
  const title = callTitle(call, snap.me);
  const since = snap.active?.since ?? now;
  const waitingFor = others.length === 0 ? call.ringing : [];
  const rung = waitingFor
    .map((id) => call.people.find((person) => person.id === id))
    .filter((person) => !!person);

  // Who shows a screen: theirs comes first and large.
  const sharer = snap.local.screen
    ? { peerId: me, stream: snap.own.screen, attach: undefined, name: 'Dein Bildschirm' }
    : others
        .filter((peer) => peer.screen)
        .map((peer) => {
          const media = snap.remote.get(peer.peerId);
          return {
            peerId: peer.peerId,
            stream: media?.screen ?? null,
            attach: media?.attach?.screen,
            name: `Bildschirm von ${peer.author.name.split(' ')[0]}`,
          };
        })[0];

  const entries: Entry[] = [
    ...(self
      ? [
          {
            key: me,
            render: (className: string) => (
              <CallTile
                key={me}
                author={self.author}
                label="Du"
                stream={snap.local.camera ? snap.own.camera : null}
                mirrored
                mic={snap.local.mic}
                speaking={snap.speaking.has(me)}
                big={expanded}
                className={className}
              />
            ),
          },
        ]
      : []),
    ...others.map((peer) => ({
      key: peer.peerId,
      render: (className: string) => {
        const media = snap.remote.get(peer.peerId);
        return (
          <CallTile
            key={peer.peerId}
            author={peer.author}
            label={peer.author.name}
            stream={peer.camera ? (media?.camera ?? null) : null}
            attach={peer.camera ? media?.attach?.camera : undefined}
            mic={peer.mic}
            speaking={snap.speaking.has(peer.peerId)}
            connecting={!media || (media.state !== 'connected' && media.state !== 'closed')}
            big={expanded}
            className={className}
          />
        );
      },
    })),
    ...(call.agent
      ? [
          {
            key: 'agent',
            render: () => (
              <AgentTile
                key="agent"
                agent={call.agent!}
                workspaceId={call.workspaceId}
                saying={snap.saying}
                onSendAway={call.agent?.invitedBy ? () => client.sendAgentAway() : undefined}
                big={expanded}
                className={tileClass(expanded, false)}
              />
            ),
          },
        ]
      : []),
  ];
  // Small with many: who speaks, and how many are there (a click shows everyone).
  const many = !expanded && entries.length > SMALL_MOST;
  const pages = expanded ? pagesOf(entries, me, heldSpoke ?? spoke) : [entries];
  const at = Math.min(page, pages.length - 1);
  // Back to one page (people left, the dock small): the next pages start at the first, live.
  if (pages.length === 1 && (page !== 0 || heldSpoke)) {
    setPage(0);
    setHeldSpoke(null);
  }
  const shown = many ? [speakerOf(entries, me, spoke)] : pages[at]!;
  const tiles = shown.map((entry) => entry.render(tileClass(expanded, !!sharer)));
  const count = (className: string) => (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      title="Alle zeigen"
      className={cn(
        'glass-dark flex items-center gap-1 rounded-badge px-1.5 py-0.5 text-caption text-fg',
        className,
      )}
    >
      <Icon name="groups" size={12} />
      {entries.length} im Anruf
    </button>
  );

  return (
    <section
      aria-label={`Anruf: ${title}`}
      className={cn(
        box
          ? 'glass flex shrink-0 flex-col gap-3 rounded-panel p-4'
          : 'glass-elevated pointer-events-auto flex animate-pop-in flex-col gap-2 rounded-panel p-2',
        expanded && 'min-h-0 flex-1 gap-3 p-3',
      )}
    >
      {!(box && grown) &&
        [...snap.remote].map(([peerId, media]) =>
          media.audio ? <CallAudio key={peerId} stream={media.audio} /> : null,
        )}
      {box ? (
        // Headed like the cards under it; the page is the chat already, so no link to it.
        <div className="flex h-7 shrink-0 items-center gap-2">
          <Icon name="call" size={18} className="text-success" />
          <h2 className="flex-1 text-base font-semibold text-fg">Im Anruf</h2>
          <NotesBadge call={call} />
          <span className="shrink-0 text-caption text-fg-subtle tabular-nums">
            {duration(now - since)}
          </span>
          {inPanel && (
            <IconButton
              size="compact"
              icon="pictureInPicture"
              label="Schweben lassen"
              title="Schweben lassen – sichtbar auch bei geschlossener Seitenleiste"
              onClick={() => setFloating(true)}
            />
          )}
          <IconButton
            size="compact"
            icon="openInFull"
            label="Vergrößern"
            onClick={() => setExpanded(true)}
          />
        </div>
      ) : (
        <header className="flex items-center gap-2 px-1">
          <span className="size-2 shrink-0 animate-pulse rounded-full bg-success" aria-hidden />
          <TextLink
            onClick={() => open(call)}
            weight="medium"
            size="body"
            className="min-w-0 flex-1 truncate text-left text-fg"
            title={call.channelId ? 'Zur Unterhaltung' : 'Zum Chat'}
          >
            {title}
          </TextLink>
          <NotesBadge call={call} />
          <span className="shrink-0 text-caption text-fg-subtle tabular-nums">
            {duration(now - since)}
          </span>
          {panelHere && !expanded && (
            <IconButton
              size="xs"
              icon="sidePanel"
              label="In die Seitenleiste"
              title="In die Seitenleiste – der Anruf läuft dort weiter, auch wenn sie zu ist"
              onClick={() => setFloating(false)}
            />
          )}
          <IconButton
            size="xs"
            icon={expanded ? 'closeFullscreen' : 'openInFull'}
            label={expanded ? 'Verkleinern' : 'Vergrößern'}
            onClick={() => setExpanded(!expanded)}
          />
        </header>
      )}

      {sharer ? (
        <div
          className={cn(
            'flex min-h-0 gap-2',
            expanded ? 'flex-1 flex-col lg:flex-row' : 'flex-col',
          )}
        >
          <div
            className={cn(
              'relative overflow-hidden rounded-control bg-canvas ring-hairline',
              expanded ? 'min-h-0 flex-1' : 'aspect-video',
            )}
          >
            {sharer.stream && (
              <StreamVideo stream={sharer.stream} attach={sharer.attach} fit="contain" />
            )}
            <span className="glass-dark absolute bottom-1 left-1 rounded-badge px-1.5 py-0.5 text-caption text-fg">
              {sharer.name}
            </span>
          </div>
          <div
            className={cn(
              'flex shrink-0 gap-1.5 overflow-auto',
              expanded ? 'lg:w-56 lg:flex-col' : '',
            )}
          >
            {tiles}
            {many && count('shrink-0 self-center whitespace-nowrap')}
          </div>
        </div>
      ) : rung.length > 0 ? (
        <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-control bg-surface-1 ring-hairline">
          <div className="flex -space-x-2">
            {rung.map((person) => (
              <Avatar key={person.id} author={person} size={expanded ? 64 : 32} />
            ))}
          </div>
          <p className="animate-pulse text-xs text-fg-muted">Klingelt …</p>
        </div>
      ) : many ? (
        <div className="relative">
          {tiles}
          {count('absolute top-1 left-1')}
        </div>
      ) : (
        <div
          className={cn(
            'grid min-h-0 gap-1.5',
            expanded && 'flex-1 auto-rows-fr',
            gridOf(tiles.length, expanded),
          )}
        >
          {tiles}
        </div>
      )}

      {pages.length > 1 && (
        <div className="flex items-center justify-center gap-1">
          <IconButton
            size="sm"
            icon="chevronLeft"
            label="Vorherige Seite"
            disabled={at === 0}
            onClick={() => turnTo(at - 1)}
          />
          <span role="status" className="px-1 text-xs text-fg-subtle tabular-nums">
            {at + 1} / {pages.length}
          </span>
          <IconButton
            size="sm"
            icon="chevronRight"
            label="Nächste Seite"
            disabled={at === pages.length - 1}
            onClick={() => turnTo(at + 1)}
          />
        </div>
      )}

      {!box && call.agent && <CallAsks workspaceId={call.workspaceId} agentId={call.agent.id} />}

      {!box && (
        <CallOrders
          orders={call.orders}
          onAnswer={(orderId, send) => client.answerOrder(orderId, send)}
          onOpen={(agentId) => openAgent(call.workspaceId, agentId)}
        />
      )}

      <div className="flex items-center justify-center gap-2 pt-0.5">
        <IconButton
          shape="round"
          size={expanded ? 'md' : 'lg'}
          variant={snap.local.mic ? 'glass' : 'danger'}
          icon={snap.local.mic ? 'mic' : 'micOff'}
          label={snap.local.mic ? 'Stummschalten' : 'Mikrofon an'}
          onClick={() => client.toggleMic()}
        />
        <IconButton
          shape="round"
          size={expanded ? 'md' : 'lg'}
          variant={snap.local.camera ? 'glass' : 'danger'}
          icon={snap.local.camera ? 'videocam' : 'videocamOff'}
          label={snap.local.camera ? 'Kamera aus' : 'Kamera an'}
          onClick={() => void client.toggleCamera()}
        />
        <IconButton
          shape="round"
          size={expanded ? 'md' : 'lg'}
          variant={snap.local.screen ? 'primary' : 'glass'}
          icon={snap.local.screen ? 'stopScreenShare' : 'screenShare'}
          label={snap.local.screen ? 'Teilen beenden' : 'Bildschirm teilen'}
          onClick={() => void client.toggleScreen()}
        />
        <AddToCall call={call} me={snap.me} size={expanded ? 'md' : 'lg'} />
        <Button
          variant="danger"
          size={expanded ? 'field' : 'md'}
          icon="callEnd"
          className="rounded-full"
          onClick={() => void client.leave()}
        >
          Auflegen
        </Button>
      </div>
    </section>
  );
}

/**
 * „Hinzufügen“: first a new agent, made for the call (picked on open – ↵ brings it), then one's own
 * private agents and the area's ones one may write to (`bringsIntoCall`), newest first – while no
 * agent is in the call – and below them the workspace's other members, who are rung into it.
 */
function AddToCall({ call, me, size }: { call: CallState; me: string | null; size: 'md' | 'lg' }) {
  const { client } = useCalls();
  const queryClient = useQueryClient();
  const agents = useCloudAgents(call.workspaceId);
  const members = useMembers(call.workspaceId);
  const avatarOf = useWorkspaceAgentAvatars(call.workspaceId);
  const bring = (agentId: string | null) =>
    void client.bringAgent(agentId).then((brought) => {
      if (brought && !agentId)
        void queryClient.invalidateQueries({ queryKey: cloudAgentKeys.list(call.workspaceId) });
    });
  const agentActions: MenuAction[] = call.agent
    ? []
    : [
        {
          label: 'Neuer Agent',
          key: 'new-agent',
          icon: 'autoAwesome',
          onSelect: () => bring(null),
        },
        ...(agents.data ?? [])
          .filter((agent) => agent.canWrite && bringsIntoCall(agent, call.areaId))
          .slice(0, 10)
          .map((agent) => ({
            label: agent.title,
            key: agent.id,
            icon: (
              <img
                src={avatarOf(agent.id)}
                alt=""
                className="size-5 rounded-control object-cover"
              />
            ),
            onSelect: () => bring(agent.id),
          })),
      ];
  const inCall = new Set(call.peers.map((peer) => peer.author.id));
  const people: MenuAction[] = (members.data ?? [])
    .filter((member) => member.userId !== me && !inCall.has(member.userId))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    .map((member, index) => {
      const ringing = call.ringing.includes(member.userId);
      return {
        label: member.name,
        key: member.userId,
        icon: (
          <Avatar author={{ name: member.name, color: member.color, type: 'owner' }} size={20} />
        ),
        onSelect: () => void client.invite(member.userId),
        disabled: ringing,
        title: ringing ? 'Klingelt gerade' : undefined,
        divider: index === 0 && agentActions.length > 0,
      };
    });
  const actions = [...agentActions, ...people];
  if (actions.length === 0) return null;
  return (
    <Menu
      label={call.agent ? 'Person dazuholen' : 'Hinzufügen'}
      triggerIcon="personAdd"
      triggerShape="round"
      triggerVariant="glass"
      triggerSize={size}
      pickFirst={!call.agent}
      actions={actions}
    />
  );
}

function tileClass(expanded: boolean, beside: boolean): string {
  if (beside)
    return expanded ? 'aspect-video w-40 shrink-0 lg:w-full' : 'aspect-video w-28 shrink-0';
  return expanded ? 'min-h-0' : 'aspect-video';
}

/** Columns: alone one, two side by side, then a square-ish grid. */
function gridOf(count: number, expanded: boolean): string {
  if (count <= 1) return 'grid-cols-1';
  if (!expanded) return 'grid-cols-2';
  if (count <= 2) return 'grid-cols-1 md:grid-cols-2';
  if (count <= 4) return 'grid-cols-2';
  if (count <= 9) return 'grid-cols-2 md:grid-cols-3';
  return 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4';
}

/**
 * What the agent in the call wants done that waits for a click (deleting, sending, …): its open
 * cards, under the tiles – said in the call, clicked here, without opening its chat. Decided, a
 * card goes; the agent says what came of it.
 */
function CallAsks({ workspaceId, agentId }: { workspaceId: string; agentId: string }) {
  const agent = useCloudAgent(workspaceId, agentId).data;
  const open = (agent?.chats ?? []).flatMap((chat) =>
    chat.messages.flatMap((message) => (message.asks ?? []).filter((ask) => ask.state === 'open')),
  );
  if (open.length === 0) return null;
  return (
    <AgentAsks
      workspaceId={workspaceId}
      agentId={agentId}
      asks={open}
      className="mt-0 max-h-44 overflow-y-auto"
    />
  );
}
