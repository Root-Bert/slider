import { and, asc, eq, inArray, lt, lte, ne } from 'drizzle-orm';
import { MAX_SCHEDULE_DAYS, type Attachment, type SenderScheduled } from '@slider/shared';
import { ownerAuthor } from '../authors';
import {
  attachments as attachmentRows,
  cloudAgents,
  senderMessages,
  senderScheduled,
  users,
  type SenderScheduledRow,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest, notFound } from '../http/errors';
import { claimAttachments } from './attachments';
import { checkPost, postAsAgent, postMessage, seenChannel, senderLive } from './sender';

/*
 * „Später senden“ (a right click on „Senden“; an agent's or app's `post_message` with a time): a
 * message kept apart from the conversation until it is due, seen by who planned it alone. Due, it
 * is posted as if sent that moment – `postMessage` (or `postAsAgent`) checks everything again and
 * starts the agents named in it. Refused, it stays with why („Nicht gesendet: …“) until sent again
 * or deleted. Its files are taken while it waits, so the sweep of unsent ones leaves them. Posted,
 * the message takes its id: one out already (the server stopped before the plan went) is never
 * sent twice, nor its files – now the message's – freed by a „Löschen“.
 */

const scheduledNotFound = () => notFound('Diese geplante Nachricht gibt es nicht (mehr).');

/** Sent but never told back (the server stopped meanwhile): said so after this long. */
const STUCK_MS = 5 * 60_000;

/** Out already: the message posted under its id. */
async function posted(deps: AppDeps, id: string): Promise<boolean> {
  const [hit] = await deps.db
    .select({ id: senderMessages.id })
    .from(senderMessages)
    .where(eq(senderMessages.id, id));
  return Boolean(hit);
}

/** When it goes: later than now, at most a year ahead. */
function sendTime(deps: AppDeps, sendAt: string): Date {
  const at = new Date(sendAt);
  const now = deps.clock.now().getTime();
  if (Number.isNaN(at.getTime())) throw badRequest('Diesen Zeitpunkt gibt es nicht.');
  if (at.getTime() <= now) throw badRequest('Dieser Zeitpunkt ist schon vorbei.');
  if (at.getTime() > now + MAX_SCHEDULE_DAYS * 86_400_000)
    throw badRequest('Höchstens ein Jahr im Voraus.');
  return at;
}

/** Who planned it hears of it (their open tabs fetch the line above the field anew). */
function tell(row: Pick<SenderScheduledRow, 'workspaceId' | 'userId' | 'channelId'>) {
  senderLive.publish(row.workspaceId, new Set([row.userId]), {
    type: 'scheduled',
    channelId: row.channelId,
  });
}

async function toScheduled(deps: AppDeps, rows: SenderScheduledRow[]): Promise<SenderScheduled[]> {
  const agentIds = [...new Set(rows.map((row) => row.agentId).filter(Boolean))] as string[];
  const agents = agentIds.length
    ? await deps.db
        .select({ id: cloudAgents.id, title: cloudAgents.title })
        .from(cloudAgents)
        .where(inArray(cloudAgents.id, agentIds))
    : [];
  return rows.map((row) => {
    const agent = agents.find((one) => one.id === row.agentId);
    return {
      id: row.id,
      channelId: row.channelId,
      text: row.text,
      attachments: row.attachments,
      replyTo: row.replyTo,
      sendAt: row.sendAt.toISOString(),
      state: row.state,
      error: row.error,
      agent: row.agentId ? { id: row.agentId, title: agent?.title || 'Agent' } : null,
    };
  });
}

/**
 * Its files free again – to be posted with it, or put back into the field. Free from now: the
 * week files never sent are kept (`sweepAttachments`) counts anew, not from when they went up.
 */
async function release(deps: AppDeps, row: SenderScheduledRow) {
  const ids = row.attachments.map((one) => one.id);
  if (!ids.length) return;
  await deps.db
    .update(attachmentRows)
    .set({ takenAt: null, createdAt: deps.clock.now() })
    .where(and(inArray(attachmentRows.id, ids), eq(attachmentRows.userId, row.userId)));
}

