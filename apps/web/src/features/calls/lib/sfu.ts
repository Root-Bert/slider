import type { CallSfu } from '@slider/shared';
import type * as LiveKitModule from 'livekit-client';
import type {
  LocalTrackPublication,
  Participant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  TrackPublishOptions,
} from 'livekit-client';
import type { RemoteMedia, Slot, Transport } from './mesh';

type LiveKit = typeof LiveKitModule;

/** How long the call stream gets to say why the server let this tab go before it counts as lost. */
const SAID_WAIT_MS = 4_000;

/**
 * The call's sound and pictures through the server (LiveKit): this tab sends each of its tracks
 * once, the server forwards them to everyone in the call's room. Cameras go up in three sizes
 * (simulcast); each tab gets only the pictures it shows, as large as it shows them (adaptive
 * stream), and nobody sends a size nobody watches (dynacast). The call itself – who is in it,
 * ringing, agents – stays with the server's call stream; the room is named after the call and
 * each tab is in it under its own id. `livekit-client` loads only when a call starts here.
 */
export class Sfu implements Transport {
  private lk: LiveKit | null = null;
  private room: Room | null = null;
  private closed = false;
  /** In the room once: a failed first connect is `start`'s rejection, not a lost call. */
  private connected = false;
  private readonly local: Record<Slot, MediaStreamTrack | null> = {
    audio: null,
    camera: null,
    screen: null,
  };
  private readonly published = new Map<Slot, LocalTrackPublication>();
  /** Publishing and unpublishing one after the other – a camera switched fast stays in order. */
  private work: Promise<void> = Promise.resolve();
  private readonly remotes = new Map<string, RemoteMedia>();

  constructor(
    private readonly options: {
      onChange: () => void;
      /** The connection to the server broke for good (not by hanging up, being sent out or the call ending). */
      onLost: () => void;
    },
  ) {}

