import { useEffect, useRef } from 'react';
import type { AccountAuthor, CallAgent } from '@slider/shared';
import { useWorkspaceAgentAvatars } from '@/features/workspaces';
import { Avatar, cn, Icon, IconButton } from '@/ui';
import type { VideoAttach } from '../lib/mesh';

/**
 * A stream shown in a `<video>` – silent: voices play in their own `<audio>` (`CallAudio`).
 * Through the server (`attach`) the track goes onto the element itself: the server then sends the
 * picture only while it is shown, and as large as it is shown.
 */
export function StreamVideo({
  stream,
  attach,
  mirrored = false,
  fit = 'cover',
}: {
  stream: MediaStream;
  attach?: VideoAttach;
  mirrored?: boolean;
  fit?: 'cover' | 'contain';
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (attach) {
      attach.attach(video);
      return () => void attach.detach(video);
    }
    if (video.srcObject === stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
  }, [stream, attach]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={cn(
        'absolute inset-0 size-full',
        fit === 'contain' ? 'object-contain' : 'object-cover',
        mirrored && '-scale-x-100',
      )}
    />
  );
}

/** Another tab's voice. */
export function CallAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const audio = ref.current;
    if (!audio || audio.srcObject === stream) return;
    audio.srcObject = stream;
    void audio.play().catch(() => {});
  }, [stream]);
  return <audio ref={ref} autoPlay className="hidden" />;
}

/**
 * A person in a call: their camera, or their avatar while it is off; their name and a crossed
 * microphone in the corner; a green rim while they speak.
 */
export function CallTile({
  author,
  label,
  stream,
  attach,
  mirrored,
  mic,
  speaking,
  connecting,
  big = false,
  className,
}: {
  author: AccountAuthor;
  /** As shown under it (`Du` for oneself). */
  label: string;
  stream: MediaStream | null;
  /** Through the server: the camera's track, shown by attaching it (`StreamVideo`). */
  attach?: VideoAttach;
  mirrored?: boolean;
  mic: boolean;
  speaking: boolean;
  connecting?: boolean;
  big?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-control bg-surface-1 transition-shadow',
        speaking ? 'ring-2 ring-success' : 'ring-hairline',
        className,
      )}
    >
      {stream ? (
        <StreamVideo stream={stream} attach={attach} mirrored={mirrored} />
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <Avatar author={author} size={big ? 64 : 32} nativeTitle={false} />
        </div>
      )}
      <span className="glass-dark absolute bottom-1 left-1 flex max-w-[calc(100%-8px)] items-center gap-1 rounded-badge px-1.5 py-0.5 text-caption text-fg">
        {!mic && <Icon name="micOff" size={12} label="Stumm" className="text-danger" />}
        <span className="truncate">{label}</span>
      </span>
      {connecting && (
        <span className="glass-dark absolute top-1 right-1 rounded-badge px-1.5 py-0.5 text-caption text-fg-muted">
          Verbindet …
        </span>
      )}
    </div>
  );
}

/**
 * The agent in the call: its picture, what it does – listens, works on what was said (its step,
 * as in its chat), speaks; a green rim while its answer is read out. Brought into a
 * conversation's call it says how to speak to it, and anyone there can send it away.
 */
export function AgentTile({
  agent,
  workspaceId,
  saying,
  onSendAway,
  big = false,
  className,
}: {
  agent: CallAgent;
  /** The call's workspace: the agent looks as it has its agents look. */
  workspaceId: string;
  saying: boolean;
  onSendAway?: () => void;
  big?: boolean;
  className?: string;
}) {
  const avatarOf = useWorkspaceAgentAvatars(workspaceId);
  const state = saying
    ? 'Spricht'
    : agent.state === 'thinking'
      ? (agent.doing ?? 'Denkt nach …')
      : agent.invitedBy
        ? 'Hört zu – sag „Agent, …“'
        : 'Hört zu';
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-control bg-surface-1 transition-shadow',
        saying ? 'ring-2 ring-success' : 'ring-hairline',
        className,
      )}
    >
      <div className="absolute inset-0 grid place-items-center">
        <img
          src={avatarOf(agent.id)}
          alt=""
          draggable={false}
          className={cn(
            'rounded-control object-cover',
            agent.state === 'thinking' && !saying && 'animate-pulse',
          )}
          style={{ width: big ? 64 : 32, height: big ? 64 : 32 }}
        />
      </div>
      <span
        title={
          agent.invitedBy ? `${agent.title} – dazugeholt von ${agent.invitedBy.name}` : undefined
        }
        className="glass-dark absolute bottom-1 left-1 flex max-w-[calc(100%-8px)] items-center gap-1 rounded-badge px-1.5 py-0.5 text-caption text-fg"
      >
        <span className="truncate">{state}</span>
      </span>
      {onSendAway && (
        <IconButton
          size="xs"
          variant="glass"
          icon="close"
          label="Aus dem Anruf entfernen"
          onClick={onSendAway}
          className="absolute top-1 right-1"
        />
      )}
    </div>
  );
}
