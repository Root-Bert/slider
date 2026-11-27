import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  cloudShares,
  senderChannels,
  senderDrafts,
  senderMembers,
  senderMessages,
  users,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';
import type { Viewer } from '@slider/shared';
import { getEvent, listCalendars } from './calendars';
import { cloudContext, loadNode, nodeDetail } from './cloud';
import { ancestorsOf } from './cloud/context';
import { theirThread } from './mail-agent-run';
import { findDeck, memberNamed } from './mcp';
import { listMilestones, todoByRef } from './todos';
import { listMembers } from './workspaces/members';
import { ToolChatError } from './tool-chat';
import { TOOL_CARDS } from './agent-catalog';

/*
 * What an agent wants done that cannot be undone or reaches out – deleting, sending under the
 * person's name, a link for anyone – is not done when it calls the tool: it stands in its chat
 * as a card („„Angebot.pdf“ löschen?“, „Löschen“ | „Abbrechen“) until the person whose rights
 * it runs with confirms it (`cloud_agent_asks`, `decideCloudAgentAsk` in `cloud-agents.ts`).
 */

/** The tools that wait for „Bestätigen“, with the word on the button that does it. */
export const NEEDS_OK: ReadonlyMap<string, string> = new Map(
  Object.entries(TOOL_CARDS).flatMap(([name, card]) => (card.ok ? [[name, card.ok]] : [])),
);

/** Asked only when it reaches others (`mustAsk`): copying into one's own files is just done. */
const ASKED_WHEN_SHARED = new Set(['copy_files']);
/** Always a card – the label in the agent's activity says so before anything is looked up. */
export const askAlways = (tool: string) => NEEDS_OK.has(tool) && !ASKED_WHEN_SHARED.has(tool);

/** Whether this call waits for the person: a copy only when it lands in an area. */
export async function mustAsk(
  deps: AppDeps,
  viewer: Viewer,
  tool: string,
  input: unknown,
): Promise<boolean> {
  if (!NEEDS_OK.has(tool)) return false;
  if (tool !== 'copy_files') return true;
  const { folder, area } = z
    .object({ folder: z.string().optional(), area: z.string().optional() })
    .parse(input);
  if (area) return true;
  if (!folder) return false;
  const loaded = await loadNode(deps, viewer.author.id, folder, 'edit').catch(() => null);
  // A folder not found is refused by the tool itself, telling the agent why.
  if (!loaded) return false;
  const { node } = loaded;
  if (node.areaId || node.ownerId !== viewer.author.id) return true;
  // Their own folder – but shared (with people or a link), itself or a folder above it.
  const chain = [node.id, ...(await ancestorsOf(deps.db, node)).map((one) => one.id)];
  const [shared] = await deps.db
    .select({ id: cloudShares.id })
    .from(cloudShares)
    .where(inArray(cloudShares.nodeId, chain))
    .limit(1);
  return Boolean(shared);
}

/** What the card says once it is done. */
const DONE_WORDS: Record<string, string> = {
  Löschen: 'Gelöscht',
  Senden: 'Gesendet',
  Entfernen: 'Entfernt',
  Verlassen: 'Verlassen',
  Abbestellen: 'Abbestellt',
  Freigeben: 'Freigegeben',
  Hinzufügen: 'Hinzugefügt',
  Kopieren: 'Kopiert',
};
export const askVerb = (tool: string) => NEEDS_OK.get(tool) ?? 'Bestätigen';
export const askDone = (tool: string) => DONE_WORDS[askVerb(tool)] ?? 'Erledigt';

/** At most this many names on a card; the rest counted. */
const MAX_NAMES = 3;
const named = (names: readonly string[]) => {
  const quoted = names.slice(0, MAX_NAMES).map((name) => `„${name}“`);
  const rest = names.length - quoted.length;
  if (rest > 0) return `${quoted.join(', ')} und ${rest} weitere`;
  return quoted.length > 1
    ? `${quoted.slice(0, -1).join(', ')} und ${quoted.at(-1)}`
    : (quoted[0] ?? '');
};

