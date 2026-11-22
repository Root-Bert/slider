import type { SenderChannel } from '@slider/shared';
import { AvatarStack, Button, IconButton } from '@/ui';
import { useCallsOrNull } from '../CallProvider';
import { NotesBadge } from './NotesBadge';

/**
 * In a conversation's header: „Anrufen“ and „Videoanruf“ – a direct conversation or a group rings
 * at its people, an area's channel opens a meeting its people join. While a call runs there:
 * who is in it and „Beitreten“; while one is in it oneself: „Im Anruf“ (the call grows).
 */
export function CallButtons({ channel }: { channel: Pick<SenderChannel, 'id' | 'canWrite'> }) {
  const calls = useCallsOrNull();
  if (!calls?.snap.me) return null;
  const { snap, client, setExpanded } = calls;
  const running = [...snap.calls.values()].find((call) => call.channelId === channel.id);
  const busy = snap.joining !== null;

  if (snap.active?.channelId === channel.id) {
    return (
      <Button variant="soft" size="sm" icon="call" onClick={() => setExpanded(true)}>
        Im Anruf
      </Button>
    );
  }
  if (running && running.peers.length > 0) {
    return (
      <div className="flex items-center gap-2">
        <NotesBadge call={running} />
        <AvatarStack authors={running.peers.map((peer) => peer.author)} max={3} size={24} />
        <Button
          variant="primary"
          size="sm"
          icon="call"
          disabled={busy}
          onClick={() => void client.join(channel.id, { video: false })}
        >
          Beitreten
        </Button>
      </div>
    );
  }
  if (!channel.canWrite) return null;
  return (
    <div className="flex items-center">
      <IconButton
        variant="subtle"
        size="sm"
        icon="call"
        label="Anrufen"
        disabled={busy}
        onClick={() => void client.join(channel.id, { video: false })}
      />
      <IconButton
        variant="subtle"
        size="sm"
        icon="videocam"
        label="Videoanruf"
        disabled={busy}
        onClick={() => void client.join(channel.id, { video: true })}
      />
    </div>
  );
}

/**
 * In an agent's header (its chat in Sender, its page in Cloud): „Anrufen“ – one talks to it, it
 * answers aloud; while one is in that call: „Im Anruf“. Who may write to it may call it.
 */
export function AgentCallButton({ agent }: { agent: { id: string; canWrite: boolean } }) {
  const calls = useCallsOrNull();
  if (!calls?.snap.me || !agent.canWrite) return null;
  const { snap, client, setExpanded } = calls;
  if (snap.active?.agentId === agent.id) {
    return (
      <Button variant="soft" size="sm" icon="call" onClick={() => setExpanded(true)}>
        Im Anruf
      </Button>
    );
  }
  return (
    <IconButton
      variant="subtle"
      size="sm"
      icon="call"
      label="Anrufen"
      disabled={snap.joining !== null}
      onClick={() => void client.callAgent(agent.id)}
    />
  );
}
