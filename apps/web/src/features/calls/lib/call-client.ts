import {
  API_PREFIX,
  type CallEndReason,
  type CallEvent,
  type CallIceServer,
  type CallJoined,
  type CallSignal,
  type CallState,
  type VoiceLive,
  MAX_CALL_UTTERANCE,
} from '@slider/shared';
import { api, ApiError, apiRequest } from '@/lib/api-client';
import { Levels } from './levels';
import type { CallListener } from './listener';
import { camera, MediaRefused, microphone, screen } from './media';
import { Mesh, type RemoteMedia, type Slot } from './mesh';
import { chime } from './sounds';
import { fetchVoice, hush, speak, wakeVoice } from './speaker';

const RECONNECT_MS = 4000;

export interface LocalMedia {
  mic: boolean;
  camera: boolean;
  screen: boolean;
}

/** The call this tab is in. */
export interface ActiveCall {
  callId: string;
  /** Its conversation; empty in a call with an agent. */
  channelId: string;
  /** The Cloud agent called; `null` in a conversation's call. */
  agentId: string | null;
  workspaceId: string;
  /** When this tab came in – the dock's clock. */
  since: number;
}

export interface CallsSnapshot {
  /** One's own user id; `null` until signed in (then there is no stream). */
  me: string | null;
  /** This tab's id in calls. */
  peerId: string;
  /** Every call one sees, by id. */
  calls: ReadonlyMap<string, CallState>;
  active: ActiveCall | null;
  /** The conversation a call is being started or joined in (`agent:<id>`: an agent called). */
  joining: string | null;
  local: LocalMedia;
  /** One's own camera and screen, to show oneself. */
  own: { camera: MediaStream | null; screen: MediaStream | null };
  /** What comes from each other tab of the call. */
  remote: ReadonlyMap<string, RemoteMedia>;
  /** Tabs that speak right now (one's own `peerId` too). */
  speaking: ReadonlySet<string>;
  /** The called agent's answer is being read out here. */
  saying: boolean;
}

type Tell = (text: string, tone?: 'neutral' | 'danger') => void;

const ENDED: Record<CallEndReason, string> = {
  empty: 'Anruf beendet',
  declined: 'Anruf abgelehnt',
  unanswered: 'Niemand hat abgenommen',
};

const newPeerId = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/**
 * The calls of this tab: the stream that says who calls where (open on every page while signed
 * in), the call this tab is in with its microphone, camera and screen, and the connections to
 * the others (`Mesh`). React reads it through `useSyncExternalStore`.
 */
export class CallClient {
  private snap: CallsSnapshot;
  private readonly listeners = new Set<() => void>();
  private source: EventSource | null = null;
  private timer = 0;
  private iceServers: CallIceServer[] = [];
  private mesh: Mesh | null = null;
  private readonly tracks: Record<Slot, MediaStreamTrack | null> = {
    audio: null,
    camera: null,
    screen: null,
  };
  private readonly levels = new Levels((speaking) => this.set({ speaking }));
  private tell: Tell = () => {};