/** Its files taken again while it waits (after a refused send). */
async function retake(deps: AppDeps, row: SenderScheduledRow) {
  const ids = row.attachments.map((one) => one.id);
  if (!ids.length) return;
  await deps.db
    .update(attachmentRows)
    .set({ takenAt: deps.clock.now() })
    .where(and(inArray(attachmentRows.id, ids), eq(attachmentRows.userId, row.userId)));
}

/**
 * Plans a message: checked as if sent now, its files taken. `agent`: one's agent plans it, to go
 * in its name (words only, as an agent's messages).
 */
export async function scheduleMessage(
  deps: AppDeps,
  userId: string,
  channelId: string,
  input: { text: string; attachments?: readonly string[]; replyTo?: string; sendAt: string },
  agent?: { id: string },
): Promise<SenderScheduled> {
  const text = input.text.trim();
  const wanted = agent ? [] : (input.attachments ?? []);
  if (!text && wanted.length === 0) throw badRequest('Schreib etwas.');
  const { row: channel } = await checkPost(deps, userId, channelId, input.replyTo);
  const sendAt = sendTime(deps, input.sendAt);
  const now = deps.clock.now();
  const files: Attachment[] = await claimAttachments(
    deps.db,
    now,
    userId,
    channel.workspaceId,
    wanted,
  );
  const [row] = await deps.db
    .insert(senderScheduled)
    .values({
      id: crypto.randomUUID(),
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      userId,
      agentId: agent?.id ?? null,
      text,
      attachments: files,
      replyTo: input.replyTo ?? null,
      sendAt,
      createdAt: now,
    })
    .returning();
  tell(row!);
  return (await toScheduled(deps, [row!]))[0]!;
}

const BERLIN = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Berlin',
  dateStyle: 'short',
  timeStyle: 'short',
});

/**
 * An agent's or app's `post_message` with `send_at`: planned, answered with the time it goes and
 * the time now (Berlin) – their prompt knows the day alone, so a wrong guess shows and is put
 * right. Refused, the time now is said with why.
 */
export async function scheduleForTool(
  deps: AppDeps,
  userId: string,
  channelId: string,
  input: { text: string; sendAt: string },
  agent?: { id: string },
): Promise<string> {
  const now = BERLIN.format(deps.clock.now());
  try {
    const planned = await scheduleMessage(deps, userId, channelId, input, agent);
    return `Planned for ${BERLIN.format(new Date(planned.sendAt))} Berlin time (it is ${now} now) – until then only the person sees it, above their field; then it is posted.`;
  } catch (error) {
    if (error instanceof Error) error.message = `${error.message} (Berlin time now: ${now})`;
    throw error;
  }
}

/** The caller's planned messages of a conversation (their agents' too), the next first. */
export async function listScheduled(
  deps: AppDeps,
  userId: string,
  channelId: string,
): Promise<SenderScheduled[]> {
  await seenChannel(deps, userId, channelId);
  const rows = await deps.db
    .select()
    .from(senderScheduled)
    .where(and(eq(senderScheduled.userId, userId), eq(senderScheduled.channelId, channelId)))
    .orderBy(asc(senderScheduled.sendAt))
    .limit(100);
  return toScheduled(deps, rows);
}

async function loadMine(deps: AppDeps, userId: string, id: string) {
  const [row] = await deps.db.select().from(senderScheduled).where(eq(senderScheduled.id, id));
  if (!row || row.userId !== userId) throw scheduledNotFound();
  return row;
}

/**
 * „Löschen“ (and „Bearbeiten“, which puts it back into the field): gone, its files free again –
 * what it was is answered, to be typed on.
 */
export async function deleteScheduled(
  deps: AppDeps,
  userId: string,
  id: string,
): Promise<SenderScheduled> {
  const mine = await loadMine(deps, userId, id);
  if (await posted(deps, mine.id)) {
    await deps.db.delete(senderScheduled).where(eq(senderScheduled.id, mine.id));
    tell(mine);
    throw badRequest('Sie steht schon im Gespräch.');
  }
  // Not while it goes out: its files are the message's then.
  const [row] = await deps.db
    .delete(senderScheduled)
    .where(and(eq(senderScheduled.id, mine.id), ne(senderScheduled.state, 'sending')))
    .returning();
  if (!row) throw badRequest('Sie wird gerade gesendet.');
  await release(deps, row);
  tell(row);
  return (await toScheduled(deps, [row]))[0]!;
}

