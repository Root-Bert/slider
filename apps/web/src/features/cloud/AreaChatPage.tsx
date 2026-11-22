import { Navigate, useNavigate, useParams } from 'react-router';
import { routes } from '@/lib/routes';
import { Conversation, useSenderOrNull } from '@/features/sender';
import { GlassPanel, SegmentedControl } from '@/ui';
import { AreaMark } from './components/AreaMark';
import { AreaViews } from './components/AreaViews';
import { CloudPage } from './components/CloudPage';
import { useCloud } from './hooks/useCloud';
import { areaTrail } from './lib/areas';

/**
 * An area's chat: the view beside its files and agents, under the same title – the area is its one
 * chat, nothing to open besides. Channels made before (there are no new ones) stand as pills above
 * it. Everyone who sees the area reads along.
 */
export function Component() {
  const { areaId = '', channelId } = useParams();
  const ui = useCloud();
  const sender = useSenderOrNull();
  const navigate = useNavigate();
  const { workspace } = ui;
  const areas = ui.home?.areas;
  const area = areas?.find((each) => each.id === areaId) ?? null;
  const channels = sender?.home?.areas.find((each) => each.id === areaId)?.channels;
  const open = channels?.find((each) => each.id === channelId) ?? channels?.[0];
  // Gone, not one's to see, or without a channel: the area's own page says so.
  if ((areas && !area) || (sender?.home && !open)) {
    return <Navigate to={routes.cloudArea(workspace.id, areaId)} replace />;
  }
  const own = channels?.[0];
  return (
    <CloudPage
      docTitle={area ? `${area.name} | Chat` : 'Chat'}
      title={area ? <AreaViews area={area} current="chat" /> : ' '}
      lead={area ? <AreaMark area={area} size="lg" /> : null}
      // The workspace's own: a tab of it, no crumbs above (as its files and „Bereiche“).
      crumbs={
        area && !area.root
          ? [...areaTrail(workspace.id, areas ?? [], area).slice(0, -1), { label: area.name }]
          : undefined
      }
      toolbar={
        channels && open && channels.length > 1 ? (
          <GlassPanel className="p-1">
            <SegmentedControl
              label="Kanäle"
              value={open.id}
              onChange={(id) =>
                void navigate(
                  routes.cloudAreaChat(workspace.id, areaId, id === own?.id ? undefined : id),
                )
              }
              segments={channels.map((channel, index) => ({
                value: channel.id,
                label: index === 0 ? 'Allgemein' : channel.name,
                icon: 'chatBubble',
                count: channel.unread || undefined,
              }))}
            />
          </GlassPanel>
        ) : undefined
      }
      nodes={[]}
      fill
    >
      {() =>
        open ? (
          // Its own clicks and drags: text is picked here, no selection box is drawn.
          <div
            className="flex min-h-0 flex-1 flex-col"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Conversation channelId={open.id} compact />
          </div>
        ) : null
      }
    </CloudPage>
  );
}