  constructor(peerId = newPeerId()) {
    this.snap = {
      me: null,
      peerId,
      calls: new Map(),
      active: null,
      joining: null,
      local: { mic: false, camera: false, screen: false },
      own: { camera: null, screen: null },
      remote: new Map(),
      speaking: new Set(),
      saying: false,
    };
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = () => this.snap;

  /** Where refusals and endings are said. */
  setTell(tell: Tell) {
    this.tell = tell;
  }

  // ── Stream ─────────────────────────────────────────────────────────────

  /** Signed in as `userId` (or out: `null`): the stream follows. */
  signedIn(userId: string | null) {
    if (userId === this.snap.me) return;
    this.closeStream();
    if (this.snap.active) this.teardown();
    this.set({ me: userId, calls: new Map() });
    if (userId) this.openStream();
  }

  private openStream() {
    const stream = new EventSource(
      `${API_PREFIX}/calls/live?peer=${encodeURIComponent(this.snap.peerId)}`,
      { withCredentials: true },
    );
    this.source = stream;
    stream.addEventListener('call', (message) => {
      this.onEvent(JSON.parse((message as MessageEvent<string>).data) as CallEvent);
    });
    stream.addEventListener('error', () => {
      if (stream.readyState !== EventSource.CLOSED || this.source !== stream) return;
      this.timer = window.setTimeout(() => this.openStream(), RECONNECT_MS);
    });
  }

  private closeStream() {
    window.clearTimeout(this.timer);
    this.source?.close();
    this.source = null;
  }

  private onEvent(event: CallEvent) {
    switch (event.type) {
      case 'hello': {
        this.iceServers = event.iceServers;
        const calls = new Map(event.calls.map((call) => [call.id, call]));
        this.set({ calls });
        const active = this.snap.active;
        // The server forgot the call (it restarted): this tab is no longer in it.
        if (active && !calls.get(active.callId)?.peers.some((p) => p.peerId === this.snap.peerId)) {
          this.teardown();
          this.tell('Die Verbindung zum Anruf ist abgerissen.', 'danger');
        }
        break;
      }
      case 'call': {
        const before = this.snap.calls.get(event.call.id);
        const calls = new Map(this.snap.calls);
        calls.set(event.call.id, event.call);
        this.set({ calls });
        const active = this.snap.active;
        if (active?.callId !== event.call.id) break;
        const here = new Set(event.call.peers.map((peer) => peer.peerId));
        if (!here.has(this.snap.peerId)) {
          // Answered elsewhere – another tab or device of one's own took the call over.
          this.teardown();
          this.tell('Der Anruf läuft jetzt in einem anderen Fenster.');
          break;
        }
        for (const peer of before?.peers ?? []) {
          if (here.has(peer.peerId)) continue;
          this.mesh?.drop(peer.peerId);
          chime(false);
        }
        const came = event.call.peers.filter(
          (peer) =>
            peer.peerId !== this.snap.peerId &&
            !before?.peers.some((old) => old.peerId === peer.peerId),
        );
        if (came.length > 0) chime(true);
        this.listen();
        this.hear();
        break;
      }
      case 'ended': {
        const calls = new Map(this.snap.calls);
        calls.delete(event.callId);
        this.set({ calls });
        if (this.snap.active?.callId === event.callId) {
          this.teardown();
          this.tell(ENDED[event.reason]);
        }
        break;
      }
      case 'signal':
        if (this.snap.active?.callId === event.callId)
          void this.mesh?.handle(event.from, event.signal);
        break;
      case 'hush':
        // Someone talked over the agent (here or in another tab): its answer stops everywhere.
        if (this.snap.active?.callId === event.callId) {
          this.dropping = false;
          this.stopSaying();
        }
        break;
      case 'say':
        if (this.snap.active?.callId === event.callId && !this.dropping) {
          // Its audio is fetched at once – while the part before is still being read out.
          const voice = event.voice
            ? fetchVoice(
                `${API_PREFIX}/calls/${event.callId}/says/${event.sayId}?peer=${encodeURIComponent(this.snap.peerId)}`,
              )
            : null;
          this.say(event.callId, event.sayId, event.text, voice);
        }
        break;
    }
  }

  // ── A call ─────────────────────────────────────────────────────────────

  /** Starts a call in a conversation or joins the one running there (with the camera: `video`). */
  join(channelId: string, { video }: { video: boolean }) {
    if (this.snap.active?.channelId === channelId && !this.snap.active.agentId) return;
    return this.enter(channelId, `/sender/channels/${channelId}/call`, { video, agentId: null });
  }

  /** Calls a Cloud agent: it hears what one says and answers aloud. */
  callAgent(agentId: string) {
    if (this.snap.active?.agentId === agentId) return;
    return this.enter(`agent:${agentId}`, `/cloud/agents/${agentId}/call`, {
      video: false,
      agentId,
    });
  }

  private async enter(
    key: string,
    path: string,
    { video, agentId }: { video: boolean; agentId: string | null },
  ) {
    if (this.snap.joining) return;
    wakeVoice();
    this.set({ joining: key });
    try {
      if (this.snap.active) await this.leave();
      const mic = await microphone().catch((error: unknown) => {
        // Without a microphone one still hears and sees the others.
        if (error instanceof MediaRefused && error.message) this.tell(error.message, 'danger');
        return null;
      });
      const cam = video
        ? await camera().catch((error: unknown) => {
            if (error instanceof MediaRefused && error.message) this.tell(error.message, 'danger');
            return null;
          })
        : null;
      let joined: CallJoined;
      try {
        joined = await api.post<CallJoined>(
          path,
          agentId
            ? { peerId: this.snap.peerId }
            : { peerId: this.snap.peerId, video: !!cam, mic: !!mic },
        );
      } catch (error) {
        mic?.stop();
        cam?.stop();
        throw error;
      }
      this.iceServers = joined.iceServers;
      this.tracks.audio = mic;
      this.tracks.camera = cam;
      this.mesh = new Mesh({
        iceServers: this.iceServers,
        send: (to, signal) => this.signal(to, signal),
        onChange: () => this.onMesh(),
      });
      this.mesh.setTrack('audio', mic);
      this.mesh.setTrack('camera', cam);
      const calls = new Map(this.snap.calls);
      calls.set(joined.call.id, joined.call);
      this.set({
        calls,
        active: {
          callId: joined.call.id,
          channelId: joined.call.channelId,
          agentId,
          workspaceId: joined.call.workspaceId,
          since: Date.now(),
        },
        local: { mic: !!mic, camera: !!cam, screen: false },
        own: { camera: cam ? new MediaStream([cam]) : null, screen: null },
      });
      for (const peerId of joined.connectTo) this.mesh.connect(peerId);
      this.listen();
      this.hear();
    } catch (error) {
      this.tell(
        error instanceof ApiError ? error.message : 'Der Anruf ließ sich nicht starten.',
        'danger',
      );
    } finally {
      this.set({ joining: null });
    }
  }

  /** Brings a Cloud agent into this conversation's call – it answers when spoken to. */
  async bringAgent(agentId: string) {
    const active = this.snap.active;
    if (!active || active.agentId) return;
    try {
      const call = await api.post<CallState>(`/calls/${active.callId}/agent`, {
        peerId: this.snap.peerId,
        agentId,
      });
      const calls = new Map(this.snap.calls);
      calls.set(call.id, call);
      this.set({ calls });
      this.hear();
    } catch (error) {
      this.tell(
        error instanceof ApiError ? error.message : 'Der Agent ließ sich nicht dazuholen.',
        'danger',
      );
    }
  }

  /** Sends proposed work off (✓) or drops it (✕) – at once here, the server agrees. */
  answerOrder(orderId: string, send: boolean) {
    const active = this.snap.active;
    const call = active ? this.snap.calls.get(active.callId) : undefined;
    if (!active || !call) return;
    const calls = new Map(this.snap.calls);
    calls.set(call.id, {
      ...call,
      orders: send
        ? call.orders.map((order) =>
            order.id === orderId ? { ...order, state: 'running' as const } : order,
          )
        : call.orders.filter((order) => order.id !== orderId),
    });
    this.set({ calls });
    void api
      .post(`/calls/${active.callId}/orders/${orderId}`, { peerId: this.snap.peerId, send })
      .catch((error: unknown) =>
        this.tell(
          error instanceof ApiError ? error.message : 'Der Auftrag ließ sich nicht losschicken.',
          'danger',
        ),
      );
  }

  /** Sends the agent out of this conversation's call – at once here. */
  sendAgentAway() {
    const active = this.snap.active;
    const call = active ? this.snap.calls.get(active.callId) : undefined;
    if (!active || !call?.agent) return;
    const calls = new Map(this.snap.calls);
    calls.set(call.id, { ...call, agent: null });
    this.set({ calls });
    hush();
    void api
      .post(`/calls/${active.callId}/agent/leave`, { peerId: this.snap.peerId })
      .catch(() => {});
  }

  /** Hangs up – what one said last is handed over first, for the notes. */
  async leave() {
    const active = this.snap.active;
    if (!active) return;
    const listener = this.listener;
    this.listener = null;
    this.teardown();
    if (listener) {
      // Gone already for this tab, not yet for the call: a page closed meanwhile still leaves.
      this.leaving = active.callId;
      await new Promise((done) => window.setTimeout(done, 700));
      listener.finish();
      await this.lastTurn;
      if (this.leaving !== active.callId) return;
      this.leaving = null;
    }
    await api.post(`/calls/${active.callId}/leave`, { peerId: this.snap.peerId }).catch(() => {});
  }

  /** A call hung up while what was said last is still handed over (`leave`). */
  private leaving: string | null = null;

  /**
   * The tab closes or loads anew: it leaves at once, so the others do not wait for a stream the
   * server only notices gone at its next heartbeat. `keepalive` lets the request outlive the page.
   */
  goingAway() {
    const callId = this.snap.active?.callId ?? this.leaving;
    this.leaving = null;
    if (!callId) return;
    void apiRequest(`/calls/${callId}/leave`, {
      method: 'POST',
      body: { peerId: this.snap.peerId },
      keepalive: true,
    }).catch(() => {});
    this.teardown();
  }

  /** Says no to a call that rings here. */
  decline(callId: string) {
    // At once on screen; the server tells everyone else.
    const call = this.snap.calls.get(callId);
    if (call && this.snap.me) {
      const calls = new Map(this.snap.calls);
      calls.set(callId, { ...call, ringing: call.ringing.filter((id) => id !== this.snap.me) });
      this.set({ calls });
    }
    void api.post(`/calls/${callId}/decline`, {}).catch(() => {});
  }

  toggleMic() {
    const track = this.tracks.audio;
    if (!this.snap.active) return;
    if (!track) {
      void microphone()
        .then((mic) => {
          if (!this.snap.active) return mic.stop();
          this.tracks.audio = mic;
          this.mesh?.setTrack('audio', mic);
          this.media({ mic: true });
          this.listen();
          this.hear();
        })
        .catch((error: unknown) => {
          if (error instanceof MediaRefused && error.message) this.tell(error.message, 'danger');
        });
      return;
    }
    track.enabled = !this.snap.local.mic;
    this.media({ mic: track.enabled });
  }

  async toggleCamera() {
    if (!this.snap.active) return;
    if (this.snap.local.camera) {
      this.tracks.camera?.stop();
      this.tracks.camera = null;
      this.mesh?.setTrack('camera', null);
      this.set({ own: { ...this.snap.own, camera: null } });
      this.media({ camera: false });
      return;
    }
    try {
      const track = await camera();
      if (!this.snap.active) return track.stop();
      this.tracks.camera = track;
      this.mesh?.setTrack('camera', track);
      this.set({ own: { ...this.snap.own, camera: new MediaStream([track]) } });
      this.media({ camera: true });
    } catch (error) {
      if (error instanceof MediaRefused && error.message) this.tell(error.message, 'danger');
    }
  }

  async toggleScreen() {
    if (!this.snap.active) return;
    if (this.snap.local.screen) return this.stopScreen();
    try {
      const track = await screen();
      if (!this.snap.active) return track.stop();
      this.tracks.screen = track;
      // Stopped from the browser's own bar („Freigabe beenden“).
      track.addEventListener('ended', () => {
        if (this.tracks.screen === track) this.stopScreen();
      });
      this.mesh?.setTrack('screen', track);
      this.set({ own: { ...this.snap.own, screen: new MediaStream([track]) } });
      this.media({ screen: true });
    } catch (error) {
      if (error instanceof MediaRefused && error.message) this.tell(error.message, 'danger');
    }
  }

  private stopScreen() {
    this.tracks.screen?.stop();
    this.tracks.screen = null;
    this.mesh?.setTrack('screen', null);
    this.set({ own: { ...this.snap.own, screen: null } });
    this.media({ screen: false });
  }

  /** Tells everyone what is on (their tiles follow) – at once here. */
  private media(change: Partial<LocalMedia>) {
    const active = this.snap.active;
    if (!active) return;
    const local = { ...this.snap.local, ...change };
    this.set({ local });
    void api
      .post<CallState>(`/calls/${active.callId}/media`, { peerId: this.snap.peerId, ...local })
      .catch(() => {});
  }

  private signal(to: string, signal: CallSignal) {
    const active = this.snap.active;
    if (!active) return;
    void api
      .post(`/calls/${active.callId}/signal`, { from: this.snap.peerId, to, signal })
      .catch(() => {});
  }

  private onMesh() {
    if (!this.mesh) return;
    this.set({ remote: this.mesh.media() });
    this.listen();
  }

  /** Whose voices to listen to for „speaks“. */
  private listen() {
    const voices = new Map<string, MediaStream | null>();
    for (const [peerId, media] of this.snap.remote) voices.set(peerId, media.audio);
    this.levels.set(this.reuseOwnVoice(voices));
  }

  private ownVoice: MediaStream | null = null;
  /** The own voice keeps its stream object while the track stays – heard once, not anew. */
  private reuseOwnVoice(voices: Map<string, MediaStream | null>) {
    const track = this.tracks.audio;
    if (!track) {
      this.ownVoice = null;
      return voices;
    }
    if (this.ownVoice?.getAudioTracks()[0] !== track) this.ownVoice = new MediaStream([track]);
    voices.set(this.snap.peerId, this.ownVoice);
    return voices;
  }

  // ── Agents hear ────────────────────────────────────────────────────────

  private listener: CallListener | null = null;
  private loadingListener = false;
  private lastTurn: Promise<unknown> = Promise.resolve();
  /** Said once per call that nothing is written down. */
  private deafTold = false;
  private saying: Promise<void> = Promise.resolve();
  /** Parts of the agent's answers still to be read out here. */
  private toSay = 0;
  /** Parts announced so far; those up to `cutOff` were talked over and are not read out. */
  private sayCount = 0;
  private cutOff = 0;
  /** The part being read out (what was heard of the answer goes up to it). */
  private reading: string | null = null;
  /** Talked over here: parts of that answer still on their way are dropped until the server's `hush`. */
  private dropping = false;

  /**
   * Where an agent hears the call (it writes along, or it was called), this tab writes down what
   * its person says and hands it over turn by turn – loaded only then.
   */
  private hear() {
    const active = this.snap.active;
    const call = active ? this.snap.calls.get(active.callId) : undefined;
    if (!active || !call) return;
    if (!call.notes && !call.agent) {
      // The agent was sent away and nobody writes along: nothing more to write down.
      this.listener?.finish();
      this.listener = null;
      return;
    }
    if (this.listener) return this.listener.use(this.tracks.audio);
    if (this.loadingListener) return;
    this.loadingListener = true;
    const { callId } = active;
    const peerId = this.snap.peerId;
    void import('./listener')
      .then(({ CallListener }) => {
        if (this.snap.active?.callId !== callId || this.listener) return;
        this.listener = new CallListener(
          () => api.post<VoiceLive>(`/calls/${callId}/live`, { peerId }),
          (text) => {
            this.lastTurn = api
              .post(`/calls/${callId}/transcript`, {
                peerId,
                text: text.slice(0, MAX_CALL_UTTERANCE),
              })
              .catch(() => {});
          },
          (wav) => {
            // Without live words: each turn as a recording, written down on the server – one
            // after the other, so the turns stay in the order they were said.
            const form = new FormData();
            form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'turn.wav');
            this.lastTurn = this.lastTurn.then(() =>
              api
                .post(`/calls/${callId}/heard?peer=${encodeURIComponent(peerId)}`, form)
                .catch((error: unknown) => {
                  if (this.deafTold) return;
                  this.deafTold = true;
                  this.tell(
                    error instanceof ApiError && error.status === 409
                      ? `Im Anruf wird nichts mitgeschrieben. ${error.message}`
                      : 'Die Spracherkennung antwortet gerade nicht – der Anruf wird nicht mitgeschrieben.',
                    'danger',
                  );
                }),
            );
          },
          () => this.talkOver(callId),
        );
        this.listener.use(this.tracks.audio);
      })
      .catch(() => {})
      .finally(() => {
        this.loadingListener = false;
      });
  }

