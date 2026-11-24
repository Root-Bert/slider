import { z } from 'zod';
import type { AccountAuthor, Author } from './model';
import type { SenderChannelKind } from './sender';

/*
 * Calls: talking, seeing each other and showing one's screen in a conversation of Sender – a
 * direct one, a group or an area's channel (a meeting). The browsers send their sound and
 * pictures to each other (WebRTC, each to each); the server only says who is in a call and
 * passes on what the browsers tell each other to find a way (`signal`). Where the server has a
 * LiveKit SFU (`CallJoined.sfu`), each browser sends to it instead and it forwards – the server
 * still says who is in which call; LiveKit carries only sound and pictures. A call follows its
 * person through the whole app: it rings and goes on in every page, whichever app is open.
 *
 * Agents take part by ear: each tab writes down what its own person says (live, in the browser)
 * and hands it to the server. A Cloud agent can be called – what one says goes into its chat, its
 * answer is read out in the tabs. And in every call of a conversation an agent writes along
 * (`notes`, the workspace may turn it off): after the call it sends notes and tasks there.
 */

/**
 * People in one call at most where the browsers send to each other (mesh): each sends to each, so
 * more would ask too much of a line.
 */
export const MAX_CALL_PEERS = 8;
/**
 * People in one call at most where the server forwards sound and pictures (LiveKit, `CallJoined.sfu`):
 * each browser sends once, and receives only the tiles it shows (simulcast, adaptive stream) – the
 * room a 4-core server with LiveKit on two cores carries beside the rest.
 */
export const MAX_SFU_CALL_PEERS = 50;
/** How long a call rings at someone who neither answers nor declines. */
export const CALL_RING_MS = 45_000;

/** One browser tab in a call. A person has one tab in a call at a time. */
export interface CallPeer {
  /** The tab's own id (made in the browser) – signals are addressed to it. */
  peerId: string;
  author: AccountAuthor;
  mic: boolean;
  camera: boolean;
  screen: boolean;
  joinedAt: string;
}

/** A Cloud agent one talks to in a call. */
export interface CallAgent {
  id: string;
  title: string;
  /** Listening, working on what was said (`doing` says what), or speaking its answer. */
  state: 'listening' | 'thinking' | 'speaking';
  doing: string | null;
  /**
   * Who brought it into a conversation's call – it works with their rights and answers when
   * someone speaks to it („Agent, …“). `null`: the call is one's own with the agent, it hears all.
   */
  invitedBy: AccountAuthor | null;
}

/**
 * Work the agent in a call proposed for an agent of its own (it does not do it in the call). It is
 * sent only once someone in the call agrees – said („ja, schick los“) or with its ✓ – and runs as
 * a Cloud agent with that person's rights; the call shows how far it got.
 */
export interface CallOrder {
  id: string;
  /** A few words, as the agent named it. */
  title: string;
  /** The whole order, as the new agent gets it. */
  text: string;
  /** Listed („Vorgemerkt“, sent on ✓ or „Schick … los“), sent and running, done, or not sent. */
  state: 'proposed' | 'running' | 'done' | 'failed';
  /** The Cloud agent working on it, once sent. */
  agentId: string | null;
  /** Who sent it – it works with their rights. */
  sentBy: AccountAuthor | null;
  /** What its agent does right now, while it runs. */
  doing: string | null;
  /** Why it could not be sent. */
  error: string | null;
}

/** Most orders one call proposes. */
export const MAX_CALL_ORDERS = 20;

/** How one speaks to an agent in a conversation's call: „Agent, …“ (also „Agentin“). */
export const CALL_AGENT_ADDRESS = /\bagent(in)?\b/i;

/**
 * Which agent may be brought into a conversation's call – what it hears stands in its chat: one's
 * own private agent, or one of the area whose conversation it is (its chat is read there anyway).
 */
export const bringsIntoCall = (
  agent: { mine: boolean; shared: boolean; areaId: string | null },
  callAreaId: string | null,
): boolean => (agent.mine && !agent.shared) || (!!agent.areaId && agent.areaId === callAreaId);