/** Posts a claimed one (`sending`): gone once out; refused, kept with why. */
async function fire(deps: AppDeps, row: SenderScheduledRow) {
  if (await posted(deps, row.id)) {
    await deps.db.delete(senderScheduled).where(eq(senderScheduled.id, row.id));
    tell(row);
    return;
  }
  await release(deps, row);
  try {
    if (row.agentId) {
      const [agent] = await deps.db
        .select({ id: cloudAgents.id, title: cloudAgents.title, userId: cloudAgents.userId })
        .from(cloudAgents)
        .where(eq(cloudAgents.id, row.agentId));
      if (!agent) throw badRequest('Den Agenten gibt es nicht mehr.');
      await checkPost(deps, row.userId, row.channelId, row.replyTo);
      await postAsAgent(
        deps,
        { ...agent, title: agent.title || 'Agent' },
        row.channelId,
        row.text,
        row.id,
      );
    } else {
      const [user] = await deps.db.select().from(users).where(eq(users.id, row.userId));
      if (!user) throw badRequest('Diese Person gibt es nicht mehr.');
      await postMessage(
        deps,
        row.userId,
        row.channelId,
        row.text,
        { kind: 'owner', author: ownerAuthor(user) },
        row.attachments.map((one) => one.id),
        row.replyTo ?? undefined,
        row.id,
      );
    }
    await deps.db.delete(senderScheduled).where(eq(senderScheduled.id, row.id));
  } catch (error) {
    // Out already, a step after it failed (telling the others, its files' list): done.
    if (await posted(deps, row.id)) {
      await deps.db.delete(senderScheduled).where(eq(senderScheduled.id, row.id));
      tell(row);
      return;
    }
    await retake(deps, row);
    await deps.db
      .update(senderScheduled)
      .set({ state: 'failed', error: error instanceof Error ? error.message : String(error) })
      .where(eq(senderScheduled.id, row.id));
  }
  tell(row);
}

/**
 * Takes it to send – once: another round (or a second server) finds it taken. Its time becomes
 * now: one stuck sending is told by when sending began, not when it was planned (sent again long
 * after it was due, it is not taken for stuck while it goes out).
 */
async function claim(deps: AppDeps, id: string, from: SenderScheduledRow['state'][]) {
  const [row] = await deps.db
    .update(senderScheduled)
    .set({ state: 'sending', error: null, sendAt: deps.clock.now() })
    .where(and(eq(senderScheduled.id, id), inArray(senderScheduled.state, from)))
    .returning();
  return row;
}

/** „Jetzt senden“ (and „Erneut senden“ on a refused one): out at once. */
export async function sendScheduledNow(deps: AppDeps, userId: string, id: string): Promise<void> {
  const mine = await loadMine(deps, userId, id);
  const row = await claim(deps, mine.id, ['waiting', 'failed']);
  if (!row) throw badRequest('Sie wird gerade gesendet.');
  await fire(deps, row);
  const [left] = await deps.db.select().from(senderScheduled).where(eq(senderScheduled.id, id));
  if (left?.error) throw badRequest(left.error);
}

/**
 * The server's round (every few seconds): what is due goes out; one stuck sending (begun more than
 * `STUCK_MS` ago, `claim`) is said so.
 */
export async function sendDueScheduled(deps: AppDeps): Promise<void> {
  const now = deps.clock.now();
  await deps.db
    .update(senderScheduled)
    .set({ state: 'failed', error: 'Unterbrochen – sieh nach, ob sie schon im Gespräch steht.' })
    .where(
      and(
        eq(senderScheduled.state, 'sending'),
        lt(senderScheduled.sendAt, new Date(now.getTime() - STUCK_MS)),
      ),
    );
  const due = await deps.db
    .select({ id: senderScheduled.id })
    .from(senderScheduled)
    .where(and(eq(senderScheduled.state, 'waiting'), lte(senderScheduled.sendAt, now)))
    .orderBy(asc(senderScheduled.sendAt))
    .limit(50);
  for (const { id } of due) {
    const row = await claim(deps, id, ['waiting']);
    if (row) await fire(deps, row);
  }
}
