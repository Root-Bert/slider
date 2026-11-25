import { Hono } from 'hono';
import { z } from 'zod';
import {
  cloudAgentAskDecision,
  cloudAgentAutoSchema,
  cloudAgentChatRefSchema,
  cloudAgentInputSchema,
  cloudAgentOrderSchema,
  cloudAgentRepeatInputSchema,
  cloudAgentShareSchema,
  cloudAgentTitleSchema,
} from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { aiLimits } from '../http/ai-limits';
import { assertWithinLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import {
  autoCloudAgent,
  createCloudAgent,
  decideCloudAgentAsk,
  deleteCloudAgent,
  getCloudAgent,
  listCloudAgents,
  messageCloudAgent,
  readCloudAgentFile,
  repeatCloudAgent,
  setCloudAgentFileAside,
  renameCloudAgent,
  shareCloudAgent,
  stopCloudAgent,
  takeCloudAgentDesk,
  takeCloudAgentFile,
  typingInCloudAgent,
} from '../services/cloud-agents';

const asideSchema = z.object({ aside: z.boolean() });

/**
 * „Agenten“ (`services/cloud-agents.ts`): one's own agents, those shared with the workspace and
 * those of an area, seen by who sees the area.
 * Members write in a shared one and open chats in it; sharing and taking over what lies on the
 * desk only for who gave the order.
 */
export function cloudAgentRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const asks = aiLimits(deps).materialQuestions;
  const TOO_MANY = 'Zu viele Aufträge auf einmal. Bitte warte einen Moment.';
  return new Hono<ViewerEnv>()
    .get('/workspaces/:id/cloud/agents', viewer, async (c) => {
      requireOwner(c.var.viewer);
      return c.json(await listCloudAgents(deps, c.var.viewer.author.id, c.req.param('id')));
    })
    .post('/workspaces/:id/cloud/agents', viewer, async (c) => {
      requireOwner(c.var.viewer);
      const { text, attachments, areaId, shared, zone, mailThreadId } = await readJson(
        c,
        cloudAgentOrderSchema,
      );
      assertWithinLimit(c, asks.hit(c.var.viewer.author.id), TOO_MANY);
      return c.json(
        await createCloudAgent(
          deps,
          c.var.viewer,
          c.req.param('id'),
          text,
          areaId ?? null,
          zone,
          undefined,
          mailThreadId,
          false,
          attachments,
          shared,
        ),
        201,
      );
    })
    .get('/cloud/agents/:agentId', viewer, async (c) => {
      requireOwner(c.var.viewer);
      return c.json(await getCloudAgent(deps, c.var.viewer.author, c.req.param('agentId')));
    })
    .post('/cloud/agents/:agentId/messages', viewer, async (c) => {
      requireOwner(c.var.viewer);
      const { text, attachments, chatId, zone, mailThreadId, replyTo } = await readJson(
        c,
        cloudAgentInputSchema,
      );
      assertWithinLimit(c, asks.hit(c.var.viewer.author.id), TOO_MANY);
      return c.json(
        await messageCloudAgent(
          deps,
          c.var.viewer,
          c.req.param('agentId'),
          text,
          chatId,
          zone,
          undefined,
          undefined,
          undefined,
          mailThreadId,
          false,
          attachments,
          [],
          replyTo,
        ),
      );
    })
    .post('/cloud/agents/:agentId/typing', viewer, async (c) => {
      requireOwner(c.var.viewer);
      const { chatId } = await readJson(c, cloudAgentChatRefSchema);
      await typingInCloudAgent(deps, c.var.viewer.author, c.req.param('agentId'), chatId);
      return c.body(null, 204);
    })
    .post('/cloud/agents/:agentId/stop', viewer, async (c) => {
      requireOwner(c.var.viewer);
      const { chatId } = cloudAgentChatRefSchema.parse(await c.req.json().catch(() => ({})));
      await stopCloudAgent(deps, c.var.viewer.author.id, c.req.param('agentId'), chatId);
      return c.body(null, 204);
    })
    .patch('/cloud/agents/:agentId', viewer, async (c) => {
      requireOwner(c.var.viewer);
      const { shared, areaId } = await readJson(c, cloudAgentShareSchema);
      await shareCloudAgent(
        deps,
        c.var.viewer.author.id,
        c.req.param('agentId'),
        shared,
        areaId ?? null,
      );
      return c.body(null, 204);
    })
    .patch('/cloud/agents/:agentId/title', viewer, async (c) => {
      requireOwner(c.var.viewer);
      const { title } = await readJson(c, cloudAgentTitleSchema);
      await renameCloudAgent(deps, c.var.viewer.author.id, c.req.param('agentId'), title);
      return c.body(null, 204);
    })
    .put('/cloud/agents/:agentId/repeat', viewer, async (c) => {
      requireOwner(c.var.viewer);
      const { repeat } = await readJson(c, cloudAgentRepeatInputSchema);
      await repeatCloudAgent(deps, c.var.viewer.author.id, c.req.param('agentId'), repeat);
      return c.json(await getCloudAgent(deps, c.var.viewer.author, c.req.param('agentId')));
    })
    .patch('/cloud/agents/:agentId/auto', viewer, async (c) => {
      requireOwner(c.var.viewer);
      const change = await readJson(c, cloudAgentAutoSchema);
      await autoCloudAgent(deps, c.var.viewer.author.id, c.req.param('agentId'), change);
      return c.json(await getCloudAgent(deps, c.var.viewer.author, c.req.param('agentId')));
    })
    .delete('/cloud/agents/:agentId', viewer, async (c) => {
      requireOwner(c.var.viewer);
      await deleteCloudAgent(deps, c.var.viewer.author.id, c.req.param('agentId'));
      return c.body(null, 204);
    })
    .get('/cloud/agents/:agentId/files/:fileId', viewer, async (c) => {
      requireOwner(c.var.viewer);
      return c.json(
        await readCloudAgentFile(
          deps,
          c.var.viewer.author.id,
          c.req.param('agentId'),
          c.req.param('fileId'),
        ),
      );
    })
    .post('/cloud/agents/:agentId/files/:fileId/take', viewer, async (c) => {
      requireOwner(c.var.viewer);
      return c.json(
        await takeCloudAgentFile(deps, c.var.viewer, c.req.param('agentId'), c.req.param('fileId')),
      );
    })
    .post('/cloud/agents/:agentId/asks/:askId', viewer, async (c) => {
      requireOwner(c.var.viewer);
      const { confirm } = await readJson(c, cloudAgentAskDecision);
      return c.json(
        await decideCloudAgentAsk(
          deps,
          c.var.viewer,
          c.req.param('agentId'),
          c.req.param('askId'),
          confirm,
        ),
      );
    })
    .post('/cloud/agents/:agentId/take', viewer, async (c) => {
      requireOwner(c.var.viewer);
      return c.json(await takeCloudAgentDesk(deps, c.var.viewer, c.req.param('agentId')));
    })
    .patch('/cloud/agents/:agentId/files/:fileId', viewer, async (c) => {
      requireOwner(c.var.viewer);
      const { aside } = await readJson(c, asideSchema);
      return c.json(
        await setCloudAgentFileAside(
          deps,
          c.var.viewer,
          c.req.param('agentId'),
          c.req.param('fileId'),
          aside,
        ),
      );
    });
}