/** A call as everyone who sees its conversation sees it. */
export interface CallState {
  id: string;
  workspaceId: string;
  channelId: string;
  /** The conversation's area (an area's channels); `null` for groups and direct ones. */
  areaId: string | null;
  /** The conversation's kind: a direct one or a group rings, a channel's call is a meeting one joins. */
  kind: SenderChannelKind;
  /**
   * As shown: the area's name, „#channel“, the group's name. Empty for a direct conversation – the
   * other one of `people` is its name.
   */
  title: string;
  /** The two of a direct conversation, the people of a group; empty for an area's channels. */
  people: AccountAuthor[];
  startedBy: AccountAuthor;
  startedAt: string;
  /** Started with pictures: who is rung answers with the camera on. */
  video: boolean;
  peers: CallPeer[];
  /** People it rings at right now (user ids). */
  ringing: string[];
  /** An agent writes along and sends notes and tasks into the conversation afterwards. */
  notes: boolean;
  /**
   * A Cloud agent in the call: one called (`channelId` empty, all that is said goes into its
   * chat), or one brought into a conversation's call (`invitedBy`, answers when spoken to).
   */
  agent: CallAgent | null;
  /** Work the agent proposed and what was sent of it, oldest first (dropped ones go). */
  orders: CallOrder[];
}

/** Why a call is over, said to who is still there. */
export type CallEndReason = 'empty' | 'declined' | 'unanswered';

/** What a browser tells another one to connect (WebRTC), passed on as it is. */
export type CallSignal =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'candidate'; candidate: RTCIceCandidateInitLike | null };