  /**
   * The called agent answers, part by part: read out here one after the other. One keeps being
   * heard meanwhile – talking over it stops it (`talkOver`).
   */
  private say(callId: string, sayId: string, text: string, voice: Promise<Response | null> | null) {
    const count = ++this.sayCount;
    this.toSay += 1;
    this.saying = this.saying.then(async () => {
      this.toSay -= 1;
      if (this.snap.active?.callId === callId && count > this.cutOff) {
        this.set({ saying: true });
        this.listener?.hearAgent(true);
        this.reading = sayId;
        await speak(text, voice);
      }
      if (this.toSay > 0) return;
      this.reading = null;
      this.listener?.hearAgent(false);
      if (this.snap.active?.callId === callId) this.set({ saying: false });
    });
  }

  /** What is read out and still to come stops here. */
  private stopSaying() {
    this.cutOff = this.sayCount;
    hush();
  }

  /** One talked over the agent: it stops here at once, and in every tab through the server. */
  private talkOver(callId: string) {
    if (this.snap.active?.callId !== callId || !this.snap.saying) return;
    const heard = this.reading;
    this.dropping = true;
    this.stopSaying();
    this.set({ saying: false });
    void api.post(`/calls/${callId}/hush`, { peerId: this.snap.peerId, heard }).catch(() => {
      this.dropping = false;
    });
  }

  /** Everything of this tab's call goes: tracks stop, connections close. */
  private teardown() {
    this.listener?.finish();
    this.listener = null;
    this.deafTold = false;
    hush();
    this.mesh?.close();
    this.mesh = null;
    for (const slot of ['audio', 'camera', 'screen'] as const) {
      this.tracks[slot]?.stop();
      this.tracks[slot] = null;
    }
    this.levels.close();
    this.ownVoice = null;
    this.set({
      active: null,
      local: { mic: false, camera: false, screen: false },
      own: { camera: null, screen: null },
      remote: new Map(),
      speaking: new Set(),
      saying: false,
    });
  }

  private set(change: Partial<CallsSnapshot>) {
    this.snap = { ...this.snap, ...change };
    for (const listener of this.listeners) listener();
  }
}