/** A refusal of the server's, told the agent as its mistake. */
const asMistake = (error: unknown): never => {
  if (error instanceof ApiError) throw new ToolChatError(error.message);
  throw error;
};

/** A message on a card: its start, on one line. */
const short = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
};

/** A file or folder as the card names it: „Name“ – one the person may change. */
async function nodeName(deps: AppDeps, viewer: Viewer, item: string) {
  const { node } = await loadNode(deps, viewer.author.id, item, 'edit').catch(asMistake);
  return `„${node.name}“`;
}

/**
 * A group as the person sees it named: its name, else its other people's first names (as the
 * side bar shows it) – only a group they are in.
 */
async function groupName(deps: AppDeps, userId: string, conversation: string) {
  const [row] = await deps.db
    .select({ name: senderChannels.name, kind: senderChannels.kind })
    .from(senderChannels)
    .where(eq(senderChannels.id, conversation));
  const people = await deps.db
    .select({ id: users.id, name: users.name })
    .from(senderMembers)
    .innerJoin(users, eq(users.id, senderMembers.userId))
    .where(eq(senderMembers.channelId, conversation));
  if (row?.kind !== 'group' || !people.some((each) => each.id === userId))
    throw new ToolChatError(`No group "${conversation}".`);
  return (
    row.name ||
    people
      .filter((each) => each.id !== userId)
      .map((each) => each.name.split(' ')[0])
      .join(', ') ||
    'Gruppe'
  );
}

const ids = z.object({ items: z.array(z.string()).min(1).max(100) });
const one = (key: string) => z.object({ [key]: z.string().trim().min(1).max(300) });

/**
 * What the run that asks may reach, as the tool would check it: where the agent keeps to areas
 * (`why` – shared, or working by itself), the card names nothing of the person's own either –
 * the question would tell it as much as the deed.
 */
export interface AskScope {
  /** Why only areas' things (`areasOnly` in `cloud-agents.ts`), else null. */
  why?: string | null;
  /** The run works on words others wrote: not the person's own calendars either. */
  foreign?: boolean;
  /** The agent asking: its own messages only. */
  agentId?: string;
}

const notHere = (what: string, why: string): never => {
  throw new ToolChatError(`Not here: that is ${what}, and ${why}.`);
};

/**
 * The card's question, as the person reads it – and the check that what it names is there and
 * open to the run: a name not found is the agent's mistake, told back before anything is asked.
 */
