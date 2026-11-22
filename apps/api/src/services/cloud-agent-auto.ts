import type Anthropic from '@anthropic-ai/sdk';
import { and, desc, eq, gt, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import {
  CLOUD_AGENT_REPEATS,
  CLOUD_AGENT_WATCH_KINDS,
  CLOUD_AGENT_WATCH_QUIET,
  MAX_CLOUD_AGENT_WATCHES,
  MAX_MATERIAL_CHAT_MESSAGE,
  type CloudAgentRepeatRule,
  type CloudAgentWatch,
  type CloudAgentWatching,
  type CloudEventKind,
} from '@slider/shared';
import {
  cloudAgents,
  cloudEvents,
  cloudNodes,
  users,
  type CloudAgentRow,
  type CloudEventRow,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { cloudContext, loadNode, requireArea } from './cloud/context';
import { ownEvent } from './cloud/events';
import { uploadsInto, type Uploading } from './cloud/uploading';
import { atInZone, knownZone, nextRun } from './cloud-agent-repeat';
import { ToolChatError } from './tool-chat';

/*
 * What an agent does by itself, set up by the agent from the words of its order – nobody fills
 * in a form: an order it takes up again at a time (`repeat`, as „Wiederholen“ sets it) and things
 * it keeps an eye on (`watches`): an area, a folder with all in it, one file, an area's people.
 * The server looks for what changed there (`cloud_events`, and the uploads on their way) and
 * gives the agent the watch's order with what happened – once it has been quiet for as long as
 * the order asks (`quiet`), or once, at a set time, with all that happened until then (`until`).
 * Meanwhile its page says what it has seen (`watchingOf`). Its owner's alone to set: it runs
 * with their rights, when nobody is there.
 */

/** The zone a time is meant in when the writer's is not known. */
const DEFAULT_ZONE = 'Europe/Berlin';
/** Of what happened, as much as one order names. */
const MAX_LINES = 30;
/** Of what happened, as much as the page shows while the agent waits. */
const MAX_SEEN = 4;
/** Events looked through at once: the newest. */
const MAX_EVENTS = 2000;
/** The longest a watch waits for quiet, in seconds. */
const MAX_QUIET = 24 * 60 * 60;

const text = z.string().trim().min(1).max(MAX_MATERIAL_CHAT_MESSAGE);
export const AUTO_INPUTS = {
  repeat_order: z.object({
    every: z.enum(CLOUD_AGENT_REPEATS),
    at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    day: z.number().int().min(0).max(6).optional(),
    text,
  }),
  stop_repeating: z.object({}),
  watch: z.object({
    on: z.enum(CLOUD_AGENT_WATCH_KINDS),
    target: z.string().min(1).max(100),
    text,
    wait_seconds: z.number().int().min(0).max(MAX_QUIET).optional(),
    until: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}[ T]([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
  }),
  stop_watching: z.object({ watch: z.string().min(1).max(100) }),
};
export type AutoToolName = keyof typeof AUTO_INPUTS;

const ORDER_TEXT =
  'The order for that run, written so it stands alone – you will read only it then, not this chat: what to do, where (names), what to leave. In the person’s language.';

export const AUTO_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'repeat_order',
    description:
      'Sets the order you take up again by yourself at a time: every day, Monday to Friday (weekdays) or once a week, at a time of day on the person’s clock. Call it when the order says so in any words („jeden Montag“, „täglich um 8“, „jede Woche“). One at a time: calling it again replaces it. Shortest rhythm is a day.',
    input_schema: {
      type: 'object',
      properties: {
        every: { type: 'string', enum: [...CLOUD_AGENT_REPEATS] },
        at: { type: 'string', description: 'HH:MM, 24 hours. No time named: 08:00.' },
        day: {
          type: 'integer',
          description: 'For week: 0 Sunday to 6 Saturday. No day named: 1.',
        },
        text: { type: 'string', description: ORDER_TEXT },
      },
      required: ['every', 'at', 'text'],
    },
  },
  {
    name: 'stop_repeating',
    description: 'Ends the repeated order.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'watch',
    description: `Keeps an eye on something and sets you to work by yourself when it changes – call it when the order says „immer wenn“, „sobald“, „wenn jemand …“, „halte … im Blick“ and the like. on: area (anything in an area: files added, changed, moved, renamed, deleted), folder (the same in one folder and all below it), file (one file: a new version, renamed, moved, deleted), people (who an area's people are: someone added or taken out). target: the id of that area, folder or file – look it up first. At most ${MAX_CLOUD_AGENT_WATCHES}. What you change yourself while you work does not set you off again. How soon you start is yours to fit to the order: wait_seconds for work at each change, until for one report at a set time. Where the order leaves open which of the two is meant, or until when, ask before you set it.`,
    input_schema: {
      type: 'object',
      properties: {
        on: { type: 'string', enum: [...CLOUD_AGENT_WATCH_KINDS] },
        target: { type: 'string' },
        text: { type: 'string', description: ORDER_TEXT },
        wait_seconds: {
          type: 'integer',
          description: `How long it must have been quiet there before you start, so several changes in a row are one piece of work. Left out: ${CLOUD_AGENT_WATCH_QUIET}. 0 to 5 where the person wants to hear at once; minutes where much lands there bit by bit or the work is large.`,
        },
        until: {
          type: 'string',
          description:
            'YYYY-MM-DD HH:MM on the person’s clock. Instead of working at each change: you collect what happens until then, work once then with all of it, and the watch ends. For „sag mir Ende der Woche, was dort passiert ist“ (end of the week: Friday 17:00 unless said otherwise).',
        },
      },
      required: ['on', 'target', 'text'],
    },
  },
  {
    name: 'stop_watching',
    description: 'Ends one watch, by its id (the system prompt lists them).',
    input_schema: {
      type: 'object',
      properties: { watch: { type: 'string' } },
      required: ['watch'],
    },
  },
];

const EVERY_WORDS: Record<CloudAgentRepeatRule['every'], string> = {
  day: 'every day',
  weekdays: 'Monday to Friday',
  week: 'once a week',
};
const ON_WORDS: Record<CloudAgentWatch['on'], string> = {
  area: 'the area',
  folder: 'the folder',
  file: 'the file',
  people: 'the people of the area',
};

/** What is set up right now, for the agent's prompt – so it changes that instead of adding. */
export function autoWords(row: CloudAgentRow): string {
  const lines: string[] = [];
  if (row.repeat && row.repeatText) {
    lines.push(
      `- repeated order, ${EVERY_WORDS[row.repeat.every]}${row.repeat.every === 'week' ? ` (day ${row.repeat.day ?? 1})` : ''} at ${row.repeat.at} (${row.repeat.zone}): ${row.repeatText}`,
    );
  }
  for (const watch of row.watches ?? []) {
    const when = watch.until
      ? `collecting until ${watch.until}, then once`
      : `after ${watch.quiet ?? CLOUD_AGENT_WATCH_QUIET} s of quiet`;
    lines.push(
      `- watch ${watch.id} on ${ON_WORDS[watch.on]} „${watch.name}“ (${watch.targetId}), ${when}: ${watch.text}`,
    );
  }
  const set =
    lines.length === 0
      ? 'Right now you do nothing by yourself.'
      : `What you do by yourself right now${row.paused ? ' (paused by the person: nothing runs)' : ''}:\n${lines.join('\n')}`;
  return `${set}\n${ASKING}`;
}

/** How it asks back: the page makes buttons of the answers it offers. */
const ASKING =
  'When you need the person to decide between a few answers (how soon to react, until when to collect, which of two folders), ask in one short sentence and put the answers you offer at the very end of your message, each on a line of its own as [[choice:the answer, in their words]] – two to four. They see them as buttons; one click answers. Never for a question whose answer is free text.';

/**
 * One of the agent's own tools for what it does by itself. Only in a chat of its owner: it
 * runs with their rights when nobody is there.
 */
export async function runAutoTool(
  deps: AppDeps,
  writerId: string,
  agentId: string,
  name: AutoToolName,
  raw: unknown,
  zone: string | undefined,
): Promise<{ content: string; changed: boolean }> {
  const [row] = await deps.db.select().from(cloudAgents).where(eq(cloudAgents.id, agentId));
  if (!row) throw new ToolChatError('This agent is gone.');
  if (row.userId !== writerId) {
    throw new ToolChatError(
      'Only the person who owns this agent sets what it does by itself. Say so; do the work once now if that helps.',
    );
  }
  const now = deps.clock.now();
  const set = (values: Partial<typeof cloudAgents.$inferInsert>) =>
    deps.db.update(cloudAgents).set(values).where(eq(cloudAgents.id, row.id));
  switch (name) {
    case 'repeat_order': {
      const { text: order, ...when } = AUTO_INPUTS.repeat_order.parse(raw);
      const wanted = zone ?? row.repeat?.zone ?? DEFAULT_ZONE;
      const rule: CloudAgentRepeatRule = {
        every: when.every,
        at: when.at,
        ...(when.every === 'week' ? { day: when.day ?? 1 } : {}),
        zone: knownZone(wanted) ? wanted : DEFAULT_ZONE,
      };
      const next = nextRun(rule, now);
      await set({ repeat: rule, repeatText: order, nextRunAt: next });
      return {
        content: `Set: ${EVERY_WORDS[rule.every]} at ${rule.at} (${rule.zone}), next ${next.toISOString()}. Tell the person in one sentence when you will do it again.`,
        changed: true,
      };
    }
    case 'stop_repeating':
      await set({ repeat: null, repeatText: null, nextRunAt: null });
      return { content: 'The repeated order is ended.', changed: true };
    case 'watch': {
      const input = AUTO_INPUTS.watch.parse(raw);
      const watches = row.watches ?? [];
      if (watches.length >= MAX_CLOUD_AGENT_WATCHES) {
        throw new ToolChatError(
          `There are ${MAX_CLOUD_AGENT_WATCHES} watches already: end one first.`,
        );
      }
      let called: string;
      if (input.on === 'area' || input.on === 'people') {
        const ctx = await cloudContext(deps.db, row.workspaceId, writerId);
        const area = ctx.areas.get(input.target);
        if (!area?.access) throw new ToolChatError(`No area with id ${input.target}.`);
        called = area.row.name;
      } else {
        const found = await loadNode(deps, writerId, input.target).catch(() => null);
        if (!found || found.node.workspaceId !== row.workspaceId) {
          throw new ToolChatError(`No ${input.on} with id ${input.target}.`);
        }
        if (found.node.kind !== input.on) {
          throw new ToolChatError(`${input.target} is a ${found.node.kind}, not a ${input.on}.`);
        }
        called = found.node.name;
      }
      let until: Date | null = null;
      if (input.until) {
        const wanted = zone ?? row.repeat?.zone ?? DEFAULT_ZONE;
        const [day = '', time = ''] = input.until.split(/[ T]/);
        until = atInZone(knownZone(wanted) ? wanted : DEFAULT_ZONE, day, time);
        if (!(until.getTime() > now.getTime())) {
          throw new ToolChatError(`until ${input.until} is over already: name a time to come.`);
        }
      }
      const watch: CloudAgentWatch = {
        id: crypto.randomUUID().slice(0, 8),
        on: input.on,
        targetId: input.target,
        name: called,
        text: input.text,
        ...(input.wait_seconds === undefined || until ? {} : { quiet: input.wait_seconds }),
        ...(until ? { until: until.toISOString() } : {}),
        since: now.toISOString(),
      };
      // From now on: what lay there before is not news.
      await set({ watches: [...watches, watch], watchedAt: row.watchedAt ?? now });
      return {
        content: `Watching ${ON_WORDS[watch.on]} „${called}“ (watch ${watch.id}), ${until ? `collecting until ${until.toISOString()}, then you work once and the watch ends` : `starting once it has been quiet for ${watch.quiet ?? CLOUD_AGENT_WATCH_QUIET} s`}. Tell the person in one sentence what you keep an eye on, what you do then and how soon.`,
        changed: true,
      };
    }
    case 'stop_watching': {
      const { watch: id } = AUTO_INPUTS.stop_watching.parse(raw);
      const watches = row.watches ?? [];
      if (!watches.some((each) => each.id === id)) throw new ToolChatError(`No watch ${id}.`);
      const left = watches.filter((each) => each.id !== id);
      await set({ watches: left.length ? left : null });
      return { content: 'That watch is ended.', changed: true };
    }
  }
}

const HAPPENED: Partial<Record<CloudEventKind, string>> = {
  uploaded: 'hochgeladen',
  version: 'neue Fassung',
  folder_created: 'Ordner angelegt',
  renamed: 'umbenannt',
  moved: 'verschoben',
  copied: 'kopiert',
  deleted: 'gelöscht',
  restored: 'wiederhergestellt',
  version_restored: 'ältere Fassung zurückgeholt',
  area_people: 'Personen geändert',
};

/** The folders a file or folder lies in, innermost first – asked once per node. */
async function foldersAbove(
  deps: AppDeps,
  nodeId: string,
  known: Map<string, string[]>,
): Promise<string[]> {
  const had = known.get(nodeId);
  if (had) return had;
  const chain: string[] = [];
  let at: string | null = nodeId;
  for (let depth = 0; at && depth < 64; depth += 1) {
    const [node]: { parentId: string | null }[] = await deps.db
      .select({ parentId: cloudNodes.parentId })
      .from(cloudNodes)
      .where(eq(cloudNodes.id, at));
    at = node?.parentId ?? null;
    if (at) chain.push(at);
  }
  known.set(nodeId, chain);
  return chain;
}

/** One watch, looked at: what happened there that the agent has not worked on, and what comes. */
export interface Looked {
  watch: CloudAgentWatch;
  /** What others did there since it last worked on it, oldest first. */
  events: CloudEventRow[];
  /** Files on their way up there right now, by name. */
  uploading: string[];
  /**
   * When it starts by itself: the watch's set time – or once it has been quiet for as long as
   * the watch asks. `null`: nothing to start on, or a file is still on its way.
   */
  dueAt: Date | null;
}

/**
 * Looks where an agent watches: per watch what happened since it last worked on it – without
 * what it did itself –, what is on its way up, and when it starts. A watch whose target its
 * owner no longer sees is left out: an agent learns nothing they could not look up.
 */
export async function lookWhereWatched(
  deps: AppDeps,
  row: CloudAgentRow,
  now: Date,
): Promise<Looked[]> {
  const watches = row.watches ?? [];
  if (watches.length === 0) return [];
  const base = (row.watchedAt ?? row.createdAt).getTime();
  const sinceOf = (watch: CloudAgentWatch) =>
    Math.max(base, watch.since ? new Date(watch.since).getTime() : base);
  const events = (
    await deps.db
      .select()
      .from(cloudEvents)
      .where(
        and(
          eq(cloudEvents.workspaceId, row.workspaceId),
          gt(cloudEvents.createdAt, new Date(Math.min(...watches.map(sinceOf)))),
          lte(cloudEvents.createdAt, now),
        ),
      )
      .orderBy(desc(cloudEvents.createdAt))
      .limit(MAX_EVENTS)
  )
    .reverse()
    .filter((event) => event.kind in HAPPENED && !ownEvent(row.id, event));
  const coming = uploadsInto(row.workspaceId, now.getTime());
  const ctx = await cloudContext(deps.db, row.workspaceId, row.userId);
  const above = new Map<string, string[]>();
  const areas = new Map<string, string | null>();
  const areaOf = async (nodeId: string) => {
    if (!areas.has(nodeId)) {
      const [node] = await deps.db
        .select({ areaId: cloudNodes.areaId })
        .from(cloudNodes)
        .where(eq(cloudNodes.id, nodeId));
      areas.set(nodeId, node?.areaId ?? null);
    }
    return areas.get(nodeId) ?? null;
  };
  const fits = async (watch: CloudAgentWatch, event: CloudEventRow): Promise<boolean> => {
    if (watch.on === 'people') {
      return event.kind === 'area_people' && event.areaId === watch.targetId;
    }
    if (event.kind === 'area_people') return false;
    if (watch.on === 'area') return event.areaId === watch.targetId;
    if (!event.nodeId) return false;
    if (event.nodeId === watch.targetId) return true;
    if (watch.on === 'file') return false;
    return (await foldersAbove(deps, event.nodeId, above)).includes(watch.targetId);
  };
  const comesTo = async (watch: CloudAgentWatch, upload: Uploading): Promise<boolean> => {
    if (watch.on === 'people') return false;
    if (watch.on === 'file') return upload.nodeId === watch.targetId;
    // Where it goes: the folder it is put into, or the file it is the next version of.
    const at = upload.parentId ?? upload.nodeId;
    if (watch.on === 'area') {
      return (
        upload.areaId === watch.targetId || (at ? (await areaOf(at)) === watch.targetId : false)
      );
    }
    if (!at) return false;
    return (
      upload.parentId === watch.targetId ||
      (await foldersAbove(deps, at, above)).includes(watch.targetId)
    );
  };
  const looked: Looked[] = [];
  for (const watch of watches) {
    if (watch.on === 'area' || watch.on === 'people') {
      try {
        requireArea(ctx, watch.targetId);
      } catch {
        continue;
      }
    } else if (!(await loadNode(deps, row.userId, watch.targetId).catch(() => null))) {
      continue;
    }
    const since = sinceOf(watch);
    const mine: CloudEventRow[] = [];
    for (const event of events) {
      if (event.createdAt.getTime() > since && (await fits(watch, event))) mine.push(event);
    }
    const uploading: string[] = [];
    for (const upload of coming) if (await comesTo(watch, upload)) uploading.push(upload.name);
    const newest = mine.at(-1)?.createdAt.getTime();
    const dueAt = watch.until
      ? new Date(watch.until)
      : newest === undefined || uploading.length > 0
        ? null
        : new Date(newest + (watch.quiet ?? CLOUD_AGENT_WATCH_QUIET) * 1000);
    looked.push({ watch, events: mine, uploading, dueAt });
  }
  return looked;
}

/**
 * The watches to work on now: those whose time has come – or (`atOnce`, the person does not
 * want to wait) every one that has seen something.
 */
export function dueOf(looked: readonly Looked[], now: Date, atOnce = false): Looked[] {
  return looked.filter((each) =>
    atOnce
      ? each.events.length > 0
      : each.dueAt !== null &&
        each.dueAt.getTime() <= now.getTime() &&
        // A collecting watch reports at its time whatever happened; another needs something.
        (each.watch.until !== undefined || each.events.length > 0),
  );
}

/**
 * The agent's watches once it is set to work on `due`: each of them looks from `now` on, and a
 * collecting one whose time has come is ended – it was for that one report.
 */
export function watchesAfter(
  row: CloudAgentRow,
  due: readonly Looked[],
  now: Date,
): CloudAgentWatch[] | null {
  const worked = new Set(due.map((each) => each.watch.id));
  const left = (row.watches ?? [])
    .filter(
      (watch) =>
        !(worked.has(watch.id) && watch.until && new Date(watch.until).getTime() <= now.getTime()),
    )
    .map((watch) => (worked.has(watch.id) ? { ...watch, since: now.toISOString() } : watch));
  return left.length ? left : null;
}

const more = (event: CloudEventRow) => (event.more > 0 ? ` (und ${event.more} weitere)` : '');

/** The message the work on `due` starts with: per watch what happened, then its order. */
export async function watchOrders(deps: AppDeps, due: readonly Looked[]): Promise<string> {
  const actorIds = [
    ...new Set(due.flatMap((each) => each.events.flatMap((event) => event.actorId ?? []))),
  ];
  const actors = actorIds.length
    ? await deps.db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, actorIds))
    : [];
  const who = (id: string | null) => actors.find((each) => each.id === id)?.name ?? 'Jemand';
  return due
    .map(({ watch, events }) => {
      const where =
        watch.on === 'people'
          ? `Bei den Personen im Bereich „${watch.name}“`
          : `In „${watch.name}“`;
      if (events.length === 0) return `${where} hat sich nichts geändert.\n\n${watch.text}`;
      const lines = events.slice(-MAX_LINES).map((event) => {
        const detail = event.detail ? ` – ${event.detail}` : '';
        return `- ${who(event.actorId)}: ${HAPPENED[event.kind] ?? event.kind} „${event.name}“${more(event)}${detail}`;
      });
      return `${where} hat sich etwas geändert:\n${lines.join('\n')}\n\n${watch.text}`;
    })
    .join('\n\n');
}

/**
 * What the agent has noticed and waits to work on, for its page: per watch the files on their
 * way, what happened, and how long until it starts. `busy`: it works right now (or is paused)
 * and starts on nothing by itself meanwhile.
 */
export function watchingOf(
  looked: readonly Looked[],
  now: Date,
  busy: boolean,
): CloudAgentWatching[] {
  return looked
    .filter((each) => each.events.length > 0 || each.uploading.length > 0)
    .map(({ watch, events, uploading, dueAt }) => ({
      watchId: watch.id,
      name: watch.name,
      uploading,
      seen: events
        .slice(-MAX_SEEN)
        .map((event) => `„${event.name}“${more(event)} ${HAPPENED[event.kind] ?? event.kind}`),
      count: events.reduce((sum, event) => sum + 1 + event.more, 0),
      startsIn: busy || !dueAt ? null : Math.max(0, dueAt.getTime() - now.getTime()),
      until: watch.until ?? null,
    }));
}