/** `RTCIceCandidateInit` without the DOM's types (the server has none). */
export interface RTCIceCandidateInitLike {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

/** `RTCIceServer` without the DOM's types. */
export interface CallIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** What the call stream of a tab says. */
export type CallEvent =
  /** On (re)connecting: every call the person sees, and how to reach the others. */
  | { type: 'hello'; calls: CallState[]; iceServers: CallIceServer[] }
  /** A call began or changed (someone came, went, was rung, turned the camera on …). */
  | { type: 'call'; call: CallState }
  | { type: 'ended'; callId: string; channelId: string; reason: CallEndReason }
  | { type: 'signal'; callId: string; from: string; signal: CallSignal }
  /** The call's agent answers: each tab of the call reads it out. */
  /**
   * The agent answers: `text` read out in every tab of the call – in its own voice
   * (`GET /calls/:id/says/:sayId`) where `voice`, else by the browser.
   */
  | { type: 'say'; callId: string; text: string; sayId: string; voice: boolean }
  /** Someone talked over the agent: every tab stops reading out its answer. */
  | { type: 'hush'; callId: string };

/**
 * Where the server forwards the media (a LiveKit SFU): the room's address and this tab's ticket –
 * the room is the call, the tab its participant (`identity` = `peerId`).
 */
export interface CallSfu {
  /** `wss://…` of LiveKit. */
  url: string;
  /** Access token for this call's room only; short-lived (LiveKit renews it while connected). */
  token: string;
}

/** The answer to starting or joining: the call, and whom the new tab connects to itself. */
export interface CallJoined {
  call: CallState;
  /** The tabs that were there before – the newcomer offers to each (mesh only). */
  connectTo: string[];
  iceServers: CallIceServer[];
  /** Set where the server forwards the media: the tab joins this room instead of the mesh. */
  sfu: CallSfu | null;
}

const peerIdSchema = z.string().regex(/^[\w-]{8,64}$/, 'Ungültige Tab-Kennung.');

export const callJoinSchema = z.object({
  peerId: peerIdSchema,
  video: z.boolean().default(false),
  mic: z.boolean().default(true),
});
export type CallJoin = z.input<typeof callJoinSchema>;

export const callLeaveSchema = z.object({ peerId: peerIdSchema });
/** Calling a Cloud agent, leaving, asking for the live writing's token: the tab. */
export const callPeerSchema = callLeaveSchema;

/** Bringing a Cloud agent into a conversation's call – `null`: a new one, made for the call. */
export const callAgentInviteSchema = z.object({
  peerId: peerIdSchema,
  agentId: z.string().min(1).nullable(),
});

/** Ringing a member of the workspace into a conversation's call (a guest of the call). */
export const callPersonInviteSchema = z.object({
  peerId: peerIdSchema,
  userId: z.string().min(1),
});

/** Agreeing to proposed work in a call (its ✓), or dropping it (✕). */
export const callOrderAnswerSchema = z.object({
  peerId: peerIdSchema,
  send: z.boolean(),
});

/** Most of what one turn of speaking hands over at once. */
export const MAX_CALL_UTTERANCE = 4000;
/** What a tab heard its person say – one turn of speaking. */
/** One talked over the agent: `heard`, the part of its answer this tab was reading out. */
export const callHushSchema = z.object({
  peerId: peerIdSchema,
  heard: z.string().max(64).nullable(),
});

export const callTranscriptSchema = z.object({
  peerId: peerIdSchema,
  text: z.string().trim().min(1).max(MAX_CALL_UTTERANCE),
});

export const callMediaSchema = z.object({
  peerId: peerIdSchema,
  mic: z.boolean(),
  camera: z.boolean(),
  screen: z.boolean(),
});
export type CallMedia = z.input<typeof callMediaSchema>;

const sdpSchema = z.string().min(1).max(64_000);
export const callSignalSchema = z.object({
  from: peerIdSchema,
  to: peerIdSchema,
  signal: z.discriminatedUnion('type', [
    z.object({ type: z.literal('offer'), sdp: sdpSchema }),
    z.object({ type: z.literal('answer'), sdp: sdpSchema }),
    z.object({
      type: z.literal('candidate'),
      candidate: z
        .object({
          candidate: z.string().max(2000).optional(),
          sdpMid: z.string().max(64).nullable().optional(),
          sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
          usernameFragment: z.string().max(256).nullable().optional(),
        })
        .nullable(),
    }),
  ]),
});

export { peerIdSchema as callPeerIdSchema };

// ── A call that is over ─────────────────────────────────────────────────────

/**
 * One turn of a call that is over, as it was written down (`call_records`): a person's – their id
 * among the call's `people` – or the agent's (`userId` null, `name` its name).
 */
export interface CallRecordLine {
  userId: string | null;
  name: string;
  text: string;
  at: string;
}

/** What was sent to an agent during the call. */
export interface CallRecordOrder {
  title: string;
  state: CallOrder['state'];
  /** The Cloud agent working on it. */
  agentId: string | null;
  /** Who sent it (their name). */
  sentBy: string | null;
}

/**
 * Something the call was about, linked: what was sent to an agent during it (`order`), where it
 * took place (`place`), or what the talk named and lies in the workspace (`named`) – shown only
 * to who may open it.
 */
export interface CallRecordLink {
  kind: 'file' | 'folder' | 'area' | 'presentation' | 'agent';
  id: string;
  name: string;
  why: 'order' | 'place' | 'named';
}

/** What the AI wrote once after the call: the summary and what came of it. */
export interface CallRecordNotes {
  summary: string;
  /** What was decided or concluded. */
  decisions: string[];
  /** Who does what – `who` the person's name where it is clear. */
  todos: { text: string; who: string | null }[];
  /** Questions that stayed open. */
  open: string[];
  links: CallRecordLink[];
}

/** `pending`: written in the background (or asked on opening); `none`: no AI to write them. */
export type CallRecordNotesState = 'pending' | 'done' | 'failed' | 'none';

/** A call that is over, as its page shows it (`GET /calls/:id/record`). */
export interface CallRecord {
  id: string;
  workspaceId: string;
  /** The conversation it took place in; `null` for one's own call with an agent. */
  channelId: string | null;
  /** The agent one called (its chat holds the call); `null` in a conversation's call. */
  agentId: string | null;
  areaId: string | null;
  kind: SenderChannelKind;
  /** The conversation's or the agent's name. */
  title: string;
  startedBy: Author | null;
  startedAt: string;
  endedAt: string;
  /** Everyone who was in it, in the order they came. */
  people: Author[];
  lines: CallRecordLine[];
  orders: CallRecordOrder[];
  notes: CallRecordNotes | null;
  notesState: CallRecordNotesState;
}

/** A call as it stands in a chat: one entry, its page opened from it. */
export interface CallBrief {
  id: string;
  startedAt: string;
  endedAt: string;
  people: Author[];
  /** The first words of its summary, once written. */
  summary: string | null;
}