export async function askText(
  deps: AppDeps,
  viewer: Viewer,
  workspaceId: string,
  tool: string,
  input: unknown,
  scope: AskScope = {},
): Promise<string> {
  const userId = viewer.author.id;
  const why = scope.why ?? null;
  const calendarWhy = why ?? (scope.foreign ? 'this run works on words others wrote' : null);
  switch (tool) {
    case 'delete': {
      const { items } = ids.parse(input);
      // As the deed would see them: only what the person may change is named.
      const names: string[] = [];
      for (const item of [...new Set(items)]) {
        const loaded = await loadNode(deps, userId, item, 'edit').catch(() => null);
        if (loaded && loaded.node.workspaceId === workspaceId) names.push(loaded.node.name);
      }
      if (names.length === 0)
        throw new ToolChatError('None of these items is there (list_folder).');
      return `${named(names)} löschen?`;
    }
    case 'delete_event': {
      const { event } = one('event').parse(input) as { event: string };
      const found = await getEvent(deps, userId, event).catch(() => {
        throw new ToolChatError(`No event "${event}" (list_events).`);
      });
      if (calendarWhy) {
        const calendar = (await listCalendars(deps, userId, workspaceId)).find(
          (each) => each.id === found.calendarId,
        );
        if (!calendar?.areaId) notHere("an event in the person's own calendar", calendarWhy);
      }
      return `Den Termin „${found.title}“ löschen?`;
    }
    case 'delete_mail': {
      const { thread } = one('thread').parse(input) as { thread: string };
      const found = await theirThread(deps, userId, workspaceId, thread);
      return `Die Mail „${found.thread.subject}“ löschen? Sie ist dann auch im Postfach weg.`;
    }
    case 'send_mail': {
      const { draft } = one('draft').parse(input) as { draft: string };
      if (draft.toLowerCase() !== 'new') {
        const found = await theirThread(deps, userId, workspaceId, draft);
        return `Die Antwort auf „${found.thread.subject}“ senden?`;
      }
      const [kept] = await deps.db
        .select({ target: senderDrafts.target })
        .from(senderDrafts)
        .where(
          and(
            eq(senderDrafts.userId, userId),
            eq(senderDrafts.workspaceId, workspaceId),
            eq(senderDrafts.key, `mail-new:${workspaceId}`),
          ),
        );
      const target = kept?.target;
      if (target?.kind !== 'mail-new')
        throw new ToolChatError('No new mail in the works to send – draft_mail first.');
      // Everyone it goes to, Cc and Bcc too: nobody receives it the card did not name.
      const copies = [
        target.cc?.trim() ? `Cc: ${target.cc.trim()}` : '',
        target.bcc?.trim() ? `Bcc: ${target.bcc.trim()}` : '',
      ].filter(Boolean);
      const to = `${target.to.trim() || 'niemanden'}${copies.length ? ` (${copies.join(', ')})` : ''}`;
      return target.subject.trim()
        ? `Die Mail „${target.subject.trim()}“ an ${to} senden?`
        : `Die Mail an ${to} senden?`;
    }
    case 'delete_presentation': {
      const { presentation } = one('presentation').parse(input) as { presentation: string };
      const deck = await findDeck(deps, { viewer, workspaceId }, presentation).catch(
        (error: unknown) => {
          throw new ToolChatError(error instanceof Error ? error.message : 'No such presentation.');
        },
      );
      return `Die Präsentation „${deck.title}“ löschen?`;
    }
    case 'delete_item': {
      const { presentation } = one('presentation').parse(input) as { presentation: string };
      const deck = await findDeck(deps, { viewer, workspaceId }, presentation).catch(
        (error: unknown) => {
          throw new ToolChatError(error instanceof Error ? error.message : 'No such presentation.');
        },
      );
      return `Etwas vom Board von „${deck.title}“ löschen?`;
    }
    case 'share_link': {
      const { item } = one('item').parse(input) as { item: string };
      return `Einen Link für alle zu ${await nodeName(deps, viewer, item)} anlegen? Wer ihn hat, sieht es ohne Anmeldung.`;
    }
    case 'delete_version': {
      const { item, version } = z.object({ item: z.string(), version: z.string() }).parse(input);
      const { versions } = await nodeDetail(deps, userId, item).catch(asMistake);
      const found = versions.find((each) => each.id === version);
      if (!found) throw new ToolChatError(`That file has no version ${version} – file_details.`);
      return `Fassung ${found.number} von ${await nodeName(deps, viewer, item)} löschen?`;
    }
    case 'delete_area': {
      const { area } = one('area').parse(input) as { area: string };
      const ctx = await cloudContext(deps.db, workspaceId, userId);
      const found = ctx.areas.get(area);
      if (!found) throw new ToolChatError(`No area ${area} – list_areas.`);
      return `Bereich „${found.row.name}“ löschen? Seine Dateien sind dann weg.`;
    }
    case 'delete_calendar': {
      const { calendar } = one('calendar').parse(input) as { calendar: string };
      const found = (await listCalendars(deps, userId, workspaceId)).find(
        (each) => each.id === calendar,
      );
      if (!found) throw new ToolChatError(`No calendar ${calendar}: see list_calendars.`);
      if (calendarWhy && !found.areaId) notHere("the person's own calendar", calendarWhy);
      return `Den Kalender „${found.name}“ löschen? Seine Termine sind dann auch weg.`;
    }
    case 'delete_todo': {
      const { todo } = one('todo').parse(input) as { todo: string };
      const found = await todoByRef(deps, userId, workspaceId, todo).catch(asMistake);
      if (why && !found.areaId) notHere("the person's own to-do", why);
      return `„${found.title}“ löschen?`;
    }
    case 'delete_milestone': {
      const { milestone } = one('milestone').parse(input) as { milestone: string };
      const all = await listMilestones(deps, userId, workspaceId);
      const found =
        all.find((each) => each.id === milestone) ??
        all.find((each) => each.name.toLowerCase() === milestone.toLowerCase());
      if (!found) throw new ToolChatError(`No milestone "${milestone}" (list_milestones).`);
      if (why && !found.areaId) notHere("the person's own milestone", why);
      return `Den Meilenstein „${found.name}“ löschen?`;
    }
    case 'unsubscribe_mail': {
      const { thread } = one('thread').parse(input) as { thread: string };
      const found = await theirThread(deps, userId, workspaceId, thread);
      return `„${found.thread.subject}“ abbestellen?`;
    }
    case 'delete_message': {
      const { message } = one('message').parse(input) as { message: string };
      const [row] = await deps.db
        .select({
          text: senderMessages.text,
          deletedAt: senderMessages.deletedAt,
          agentId: senderMessages.agentId,
          kind: senderChannels.kind,
        })
        .from(senderMessages)
        .innerJoin(senderChannels, eq(senderChannels.id, senderMessages.channelId))
        .where(eq(senderMessages.id, message));
      // Only its own messages, as the deed checks – another's text is not told back.
      if (!row || row.deletedAt || !scope.agentId || row.agentId !== scope.agentId)
        throw new ToolChatError(`No message "${message}" of yours.`);
      if (why && (row.kind === 'group' || row.kind === 'direct'))
        notHere(`a message in a ${row.kind === 'group' ? 'group' : 'direct conversation'}`, why);
      return `Deine Nachricht „${short(row.text)}“ löschen?`;
    }
    case 'remove_from_group': {
      const { conversation, person } = z
        .object({ conversation: z.string(), person: z.string() })
        .parse(input);
      if (why) notHere("the person's group", why);
      const group = await groupName(deps, userId, conversation);
      const members = await listMembers(deps.db, userId, workspaceId);
      const who = (() => {
        try {
          return memberNamed(members, person).name;
        } catch (error) {
          throw new ToolChatError(error instanceof Error ? error.message : String(error));
        }
      })();
      return `${who} aus „${group}“ entfernen?`;
    }
    case 'leave_group': {
      const { conversation } = one('conversation').parse(input) as { conversation: string };
      if (why) notHere("the person's group", why);
      return `Die Gruppe „${await groupName(deps, userId, conversation)}“ verlassen?`;
    }
    case 'add_to_group': {
      const { conversation, people } = z
        .object({ conversation: z.string(), people: z.array(z.string()).min(1) })
        .parse(input);
      if (why) notHere("the person's group", why);
      const group = await groupName(deps, userId, conversation);
      const members = await listMembers(deps.db, userId, workspaceId);
      const who = people.map((each) => {
        try {
          return memberNamed(members, each).name;
        } catch (error) {
          throw new ToolChatError(error instanceof Error ? error.message : String(error));
        }
      });
      return `${named(who).replace(/[„“]/g, '')} zu „${group}“ hinzufügen? Wer dazukommt, sieht den ganzen Verlauf.`;
    }
    case 'share_file': {
      const { item, person, role } = z
        .object({ item: z.string(), person: z.string(), role: z.string().optional() })
        .parse(input);
      const members = await listMembers(deps.db, userId, workspaceId);
      const who = (() => {
        try {
          return memberNamed(members, person).name;
        } catch (error) {
          throw new ToolChatError(error instanceof Error ? error.message : String(error));
        }
      })();
      return `${await nodeName(deps, viewer, item)} mit ${who} teilen${role === 'edit' ? ' – zum Bearbeiten' : ''}?`;
    }
    case 'copy_files': {
      const { items, folder, area } = z
        .object({
          items: z.array(z.string()).min(1),
          folder: z.string().optional(),
          area: z.string().optional(),
        })
        .parse(input);
      const names: string[] = [];
      for (const item of [...new Set(items)]) {
        const loaded = await loadNode(deps, userId, item, 'view').catch(() => null);
        if (loaded && loaded.node.workspaceId === workspaceId) names.push(loaded.node.name);
      }
      if (names.length === 0)
        throw new ToolChatError('None of these items is there (list_folder).');
      const they = names.length > 1 ? 'sie' : 'es';
      const into = folder
        ? (await loadNode(deps, userId, folder, 'edit').catch(asMistake)).node
        : null;
      // Into a folder of their own or one shared with them, outside an area: its people see it.
      if (into && !into.areaId)
        return `${named(names)} in „${into.name}“ kopieren? Wer den Ordner sieht, sieht ${they} dann.`;
      const ctx = await cloudContext(deps.db, workspaceId, userId);
      const areaId = area ?? into?.areaId ?? null;
      const where = areaId ? ctx.areas.get(areaId)?.row.name : undefined;
      if (!where) throw new ToolChatError(`No area ${areaId ?? ''} – list_areas.`);
      return `${named(names)} in den Bereich „${where}“ kopieren? Alle dort sehen ${they} dann.`;
    }
    default:
      return 'Das ausführen?';
  }
}

