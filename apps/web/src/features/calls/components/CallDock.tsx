import { useEffect, useState } from 'react';
import { bringsIntoCall, type CallState } from '@slider/shared';
import { useAgentAvatars } from '@/features/workspaces';
import { useCloudAgents } from '@/lib/api';
import { Avatar, Button, cn, Icon, IconButton, Menu, TextLink } from '@/ui';
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

/**
 * The call one is in, over every page: small in the corner (who is there, the buttons), or – one
 * click – as large as the window, a shared screen first. Its title opens the conversation (or the
 * called agent's chat). Where an agent writes along, a mark in its head says so; what the agent
 * proposed for other agents waits below the tiles for a yes, what was sent shows how far it got.
 * On the called agent's own page it is a card there instead (`box`, `CallBoxes`): the same call,
 * its orders a card of their own below it; „Vergrößern“ grows it over the window as everywhere.
 */
export function CallDock({ call, place = 'dock' }: { call: CallState; place?: 'dock' | 'box' }) {
  const { snap, client, open, openAgent, expanded: grown, setExpanded } = useCalls();
  const box = place === 'box';
  // The card stays in its column; grown, the window-wide dock shows the call (and plays it).
  const expanded = grown && !box;
  const now = useNow();
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
    ? { peerId: me, stream: snap.own.screen, name: 'Dein Bildschirm' }
    : others
        .filter((peer) => peer.screen)
        .map((peer) => ({
          peerId: peer.peerId,
          stream: snap.remote.get(peer.peerId)?.screen ?? null,
          name: `Bildschirm von ${peer.author.name.split(' ')[0]}`,
        }))[0];

  const tiles = [
    ...(self
      ? [
          <CallTile
            key={me}
            author={self.author}
            label="Du"
            stream={snap.local.camera ? snap.own.camera : null}
            mirrored
            mic={snap.local.mic}
            speaking={snap.speaking.has(me)}
            big={expanded}
            className={tileClass(expanded, !!sharer)}
          />,
        ]
      : []),
    ...others.map((peer) => {
      const media = snap.remote.get(peer.peerId);
      return (
        <CallTile
          key={peer.peerId}
          author={peer.author}
          label={peer.author.name}
          stream={peer.camera ? (media?.camera ?? null) : null}
          mic={peer.mic}
          speaking={snap.speaking.has(peer.peerId)}
          connecting={!media || (media.state !== 'connected' && media.state !== 'closed')}
          big={expanded}
          className={tileClass(expanded, !!sharer)}
        />
      );
    }),
    ...(call.agent
      ? [
          <AgentTile
            key="agent"
            agent={call.agent}
            workspaceId={call.workspaceId}
            saying={snap.saying}
            onSendAway={call.agent.invitedBy ? () => client.sendAgentAway() : undefined}
            big={expanded}
            className={tileClass(expanded, false)}
          />,
        ]
      : []),
  ];

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
            {sharer.stream && <StreamVideo stream={sharer.stream} fit="contain" />}
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

      {!box && (
        <CallOrders
          orders={call.orders}
          ownCall={!call.channelId}
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
        {!!call.channelId && (
          <>
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
            {!call.agent && (
              <BringAgent
                workspaceId={call.workspaceId}
                areaId={call.areaId}
                size={expanded ? 'md' : 'lg'}
                onPick={(agentId) => void client.bringAgent(agentId)}
              />
            )}
          </>
        )}
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
 * „Agent dazuholen“: one's own private agents and the area's ones one may write to (`bringsIntoCall`), newest first – the picked one joins the call
 * and answers when spoken to.
 */
function BringAgent({
  workspaceId,
  areaId,
  size,
  onPick,
}: {
  workspaceId: string;
  areaId: string | null;
  size: 'md' | 'lg';
  onPick: (agentId: string) => void;
}) {
  const agents = useCloudAgents(workspaceId);
  const avatarOf = useAgentAvatars(workspaceId);
  const mine = (agents.data ?? [])
    .filter((agent) => agent.canWrite && bringsIntoCall(agent, areaId))
    .slice(0, 10);
  return (
    <Menu
      label="Agent dazuholen"
      triggerIcon="autoAwesome"
      triggerShape="round"
      triggerVariant="glass"
      triggerSize={size}
      actions={
        mine.length > 0
          ? mine.map((agent) => ({
              label: agent.title,
              key: agent.id,
              icon: (
                <img
                  src={avatarOf(agent.id)}
                  alt=""
                  className="size-5 rounded-control object-cover"
                />
              ),
              onSelect: () => onPick(agent.id),
            }))
          : [
              {
                label: agents.isPending ? 'Agenten werden geladen …' : 'Noch keine Agenten',
                icon: 'autoAwesome',
                onSelect: () => {},
                disabled: true,
                title: 'Agenten legst du in Cloud an.',
              },
            ]
      }
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
  return 'grid-cols-2 md:grid-cols-3';
}
