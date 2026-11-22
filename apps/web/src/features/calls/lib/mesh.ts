import type { CallIceServer, CallSignal } from '@slider/shared';

/** What a tab sends: its voice, its camera, its screen – each in a fixed place of the connection. */
export type Slot = 'audio' | 'camera' | 'screen';
export const SLOTS: readonly Slot[] = ['audio', 'camera', 'screen'];

/** What comes from another tab, slot by slot. */
export interface RemoteMedia {
  audio: MediaStream | null;
  camera: MediaStream | null;
  screen: MediaStream | null;
  /** `connected` once sound and pictures flow; before and after a break something else. */
  state: RTCPeerConnectionState;
}

interface Remote {
  pc: RTCPeerConnection;
  /** This tab offered (it came later): it alone offers again, to restart a broken way. */
  initiator: boolean;
  /** Candidates that came before the other side's description. */
  waiting: RTCIceCandidateInit[];
  media: RemoteMedia;
  ready: boolean;
}

/**
 * The call's connections, one to each other tab (each sends to each). Every connection carries
 * three transceivers in the same order – voice, camera, screen – made once by the side that
 * offers: switching the camera or the screen on and off only swaps the track that is sent
 * (`replaceTrack`), nothing is negotiated again. Who joins later offers to who was there; the
 * other side only answers, so two offers never cross.
 */
export class Mesh {
  private readonly remotes = new Map<string, Remote>();
  private readonly local: Record<Slot, MediaStreamTrack | null> = {
    audio: null,
    camera: null,
    screen: null,
  };
  private closed = false;

  constructor(
    private readonly options: {
      iceServers: CallIceServer[];
      send: (to: string, signal: CallSignal) => void;
      onChange: () => void;
    },
  ) {}

  /** What arrives from each other tab right now. */
  media(): Map<string, RemoteMedia> {
    return new Map([...this.remotes].map(([peerId, remote]) => [peerId, remote.media]));
  }

  /** What this tab sends in a slot (`null`: nothing, e.g. the camera off). */
  setTrack(slot: Slot, track: MediaStreamTrack | null) {
    this.local[slot] = track;
    for (const remote of this.remotes.values()) {
      if (!remote.ready) continue;
      const transceiver = remote.pc.getTransceivers()[SLOTS.indexOf(slot)];
      void transceiver?.sender.replaceTrack(track).catch(() => {});
    }
  }

  /** Offers to a tab that was in the call before this one. */
  connect(peerId: string) {
    if (this.closed || this.remotes.has(peerId)) return;
    const remote = this.open(peerId, true);
    for (const slot of SLOTS) {
      remote.pc.addTransceiver(slot === 'audio' ? 'audio' : 'video', {
        direction: 'sendrecv',
        ...(slot === 'audio' ? {} : { sendEncodings: encodingsOf(slot) }),
      });
    }
    remote.ready = true;
    this.sendTracks(remote);
  }

  /** What another tab told this one (passed on by the server). */
  async handle(from: string, signal: CallSignal) {
    if (this.closed) return;
    try {
      if (signal.type === 'offer') {
        const remote = this.remotes.get(from) ?? this.open(from, false);
        await remote.pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
        if (!remote.ready) {
          // The offer made the transceivers, in its order: send into them.
          for (const transceiver of remote.pc.getTransceivers()) transceiver.direction = 'sendrecv';
          remote.ready = true;
          this.sendTracks(remote);
        }
        await remote.pc.setLocalDescription(await remote.pc.createAnswer());
        const sdp = remote.pc.localDescription?.sdp;
        if (sdp) this.options.send(from, { type: 'answer', sdp });
        await this.flush(remote);
      } else if (signal.type === 'answer') {
        const remote = this.remotes.get(from);
        if (!remote || remote.pc.signalingState !== 'have-local-offer') return;
        await remote.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
        await this.flush(remote);
      } else {
        const remote = this.remotes.get(from);
        if (!remote || !signal.candidate) return;
        if (remote.pc.remoteDescription) await remote.pc.addIceCandidate(signal.candidate);
        else remote.waiting.push(signal.candidate);
      }
    } catch {
      // A signal that no longer fits (the other side restarted meanwhile): the next one will.
    }
  }

  /** A tab left the call. */
  drop(peerId: string) {
    const remote = this.remotes.get(peerId);
    if (!remote) return;
    this.remotes.delete(peerId);
    remote.pc.close();
    this.options.onChange();
  }

  close() {
    this.closed = true;
    for (const remote of this.remotes.values()) remote.pc.close();
    this.remotes.clear();
  }

  private open(peerId: string, initiator: boolean): Remote {
    const pc = new RTCPeerConnection({ iceServers: this.options.iceServers });
    const remote: Remote = {
      pc,
      initiator,
      waiting: [],
      ready: false,
      media: { audio: null, camera: null, screen: null, state: 'new' },
    };
    this.remotes.set(peerId, remote);
    pc.addEventListener('icecandidate', (event) => {
      this.options.send(peerId, {
        type: 'candidate',
        candidate: event.candidate ? event.candidate.toJSON() : null,
      });
    });
    pc.addEventListener('track', (event) => {
      const index = pc.getTransceivers().indexOf(event.transceiver);
      const slot = SLOTS[index];
      if (!slot) return;
      remote.media = { ...remote.media, [slot]: new MediaStream([event.track]) };
      this.options.onChange();
    });
    pc.addEventListener('connectionstatechange', () => {
      remote.media = { ...remote.media, state: pc.connectionState };
      // A broken way: who offered looks for a new one.
      if (pc.connectionState === 'failed' && remote.initiator) pc.restartIce();
      this.options.onChange();
    });
    if (initiator) {
      pc.addEventListener('negotiationneeded', () => {
        void (async () => {
          try {
            await pc.setLocalDescription(await pc.createOffer());
            const sdp = pc.localDescription?.sdp;
            if (sdp) this.options.send(peerId, { type: 'offer', sdp });
          } catch {
            // Closed meanwhile.
          }
        })();
      });
    }
    this.options.onChange();
    return remote;
  }

  private sendTracks(remote: Remote) {
    const transceivers = remote.pc.getTransceivers();
    SLOTS.forEach((slot, index) => {
      const track = this.local[slot];
      if (track) void transceivers[index]?.sender.replaceTrack(track).catch(() => {});
    });
  }

  private async flush(remote: Remote) {
    const waiting = remote.waiting.splice(0);
    for (const candidate of waiting) await remote.pc.addIceCandidate(candidate).catch(() => {});
  }
}

/** A screen is sharp at few pictures a second; a face moves at more and may be softer. */
function encodingsOf(slot: Exclude<Slot, 'audio'>): RTCRtpEncodingParameters[] {
  return slot === 'screen'
    ? [{ maxBitrate: 2_500_000, maxFramerate: 15 }]
    : [{ maxBitrate: 900_000, maxFramerate: 30 }];
}
