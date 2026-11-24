import type { CallState } from '@slider/shared';
import { Avatar, Button, IconButton } from '@/ui';
import { useCalls } from '../CallProvider';
import { callTitle } from '../lib/names';
import { NotesBadge } from './NotesBadge';

/** A call that rings here: who calls, from where – „Ablehnen“ or „Annehmen“ (a video call with the camera on, or with sound only). */
export function IncomingCall({ call }: { call: CallState }) {
  const { snap, client } = useCalls();
  const joining = snap.joining === call.channelId;
  const kind = call.video ? 'Videoanruf' : 'Anruf';
  const where = call.kind === 'direct' ? kind : `${kind} | ${callTitle(call, snap.me)}`;
  return (
    <section
      aria-label={`${call.startedBy.name} ruft an`}
      aria-live="assertive"
      className="glass-elevated pointer-events-auto animate-pop-in rounded-panel p-3"
    >
      <div className="flex items-center gap-3">
        <span className="relative grid shrink-0 place-items-center">
          <span
            className="absolute inset-0 animate-ping rounded-full ring-2 ring-success"
            aria-hidden
          />
          <Avatar author={call.startedBy} size={32} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-fg">{call.startedBy.name} ruft an</p>
          <p className="truncate text-xs text-fg-subtle">{where}</p>
        </div>
      </div>
      {call.notes && !!call.channelId && (
        <div className="mt-2 flex">
          <NotesBadge call={call} align="start" />
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="danger"
          size="sm"
          icon="callEnd"
          className="flex-1"
          disabled={joining}
          onClick={() => client.decline(call.id)}
        >
          Ablehnen
        </Button>
        {call.video && (
          <IconButton
            variant="glass"
            size="sm"
            icon="call"
            label="Nur mit Ton annehmen"
            disabled={joining}
            onClick={() => void client.join(call.channelId, { video: false })}
          />
        )}
        <Button
          variant="primary"
          size="sm"
          icon={call.video ? 'videocam' : 'call'}
          className="flex-1"
          disabled={joining}
          onClick={() => void client.join(call.channelId, { video: call.video })}
        >
          Annehmen
        </Button>
      </div>
    </section>
  );
}
