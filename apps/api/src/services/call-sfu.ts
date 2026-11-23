import {
  AccessToken,
  RoomServiceClient,
  ServerError,
  TrackSource,
  WebhookReceiver,
} from 'livekit-server-sdk';
import type { SfuConfig } from '../config';
import type { Logger } from '../logger';

/**
 * How long a ticket holds to get into the room. LiveKit itself hands a connected tab a fresh one
 * every few minutes (10 min long), so a reconnect later in the call still works – a ticket that
 * leaked after its tab left the call is worth little, and one that is used anyway is sent out by
 * the `participant_joined` webhook (`CallHub.sfuEvent`).
 */
const TICKET_TTL_S = 10 * 60;
/** LiveKit's room API answers within this, or the step is given up (it is retried by nothing). */
const API_TIMEOUT_S = 5;
/** A call that starts asks whether LiveKit answers – within this, else the call goes browser to browser. */
const READY_TIMEOUT_MS = 2_000;
/** A LiveKit that answered is believed for this long before it is asked again. */
const READY_KEPT_MS = 30_000;
/** One that did not: calls start browser to browser without waiting for it again this long. */
const DOWN_KEPT_MS = 15_000;

/** What LiveKit says happened in a room (its webhook), as far as the calls care. */
export interface SfuEvent {
  event: 'participant_joined' | 'participant_left' | 'room_finished' | string;
  /** The room: the call's id. */
  room: string | null;
  /** The participant: the tab's id. */
  identity: string | null;
}

/**
 * The server that forwards the calls' sound and pictures (LiveKit): a ticket per tab that may be
 * in a call, and the room API that sends a tab out and closes a call's room when it is over.
 * Everything else of a call – who is in it, ringing, agents, notes – stays with `CallHub`.
 */
export interface CallSfu {
  /** What the browsers connect to (`wss://…`). */
  url: string;
  /**
   * Whether LiveKit's room API answers – asked when a call starts; a call begun while it does not
   * goes browser to browser (mesh) for its whole length, so two can still talk.
   */
  ready(): Promise<boolean>;
  /** A ticket into the call's room only, as this tab (`identity` = `peerId`): sound, camera, screen. */
  ticket(callId: string, peerId: string, name: string, userId: string): Promise<string>;
  /** The tab is out of the call: out of its room too (a page that ignores „ended“ hears nothing more). */
  sendOut(callId: string, peerId: string): void;
  /** The call is over: its room is closed, nobody stays connected. */
  close(callId: string): void;
  /** Whether the tab is connected to the call's room right now. */
  connected(callId: string, peerId: string): Promise<boolean>;
  /** A webhook from LiveKit, checked against its signature (throws when it does not match). */
  event(body: string, authorization: string | undefined): Promise<SfuEvent>;
}

const notThere = (error: unknown) =>
  error instanceof ServerError && (error.status === 404 || error.code === 'not_found');

export function livekitSfu(config: SfuConfig, log: Logger): CallSfu {
  const rooms = new RoomServiceClient(config.apiUrl, config.apiKey, config.apiSecret, {
    requestTimeout: API_TIMEOUT_S,
  });
  const receiver = new WebhookReceiver(config.apiKey, config.apiSecret);
  const quietly = (step: string, work: Promise<unknown>) =>
    void work.catch((error: unknown) => {
      if (!notThere(error)) log.warn(`Calls: LiveKit could not ${step}`, error);
    });
  let upUntil = 0;
  let downUntil = 0;
  let down = false;
  return {
    url: config.url,
    async ready() {
      if (Date.now() < upUntil) return true;
      if (Date.now() < downUntil) return false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const answered = await Promise.race([
        rooms.listRooms(['-']).then(
          () => true,
          () => false,
        ),
        new Promise<false>(
          (resolve) => (timer = setTimeout(() => resolve(false), READY_TIMEOUT_MS)),
        ),
      ]);
      clearTimeout(timer);
      if (!answered && !down)
        log.warn('Calls: LiveKit does not answer – calls go browser to browser');
      down = !answered;
      if (answered) upUntil = Date.now() + READY_KEPT_MS;
      else downUntil = Date.now() + DOWN_KEPT_MS;
      return answered;
    },
    async ticket(callId, peerId, name, userId) {
      const token = new AccessToken(config.apiKey, config.apiSecret, {
        identity: peerId,
        name,
        ttl: TICKET_TTL_S,
        // Who the tab belongs to, for LiveKit's own logs – the calls go by the tab's id.
        attributes: { userId },
      });
      token.addGrant({
        roomJoin: true,
        room: callId,
        canSubscribe: true,
        canPublish: true,
        canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA, TrackSource.SCREEN_SHARE],
        canPublishData: false,
        canUpdateOwnMetadata: false,
      });
      return token.toJwt();
    },
    sendOut(callId, peerId) {
      quietly('send a tab out', rooms.removeParticipant(callId, peerId));
    },
    close(callId) {
      quietly('close a room', rooms.deleteRoom(callId));
    },
    async connected(callId, peerId) {
      try {
        await rooms.getParticipant(callId, peerId);
        return true;
      } catch (error) {
        if (notThere(error)) return false;
        throw error;
      }
    },
    async event(body, authorization) {
      const event = await receiver.receive(body, authorization);
      return {
        event: event.event,
        room: event.room?.name ?? null,
        identity: event.participant?.identity ?? null,
      };
    },
  };
}
