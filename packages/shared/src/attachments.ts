import { z } from 'zod';
import type { Author } from './model';

/*
 * Files put on what one writes – a message in Sender, an order to an agent, a question to the AI,
 * a comment, a to-do, an event's notes: pasted into the field or picked with the clip. Each goes
 * up at once (`POST /workspaces/:id/attachments`) and waits as the writer's own until what it is
 * on is sent, which takes it (`claimAttachments`); never sent, it is gone after seven days. A
 * taken one is served to the workspace's members (`GET /attachments/:id`) and read by the AI as
 * a picture or as its text.
 */

/** One file at most – what mail carries. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** A video at most – a recorded screen of five minutes is about 100 MB. */
export const MAX_VIDEO_ATTACHMENT_BYTES = 200 * 1024 * 1024;
/** Files on one message at most. */
export const MAX_ATTACHMENTS = 10;

/**
 * A file put on something written. With `nodeId` it is no file of its own but a file or folder
 * of Cloud dragged onto the field: the message points to it (`id` is the node's id too) – no
 * bytes are kept for it, nothing is copied into „Chat-Dateien“; it opens in Cloud, for whoever
 * may see it there, and the AI reads it as it is now.
 */
export const attachmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(300),
  type: z.string().max(200),
  size: z.number().int().min(0),
  nodeId: z.string().uuid().optional(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

/** A Cloud folder pointed to (`nodeId`) – its `type`. */
export const CLOUD_FOLDER_TYPE = 'inode/directory';

/** Points to a file or folder in Cloud rather than carrying a file of its own. */
export const isCloudReference = (attachment: Pick<Attachment, 'nodeId'>) => !!attachment.nodeId;

/** A Cloud file or folder as what a message points to. */
export const cloudReference = (node: {
  id: string;
  name: string;
  kind: string;
  mimeType: string | null;
  sizeBytes: number;
}): Attachment => ({
  id: node.id,
  nodeId: node.id,
  name: node.name.slice(0, 300),
  type: node.kind === 'folder' ? CLOUD_FOLDER_TYPE : (node.mimeType ?? 'application/octet-stream'),
  size: node.kind === 'folder' ? 0 : node.sizeBytes,
});

/**
 * What is sent with the words: the ids of the files put on them, in their order – an upload's,
 * or a Cloud file's or folder's to point to (`claimAttachments` tells which).
 */
export const attachmentIdsSchema = z.array(z.string().uuid()).max(MAX_ATTACHMENTS).default([]);

/** Where a file's bytes are served (under `API_PREFIX`); `download`: saved, not shown. */
export const attachmentPath = (id: string, download = false) =>
  `/attachments/${id}${download ? '?download=1' : ''}`;

/** Pictures a browser shows and the AI looks at. */
export const isPictureAttachment = (type: string) => /^image\/(png|jpeg|gif|webp)$/.test(type);

/** Videos a browser plays in the message (a recording sent in Sender). */
export const isVideoAttachment = (type: string) => /^video\/(mp4|webm)$/.test(type);

/** Sound a browser plays in the message (a voice message sent in Sender). */
export const isAudioAttachment = (type: string) => /^audio\/(mp4|x-m4a|webm|ogg|mpeg)$/.test(type);

/**
 * A part of a recorded video the AI would cut („KI-Schnitt“, `POST …/video-cuts`), in seconds –
 * and why („Pause“, „Versprecher“).
 */
export interface SuggestedVideoCut {
  start: number;
  end: number;
  why: string;
}

/** How big a file of this type may be – a video more than what mail carries. */
export const attachmentLimit = (type: string) =>
  isVideoAttachment(type) ? MAX_VIDEO_ATTACHMENT_BYTES : MAX_ATTACHMENT_BYTES;

/** The folder an area's chat puts its files into, at the area's top. */
export const CHAT_FILES_FOLDER = 'Chat-Dateien';

/** Where the AI would put a chat's file in Cloud: a folder (`parentId`) or an area's top. */
export interface SenderFileFiling {
  /** `null` with `parentId` `null`: one's own files („Meine Dateien“). */
  areaId: string | null;
  parentId: string | null;
  /** How the place reads: „Vertrieb / Angebote“. */
  place: string;
  /** Why there, a few words. */
  why: string;
}

/** A file sent in a conversation – its „Dateien“ – and where it lies in Cloud. */
export interface SenderFile {
  attachment: Attachment;
  /** Who sent it; `null` once their account is gone. */
  author: Author | null;
  messageId: string;
  createdAt: string;
  /** Its file in Cloud – an area's chat puts it there at once, elsewhere once filed. */
  node: { id: string; name: string; parentId: string | null; place: string } | null;
  /** Still to be put away (in „Chat-Dateien“ or not in Cloud yet): where the AI would put it. */
  filing: SenderFileFiling | null;
}

/** „Ablegen“ / „Verschieben“: to the place asked, or – none named – where the AI would put it. */
export const senderFilePlaceSchema = z.object({
  areaId: z.string().min(1).max(100).nullable().optional(),
  parentId: z.string().min(1).max(100).nullable().optional(),
});
export type SenderFilePlace = z.infer<typeof senderFilePlaceSchema>;