  /** Into the call's room – resolves once connected (throws when the server cannot be reached). */
  async start({ url, token }: CallSfu): Promise<void> {
    const lk = await import('livekit-client');
    if (this.closed) return;
    this.lk = lk;
    const { RoomEvent } = lk;
    const room = new lk.Room({
      adaptiveStream: true,
      dynacast: true,
      // The call's own tracks: they stop when the call goes (`CallClient`), not when unpublished –
      // the microphone's goes on into the listener for the notes.
      stopLocalTrackOnUnpublish: false,
      publishDefaults: { simulcast: true, videoCodec: 'vp8', dtx: true, red: true },
    });
    this.room = room;
    room
      .on(RoomEvent.ParticipantConnected, (participant) => this.came(participant))
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        this.remotes.delete(participant.identity);
        this.options.onChange();
      })
      .on(RoomEvent.TrackSubscribed, (track, publication, participant) =>
        this.subscribed(track, publication, participant, true),
      )
      .on(RoomEvent.TrackUnsubscribed, (track, publication, participant) =>
        this.subscribed(track, publication, participant, false),
      )
      .on(RoomEvent.Reconnecting, () => this.every('connecting'))
      .on(RoomEvent.Reconnected, () => {
        this.every('connected');
        for (const slot of ['audio', 'camera', 'screen'] as const) this.queue(slot);
      })
      .on(RoomEvent.Disconnected, (reason) => {
        if (this.closed || !this.connected) return;
        const { DisconnectReason } = lk;
        // Hung up here, sent out, the call over, the tab taken over elsewhere: the call stream says
        // so and closes this. Where it does not (a stray send-out after a quick rejoin), the tab
        // would sit in the call hearing nobody – it is lost after all.
        const said = [
          DisconnectReason.CLIENT_INITIATED,
          DisconnectReason.PARTICIPANT_REMOVED,
          DisconnectReason.ROOM_DELETED,
          DisconnectReason.DUPLICATE_IDENTITY,
        ];
        if (reason !== undefined && said.includes(reason)) {
          setTimeout(() => {
            if (!this.closed && this.room === room) this.options.onLost();
          }, SAID_WAIT_MS);
        } else this.options.onLost();
      });
    await room.connect(url, token, { autoSubscribe: true });
    this.connected = true;
    if (this.closed) {
      void room.disconnect(false);
      return;
    }
    for (const participant of room.remoteParticipants.values()) {
      this.came(participant);
      for (const publication of participant.trackPublications.values()) {
        if (publication.track) this.subscribed(publication.track, publication, participant, true);
      }
    }
    for (const slot of ['audio', 'camera', 'screen'] as const) this.queue(slot);
  }

  setTrack(slot: Slot, track: MediaStreamTrack | null) {
    this.local[slot] = track;
    this.queue(slot);
  }

  media(): Map<string, RemoteMedia> {
    return new Map(this.remotes);
  }

  /** The server says who left its room – the call stream's word alone changes nothing here. */
  drop() {}

  close() {
    this.closed = true;
    this.remotes.clear();
    void this.room?.disconnect(false);
    this.room = null;
  }

  private came(participant: Participant) {
    if (this.remotes.has(participant.identity)) return;
    this.remotes.set(participant.identity, {
      audio: null,
      camera: null,
      screen: null,
      state: 'connected',
    });
    this.options.onChange();
  }

  private subscribed(
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: Participant,
    on: boolean,
  ) {
    const slot = this.slotOf(publication);
    if (!slot) return;
    const before = this.remotes.get(participant.identity) ?? {
      audio: null,
      camera: null,
      screen: null,
      state: 'connected' as const,
    };
    const attach = { ...before.attach };
    if (slot !== 'audio') {
      if (on) attach[slot] = track;
      else delete attach[slot];
    }
    this.remotes.set(participant.identity, {
      ...before,
      [slot]: on ? new MediaStream([track.mediaStreamTrack]) : null,
      attach,
    });
    this.options.onChange();
  }

  private slotOf(publication: RemoteTrackPublication): Slot | null {
    const source = this.lk?.Track.Source;
    if (!source) return null;
    if (publication.source === source.Microphone) return 'audio';
    if (publication.source === source.Camera) return 'camera';
    if (publication.source === source.ScreenShare) return 'screen';
    return null;
  }

  private every(state: RTCPeerConnectionState) {
    for (const [identity, media] of this.remotes) this.remotes.set(identity, { ...media, state });
    this.options.onChange();
  }

  /** Brings what the room has of a slot in line with what this tab sends. */
  private queue(slot: Slot) {
    this.work = this.work.then(() => this.sync(slot)).catch(() => {});
  }

  private async sync(slot: Slot) {
    const room = this.room;
    const lk = this.lk;
    if (!room || !lk || this.closed || room.state !== lk.ConnectionState.Connected) return;
    const track = this.local[slot];
    const publication = this.published.get(slot);
    if (publication?.track?.mediaStreamTrack === track && track) return;
    if (publication?.track) {
      this.published.delete(slot);
      await room.localParticipant.unpublishTrack(publication.track, false);
    }
    if (!track || this.closed) return;
    this.published.set(slot, await room.localParticipant.publishTrack(track, this.optionsOf(slot)));
  }

  private optionsOf(slot: Slot): TrackPublishOptions {
    const lk = this.lk!;
    if (slot === 'audio') return { source: lk.Track.Source.Microphone };
    if (slot === 'camera')
      return {
        source: lk.Track.Source.Camera,
        // A face moves: up to 30 pictures a second; small tiles get the smaller sizes.
        videoEncoding: { maxBitrate: 900_000, maxFramerate: 30 },
        videoSimulcastLayers: [lk.VideoPresets.h180, lk.VideoPresets.h360],
      };
    // A screen is sharp at few pictures a second; the dock's small view gets a smaller one.
    return {
      source: lk.Track.Source.ScreenShare,
      screenShareEncoding: { maxBitrate: 2_500_000, maxFramerate: 15 },
      screenShareSimulcastLayers: [lk.ScreenSharePresets.h360fps15],
    };
  }
}
