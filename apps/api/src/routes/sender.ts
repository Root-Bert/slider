import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import {
  senderAddAgentSchema,
  senderCreateChannelSchema,
  senderCreateDirectSchema,
  senderCreateGroupSchema,
  senderEditSchema,
  pushSubscriptionSchema,
  senderMuteSchema,
  senderReactSchema,
  senderPinSchema,
  senderPostSchema,
  senderReadSchema,
  senderTriageReadSchema,
  senderUpdateChannelSchema,
  type AccountAuthor,
  senderFilePlaceSchema,
} from '@slider/shared';
import { requireOwner } from '../auth/access';
import { resolveViewer, viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';
import { assertWithinLimit, fixedWindow } from '../http/rate-limit';
import { readJson } from '../http/validate';
import {
  addChannelAgent,
  addToGroup,
  createChannel,
  createGroup,
  deleteChannel,
  deleteMessage,
  editMessage,
  leaveGroup,
  listMessages,
  openDirect,
  postMessage,
  removeChannelAgent,
  muteChannel,
  reactToMessage,
  readChannel,
  markUnread,
  removeFromGroup,
  seesSender,
  senderHome,
  searchMessages,
  senderLive,
  typingIn,
  updateChannel,
  seenChannel,
} from '../services/sender';
import { fileSenderFile, folderFilings, listSenderFiles } from '../services/sender-files';
import { senderSummary, senderUnread } from '../services/sender-news';
import { readTriage, senderTriage } from '../services/sender-triage';
import { pinSender } from '../services/sender-pins';
import { subscribePush, unsubscribePush, vapidOf } from '../services/web-push';

const HEARTBEAT_MS = 25_000;
/**
 * How long a live stream trusts its last access check: an event after that is held until the
 * caller is checked again – someone taken out of the workspace hears nothing more within seconds.
 */
const ACCESS_CHECK_MS = 5_000;
const SENDER_EVENT = 'sender';
const addSchema = z.object({ userIds: z.array(z.string().min(1)).min(1).max(50) });

/**
 * „Sender“ (`services/sender.ts`): the workspace's conversations – areas' channels, groups,
 * direct ones – and its agents as conversations of their own. Account members only.
 */
export function senderRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const me = (c: { var: ViewerEnv['Variables'] }) => {
    requireOwner(c.var.viewer);
    return c.var.viewer.author as AccountAuthor;
  };
  // Far above what a person types, far below a script flooding a conversation.
  const writes = fixedWindow({ limit: 120, windowMs: 60 * 1000, clock: deps.clock });
  const opened = fixedWindow({ limit: 60, windowMs: 60 * 60 * 1000, clock: deps.clock });
  const typed = fixedWindow({ limit: 60, windowMs: 60 * 1000, clock: deps.clock });
  type Ctx = Parameters<typeof assertWithinLimit>[0];
  const limitWrites = (c: Ctx, userId: string) =>
    assertWithinLimit(
      c,
      writes.hit(userId),
      'Zu viele Nachrichten auf einmal. Bitte warte ein wenig.',
    );
  const limitOpened = (c: Ctx, userId: string) =>
    assertWithinLimit(
      c,
      opened.hit(userId),
      'Zu viele neue Unterhaltungen auf einmal. Bitte warte ein wenig.',
    );
  return new Hono<ViewerEnv>()
    .get('/workspaces/:id/sender', viewer, async (c) =>
      c.json(await senderHome(deps, me(c).id, c.req.param('id'))),
    )
    /** The side bar's search: messages with these words in every conversation the caller sees. */
    .get('/workspaces/:id/sender/search', viewer, async (c) =>
      c.json(
        await searchMessages(
          deps,
          me(c).id,
          c.req.param('id'),
          (c.req.query('q') ?? '').slice(0, 200),
        ),
      ),
    )
    /** Sender's start: what is unread where the caller reads, and the AI's summary of it. */
    .get('/workspaces/:id/sender/unread', viewer, async (c) =>
      c.json(await senderUnread(deps, me(c).id, c.req.param('id'))),
    )
    /** The start as a to-do list: grouped at once (`ai=0`), or sorted and told by the AI. */
    .get('/workspaces/:id/sender/triage', viewer, async (c) => {
      const author = me(c);
      return c.json(
        await senderTriage(deps, author.id, c.req.param('id'), author.name, {
          mailbox: c.req.query('mailbox') || undefined,
          ai: c.req.query('ai') === '1',
        }),
      );
    })
    .post('/workspaces/:id/sender/triage/read', viewer, async (c) => {
      const input = await readJson(c, senderTriageReadSchema);
      await readTriage(deps, me(c).id, c.req.param('id'), input);
      return c.body(null, 204);
    })
    .get('/workspaces/:id/sender/summary', viewer, async (c) => {
      const author = me(c);
      return c.json(await senderSummary(deps, author.id, c.req.param('id'), author.name));
    })
    .post('/workspaces/:id/sender/channels', viewer, async (c) => {
      const input = await readJson(c, senderCreateChannelSchema);
      limitOpened(c, me(c).id);
      return c.json(await createChannel(deps, me(c).id, c.req.param('id'), input), 201);
    })
    .post('/workspaces/:id/sender/groups', viewer, async (c) => {
      const input = await readJson(c, senderCreateGroupSchema);
      limitOpened(c, me(c).id);
      return c.json(await createGroup(deps, me(c).id, c.req.param('id'), input), 201);
    })
    .post('/workspaces/:id/sender/direct', viewer, async (c) => {
      const { userId } = await readJson(c, senderCreateDirectSchema);
      limitOpened(c, me(c).id);
      return c.json(await openDirect(deps, me(c).id, c.req.param('id'), userId));
    })
    .get('/sender/channels/:channelId/messages', viewer, async (c) => {
      const raw = c.req.query('before');
      const before = raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
      return c.json(await listMessages(deps, me(c).id, c.req.param('channelId'), before));
    })
    .post('/sender/channels/:channelId/messages', viewer, async (c) => {
      const { text, attachments, replyTo } = await readJson(c, senderPostSchema);
      limitWrites(c, me(c).id);
      return c.json(
        await postMessage(
          deps,
          me(c).id,
          c.req.param('channelId'),
          text,
          c.var.viewer,
          attachments,
          replyTo,
        ),
        201,
      );
    })
    /** A conversation's „Dateien“, newest first, with where each lies in Cloud. */
    .get('/sender/channels/:channelId/files', viewer, async (c) => {
      const row = await seenChannel(deps, me(c).id, c.req.param('channelId'));
      return c.json(await listSenderFiles(deps, me(c).id, row));
    })
    /** „Verschieben“ / „Ablegen“: a chat's file to a place, or where the AI would put it. */
    .post('/sender/files/:attachmentId/place', viewer, async (c) => {
      const input = await readJson(c, senderFilePlaceSchema);
      const userId = me(c).id;
      return c.json(
        await fileSenderFile(deps, userId, c.req.param('attachmentId'), input, (channelId) =>
          seenChannel(deps, userId, channelId),
        ),
      );
    })
    /** A Cloud „Chat-Dateien“ folder's files with where the AI would put each. */
    .get('/cloud/folders/:folderId/filing', viewer, async (c) =>
      c.json(await folderFilings(deps, me(c).id, c.req.param('folderId'))),
    )
    .patch('/sender/channels/:channelId', viewer, async (c) => {
      const input = await readJson(c, senderUpdateChannelSchema);
      return c.json(await updateChannel(deps, me(c).id, c.req.param('channelId'), input));
    })
    .delete('/sender/channels/:channelId', viewer, async (c) => {
      await deleteChannel(deps, me(c).id, c.req.param('channelId'));
      return c.body(null, 204);
    })
    .post('/sender/channels/:channelId/agents', viewer, async (c) => {
      const { agentId } = await readJson(c, senderAddAgentSchema);
      me(c);
      return c.json(await addChannelAgent(deps, c.var.viewer, c.req.param('channelId'), agentId));
    })
    .delete('/sender/channels/:channelId/agents/:agentId', viewer, async (c) =>
      c.json(
        await removeChannelAgent(deps, me(c).id, c.req.param('channelId'), c.req.param('agentId')),
      ),
    )
    .post('/sender/channels/:channelId/members', viewer, async (c) => {
      const { userIds } = await readJson(c, addSchema);
      return c.json(await addToGroup(deps, me(c).id, c.req.param('channelId'), userIds));
    })
    .delete('/sender/channels/:channelId/members/me', viewer, async (c) => {
      await leaveGroup(deps, me(c).id, c.req.param('channelId'));
      return c.body(null, 204);
    })
    /** „Entfernen“: someone out of a group, by who manages it. */
    .delete('/sender/channels/:channelId/members/:userId', viewer, async (c) =>
      c.json(
        await removeFromGroup(deps, me(c).id, c.req.param('channelId'), c.req.param('userId')),
      ),
    )
    /** „Als ungelesen markieren“: its last message new again, for the caller. */
    .put('/sender/channels/:channelId/unread', viewer, async (c) => {
      await markUnread(deps, me(c).id, c.req.param('channelId'));
      return c.body(null, 204);
    })
    .post('/sender/channels/:channelId/read', viewer, async (c) => {
      const { seq } = await readJson(c, senderReadSchema);
      await readChannel(deps, me(c).id, c.req.param('channelId'), seq);
      return c.body(null, 204);
    })
    /** Web Push: the server's key, and a browser that lets the caller be told or no longer. */
    .get('/push/key', viewer, (c) => c.json({ publicKey: vapidOf(deps.config.secret).publicKey }))
    .put('/push/subscription', viewer, async (c) => {
      await subscribePush(deps, me(c).id, await readJson(c, pushSubscriptionSchema));
      return c.body(null, 204);
    })
    .delete('/push/subscription', viewer, async (c) => {
      const { endpoint } = await readJson(c, pushSubscriptionSchema.pick({ endpoint: true }));
      await unsubscribePush(deps, me(c).id, endpoint);
      return c.body(null, 204);
    })
    /** „Stummschalten“ / „Laut schalten“ a conversation, for the caller alone. */
    .put('/sender/channels/:channelId/muted', viewer, async (c) => {
      const { muted } = await readJson(c, senderMuteSchema);
      return c.json(await muteChannel(deps, me(c).id, c.req.param('channelId'), muted));
    })
    /** „Anpinnen“ / „Lösen“ a chat or a mail the caller sees, for them alone. */
    .post('/sender/pins', viewer, async (c) => {
      const input = await readJson(c, senderPinSchema);
      return c.json(await pinSender(deps, me(c).id, input));
    })
    .post('/sender/channels/:channelId/typing', viewer, async (c) => {
      // Past the limit it is simply not passed on: nobody waits for it.
      if (typed.hit(me(c).id).allowed) await typingIn(deps, me(c), c.req.param('channelId'));
      return c.body(null, 204);
    })
    .patch('/sender/messages/:messageId', viewer, async (c) => {
      const { text } = await readJson(c, senderEditSchema);
      limitWrites(c, me(c).id);
      return c.json(await editMessage(deps, me(c).id, c.req.param('messageId'), text));
    })
    /** 👍 / 👎 / egal on a message, or taken back (`kind: null`). */
    .put('/sender/messages/:messageId/reaction', viewer, async (c) => {
      const { kind } = await readJson(c, senderReactSchema);
      limitWrites(c, me(c).id);
      return c.json(await reactToMessage(deps, me(c).id, c.req.param('messageId'), kind));
    })
    .delete('/sender/messages/:messageId', viewer, async (c) =>
      c.json(await deleteMessage(deps, me(c).id, c.req.param('messageId'))),
    )
    /** What is said in the workspace's conversations the caller sees, while Sender is open. */
    .get('/workspaces/:id/sender/live', viewer, async (c) => {
      const userId = me(c).id;
      const workspaceId = c.req.param('id');
      await seesSender(deps, userId, workspaceId);
      c.header('X-Accel-Buffering', 'no');
      const stillAllowed = async () => {
        try {
          const current = await resolveViewer(c, deps, { readOnly: true });
          if (current?.author.id !== userId) return false;
          await seesSender(deps, userId, workspaceId);
          return true;
        } catch (error) {
          // Not known to be allowed is not allowed: the stream ends, the page opens it anew.
          if (!(error instanceof ApiError)) {
            deps.log.warn(`Live access check for Sender ${workspaceId} failed`, error);
          }
          return false;
        }
      };
      return streamSSE(c, async (stream) => {
        const open = () => !stream.aborted && !stream.closed;
        const now = () => deps.clock.now().getTime();
        let checkedAt = now();
        let checking: Promise<boolean> | null = null;
        /** Still allowed – checked again once the last check is older than `ACCESS_CHECK_MS`. */
        const allowed = async () => {
          if (now() - checkedAt < ACCESS_CHECK_MS) return true;
          checking ??= stillAllowed().finally(() => {
            checking = null;
          });
          const yes = await checking;
          if (yes) checkedAt = now();
          return yes;
        };
        let leave = () => {};
        // The wait between pings, cut short once the stream ends.
        let wake = () => {};
        const nap = () =>
          new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, HEARTBEAT_MS);
            wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
        const end = () => {
          leave();
          wake();
          void stream.close().catch(() => {});
        };
        // One after the other, in order, each only to someone who may still hear it.
        let queue = Promise.resolve();
        leave = senderLive.join(workspaceId, userId, (event) => {
          queue = queue
            .then(async () => {
              if (!open()) return;
              if (!(await allowed())) return end();
              await stream.writeSSE({ event: SENDER_EVENT, data: JSON.stringify(event) });
            })
            .catch(() => {});
        });
        stream.onAbort(() => {
          leave();
          wake();
        });
        try {
          await stream.write(': open\n\n');
          while (open()) {
            await nap();
            if (!open()) break;
            if (!(await allowed())) break;
            await stream.write(': ping\n\n');
          }
        } finally {
          leave();
        }
      });
    });
}