/**
 * What the card stands for, fixed when it is asked: the mail as it is then (who it goes to,
 * subject, words, attachments), the presentation, milestone or person a name meant then. At the
 * click it is looked at again – changed in between (the draft rewritten, another thing called
 * so), nothing is done: one confirms what one read, not what came after.
 */
/** Where the pin is kept beside the call's input (dropped before the call is made). */
export const ASK_PIN = '_pin';

export async function askPin(
  deps: AppDeps,
  viewer: Viewer,
  workspaceId: string,
  tool: string,
  input: unknown,
): Promise<string | null> {
  const userId = viewer.author.id;
  switch (tool) {
    case 'send_mail': {
      const { draft } = one('draft').parse(input) as { draft: string };
      const key =
        draft.toLowerCase() === 'new'
          ? `mail-new:${workspaceId}`
          : `mail:${(await theirThread(deps, userId, workspaceId, draft)).thread.id}`;
      const [kept] = await deps.db
        .select({ text: senderDrafts.text, target: senderDrafts.target })
        .from(senderDrafts)
        .where(
          and(
            eq(senderDrafts.userId, userId),
            eq(senderDrafts.workspaceId, workspaceId),
            eq(senderDrafts.key, key),
          ),
        );
      return createHash('sha256')
        .update(JSON.stringify([kept?.text ?? null, kept?.target ?? null]))
        .digest('hex');
    }
    case 'delete_presentation':
    case 'delete_item': {
      const { presentation } = one('presentation').parse(input) as { presentation: string };
      const deck = await findDeck(deps, { viewer, workspaceId }, presentation).catch(() => null);
      return deck?.id ?? '';
    }
    case 'delete_milestone': {
      const { milestone } = one('milestone').parse(input) as { milestone: string };
      const all = await listMilestones(deps, userId, workspaceId);
      const found =
        all.find((each) => each.id === milestone) ??
        all.find((each) => each.name.toLowerCase() === milestone.toLowerCase());
      return found?.id ?? '';
    }
    case 'remove_from_group': {
      const { person } = z.object({ person: z.string() }).parse(input);
      const members = await listMembers(deps.db, userId, workspaceId);
      try {
        return memberNamed(members, person).userId;
      } catch {
        return '';
      }
    }
    case 'add_to_group':
    case 'share_file': {
      const { people, person } = z
        .object({ people: z.array(z.string()).optional(), person: z.string().optional() })
        .parse(input);
      const members = await listMembers(deps.db, userId, workspaceId);
      return [...(people ?? []), ...(person ? [person] : [])]
        .map((each) => {
          try {
            return memberNamed(members, each).userId;
          } catch {
            return '';
          }
        })
        .join(',');
    }
    default:
      return null;
  }
}
