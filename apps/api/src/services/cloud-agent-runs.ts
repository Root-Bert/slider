/**
 * The agents at work right now – in memory only: a server that starts anew has none running.
 * Apart from `cloud-agents.ts`, so the files can ask who is at work without knowing the agents.
 */
import type { Attachment, CallModel, Viewer } from '@slider/shared';

/** A message written while the agent worked: kept in the chat at once, taken up by it next. */
export interface Waiting {
  /** Its message's id in the chat. */
  id: string;
  viewer: Viewer;
  text: string;
  zone: string | undefined;
  /**
   * Set by the agent itself – a repeated order or what it watches – with nobody's message to
   * answer: it may run on what others did, so it keeps to what is open to many.
   */
  unattended?: boolean;
  /**
   * Words that are not the person's own, though sent as them: a to-do's (others may write it) or
   * an app's order. Its run does the work, but never with their mail, their connections or what
   * only a person's own message opens (`ASKED_ONLY` in `cloud-agents.ts`) – for the whole run.
   */
  foreign?: boolean;
  /**
   * Written by the server for others' words (a call's notes): its run may only post into this
   * conversation – nothing in those words is anyone's order to it.
   */
  confined?: string;
  /**
   * The conversation it was tagged in (`@Agent`, `callAgent` in `sender.ts`): its run starts
   * without the chat's talk before – what was said there goes along in the message, and nothing
   * said elsewhere reaches that conversation.
   */
  tag?: string;
  /**
   * What the agent is told for it, where that is more than the person wrote (a tag's briefing:
   * where, how to answer, the lines before) – the chat keeps only `text`, their own words.
   */
  prompt?: string;
  /** „Antworten“: the message of the chat it answers (kept with it; quoted in `prompt`). */
  replyTo?: string;
  /**
   * A call's turn (`CallHub`): the model the workspace picked for its agent to think on
   * (`callModelConnection`) – for the run it begins; unset, the review model.
   */
  model?: CallModel;
  /** Files the person put on it: taken as it is kept (`attachments`), read by the agent. */
  attachmentIds?: readonly string[];
  attachments?: Attachment[];
}

export interface Run {
  agentId: string;
  userId: string;
  controller: AbortController;
  /** When this piece of work began: what it touches from then on it is at work on. */
  since: Date;
  doing: string | null;
  /** That happens in Slider. */
  doingIn: 'slider' | null;
  text: string;
  /** Written meanwhile, oldest first. */
  waiting: Waiting[];
}
/** By chat: each of an agent's chats works by itself. */
export const runs = new Map<string, Run>();
export const runsOf = (agentId: string) =>
  [...runs.values()].filter((run) => run.agentId === agentId);

/**
 * The run of a tag (`Waiting.tag`): the agent's for that conversation, apart from its chats –
 * nothing of it is kept but what it posts there (`post_message`).
 */
export const tagChatId = (agentId: string, channelId: string) => `${agentId}:${channelId}`;
