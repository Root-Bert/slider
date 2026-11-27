import type Anthropic from '@anthropic-ai/sdk';
import { and, asc, count, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { MAX_CLOUD_AGENT_MEMORY_FILE, type CloudAgentMemory } from '@slider/shared';
import type { Executor } from '../db/client';
import { agentMemories, users } from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest } from '../http/errors';
import { ToolChatError } from './tool-chat';

/*
 * An agent's memory („Gedächtnis“): small text files under `/memories` it keeps across its chats
 * and runs – what it learnt about the work, the people's ways, where things are. One per agent: a
 * shared agent's is everyone's who works with it, and everyone of them sees and changes it on the
 * agent's page. Its commands are those of Anthropic's memory tool (`memory_20250818`), as a tool
 * of our own: it works with every service, and `refuse()` sees every call. Never put into the
 * prompt – the agent looks itself; it writes only on a person's own message.
 */

export const MEMORY_ROOT = '/memories';
/** The most files one agent keeps. */
const MAX_FILES = 50;
/** The longest a file may be (characters). */
export const MAX_MEMORY_FILE = MAX_CLOUD_AGENT_MEMORY_FILE;
const MAX_PATH = 200;

export const MEMORY_TOOL: Anthropic.Beta.BetaTool = {
  name: 'memory',
  description: `Your memory: text files under ${MEMORY_ROOT} that stay across your chats and runs. At the start of an order where what you learnt before may help, view ${MEMORY_ROOT} first. Keep in it what will help next time – how the people here want things, decisions, where things are, what did not work – short and up to date: change or delete what is no longer true, one topic per file (Markdown). Never secrets or passwords, never whole documents or mails. Everyone who works with you may read and change it. Commands: view (a folder: its files; a file: its lines, view_range [first, last] for part of it), create (a new file with file_text), str_replace (old_str, which must occur once, by new_str), insert (insert_text after line insert_line, 0 = at the top), delete (a file or a folder with all in it), rename (old_path to new_path).`,
  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: ['view', 'create', 'str_replace', 'insert', 'delete', 'rename'],
      },
      path: { type: 'string', description: `Under ${MEMORY_ROOT}, e.g. ${MEMORY_ROOT}/team.md` },
      view_range: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
      file_text: { type: 'string' },
      old_str: { type: 'string' },
      new_str: { type: 'string' },
      insert_line: { type: 'integer', minimum: 0 },
      insert_text: { type: 'string' },
      old_path: { type: 'string' },
      new_path: { type: 'string' },
    },
    required: ['command'],
  },
};

const INPUT = z.discriminatedUnion('command', [
  z.object({
    command: z.literal('view'),
    path: z.string(),
    view_range: z.tuple([z.number().int(), z.number().int()]).optional(),
  }),
  z.object({ command: z.literal('create'), path: z.string(), file_text: z.string() }),
  z.object({
    command: z.literal('str_replace'),
    path: z.string(),
    old_str: z.string().min(1),
    new_str: z.string(),
  }),
  z.object({
    command: z.literal('insert'),
    path: z.string(),
    insert_line: z.number().int().min(0),
    insert_text: z.string(),
  }),
  z.object({ command: z.literal('delete'), path: z.string() }),
  z.object({ command: z.literal('rename'), old_path: z.string(), new_path: z.string() }),
]);

/** Only what changes nothing: `view`. */
export const memoryReads = (input: unknown): boolean =>
  (input as { command?: unknown } | null)?.command === 'view';

/** What the person sees while it uses its memory. */
export const memoryLabel = (input: unknown) =>
  memoryReads(input) ? 'Sieht in sein Gedächtnis' : 'Merkt sich etwas';

/** A path under `/memories`, made plain; anything else (`..`, odd signs, too long) refused. */
export function memoryPath(raw: string): string {
  const path = raw.trim().replace(/\/+$/, '') || MEMORY_ROOT;
  const parts = path.split('/').slice(1);
  if (
    path.length > MAX_PATH ||
    !path.startsWith(`${MEMORY_ROOT}`) ||
    parts[0] !== MEMORY_ROOT.slice(1) ||
    parts.length > 4 ||
    parts.slice(1).some((part) => !/^[\p{L}\p{N}._ -]{1,80}$/u.test(part) || /^\.+$/.test(part))
  )
    throw new ToolChatError(
      `Error: The path ${raw} is not allowed. Please use a path under ${MEMORY_ROOT}, like ${MEMORY_ROOT}/notes.md.`,
    );
  return path;
}

const missing = (path: string) =>
  new ToolChatError(`Error: The path ${path} does not exist. Please provide a valid path.`);

const numbered = (lines: string[], first = 1) =>
  lines.map((line, index) => `${String(index + first).padStart(6)}\t${line}`).join('\n');

const tooLong = (path: string) =>
  new ToolChatError(
    `Error: ${path} would be longer than ${MAX_MEMORY_FILE} characters – keep memory files short, split it or leave out what is no longer needed.`,
  );

/** What the memory tool needs: also run in a transaction (`runOwnMemory`). */
type MemoryDeps = Pick<AppDeps, 'clock'> & { db: Executor };

async function filesOf(deps: MemoryDeps, agentId: string) {
  return deps.db
    .select()
    .from(agentMemories)
    .where(eq(agentMemories.agentId, agentId))
    .orderBy(asc(agentMemories.path));
}

/** One command of the memory tool, on the agent's memory, by `userId`. */
export async function runMemoryTool(
  deps: MemoryDeps,
  agentId: string,
  userId: string,
  raw: unknown,
): Promise<{ content: string; changed: boolean }> {
  const input = INPUT.parse(raw);
  const files = await filesOf(deps, agentId);
  const at = deps.clock.now();
  const find = (path: string) => files.find((each) => each.path === path);
  const under = (path: string) => files.filter((each) => each.path.startsWith(`${path}/`));
  // Path and text are sealed: found here, changed by id.
  const write = async (file: (typeof files)[number], content: string) => {
    if (content.length > MAX_MEMORY_FILE) throw tooLong(file.path);
    await deps.db
      .update(agentMemories)
      .set({ content, updatedBy: userId, updatedAt: at })
      .where(eq(agentMemories.id, file.id));
  };
  switch (input.command) {
    case 'view': {
      const path = memoryPath(input.path);
      const file = find(path);
      if (file) {
        const lines = file.content.split('\n');
        const [first, last] = input.view_range ?? [1, lines.length];
        const from = Math.max(1, first);
        const to = last === -1 ? lines.length : Math.min(lines.length, last);
        return {
          content: `Here's the content of ${path} with line numbers:\n${numbered(lines.slice(from - 1, to), from)}`,
          changed: false,
        };
      }
      const inside = under(path);
      if (path !== MEMORY_ROOT && inside.length === 0) throw missing(path);
      const depth = path.split('/').length + 2;
      const listed = inside
        .filter((each) => each.path.split('/').length <= depth)
        .map((each) => `${Buffer.byteLength(each.content)}\t${each.path}`);
      return {
        content: `Here're the files and directories up to 2 levels deep in ${path}, excluding hidden items and node_modules:\n${[`${inside.reduce((sum, each) => sum + Buffer.byteLength(each.content), 0)}\t${path}`, ...listed].join('\n')}`,
        changed: false,
      };
    }
    case 'create': {
      const path = memoryPath(input.path);
      if (path === MEMORY_ROOT || under(path).length > 0)
        throw new ToolChatError(`Error: ${path} is a directory – give a file's path.`);
      if (find(path)) throw new ToolChatError(`Error: File ${path} already exists`);
      if (files.length >= MAX_FILES)
        throw new ToolChatError(
          `Error: Your memory holds ${MAX_FILES} files already – put this into one that exists, or delete one that is no longer needed.`,
        );
      if (input.file_text.length > MAX_MEMORY_FILE) throw tooLong(path);
      await deps.db.insert(agentMemories).values({
        id: crypto.randomUUID(),
        agentId,
        path,
        content: input.file_text,
        updatedBy: userId,
        updatedAt: at,
      });
      return { content: `File created successfully at: ${path}`, changed: true };
    }
    case 'str_replace': {
      const path = memoryPath(input.path);
      const file = find(path);
      if (!file) throw missing(path);
      const parts = file.content.split(input.old_str);
      if (parts.length === 1)
        throw new ToolChatError(
          `No replacement was performed, old_str \`${input.old_str}\` did not appear verbatim in ${path}.`,
        );
      if (parts.length > 2) {
        const lines = file.content
          .split('\n')
          .flatMap((line, index) => (line.includes(input.old_str) ? [index + 1] : []));
        throw new ToolChatError(
          `No replacement was performed. Multiple occurrences of old_str \`${input.old_str}\` in lines: ${lines.join(', ')}. Please ensure it is unique`,
        );
      }
      const content = parts.join(input.new_str);
      await write(file, content);
      return { content: 'The memory file has been edited.', changed: true };
    }
    case 'insert': {
      const path = memoryPath(input.path);
      const file = find(path);
      if (!file) throw missing(path);
      const lines = file.content.split('\n');
      if (input.insert_line > lines.length)
        throw new ToolChatError(
          `Error: Invalid \`insert_line\` parameter: ${input.insert_line}. It should be within the range of lines of the file: [0, ${lines.length}]`,
        );
      lines.splice(input.insert_line, 0, ...input.insert_text.replace(/\n$/, '').split('\n'));
      await write(file, lines.join('\n'));
      return { content: `The file ${path} has been edited.`, changed: true };
    }
    case 'delete': {
      const path = memoryPath(input.path);
      if (path === MEMORY_ROOT)
        throw new ToolChatError(`Error: ${MEMORY_ROOT} itself cannot be deleted.`);
      const gone = [find(path), ...under(path)].filter((each) => each !== undefined);
      if (gone.length === 0) throw missing(path);
      await deps.db.delete(agentMemories).where(
        inArray(
          agentMemories.id,
          gone.map((each) => each.id),
        ),
      );
      return { content: `Successfully deleted ${path}`, changed: true };
    }
    case 'rename': {
      const from = memoryPath(input.old_path);
      const to = memoryPath(input.new_path);
      const file = find(from);
      if (!file) throw missing(from);
      if (to === MEMORY_ROOT || find(to) || under(to).length > 0)
        throw new ToolChatError(`Error: The destination ${to} already exists`);
      await deps.db
        .update(agentMemories)
        .set({ path: to, updatedBy: userId, updatedAt: at })
        .where(eq(agentMemories.id, file.id));
      return { content: `Successfully renamed ${from} to ${to}`, changed: true };
    }
  }
}

/** The agent's memory, as its page shows it: each file with who changed it last. */
export async function memoriesOf(deps: AppDeps, agentId: string): Promise<CloudAgentMemory[]> {
  const files = await filesOf(deps, agentId);
  const people = [...new Set(files.flatMap((each) => (each.updatedBy ? [each.updatedBy] : [])))];
  const names = people.length
    ? await deps.db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, people))
    : [];
  return files.map((each) => ({
    path: each.path,
    content: each.content,
    updatedBy: names.find((person) => person.id === each.updatedBy)?.name ?? null,
    updatedAt: each.updatedAt.toISOString(),
  }));
}

/** How many files each agent's memory holds. */
export async function memoryCounts(
  deps: AppDeps,
  agentIds: string[],
): Promise<Map<string, number>> {
  if (agentIds.length === 0) return new Map();
  const rows = await deps.db
    .select({ agentId: agentMemories.agentId, files: count() })
    .from(agentMemories)
    .where(inArray(agentMemories.agentId, agentIds))
    .groupBy(agentMemories.agentId);
  return new Map(rows.map((row) => [row.agentId, row.files]));
}

/**
 * Its memory forgotten where who reads it changes: all of it when its owner shares it (what it
 * learnt for them alone does not go to others), or – kept to its owner again – what others wrote
 * last (`keptBy`: the owner).
 */
export async function forgetMemory(db: Executor, agentId: string, keptBy?: string) {
  await db
    .delete(agentMemories)
    .where(
      and(
        eq(agentMemories.agentId, agentId),
        keptBy
          ? or(isNull(agentMemories.updatedBy), ne(agentMemories.updatedBy, keptBy))
          : undefined,
      ),
    );
}

/** A person changes a file of the agent's memory on its page (an empty text deletes it). */
export async function keepMemory(
  deps: AppDeps,
  agentId: string,
  userId: string,
  rawPath: string,
  content: string,
): Promise<void> {
  // Said on the page: in German, as what was typed wrong (400), not as a tool's error.
  let path: string;
  try {
    path = memoryPath(rawPath);
  } catch {
    throw badRequest(
      `Eine Datei des Gedächtnisses liegt unter ${MEMORY_ROOT}, etwa ${MEMORY_ROOT}/notizen.md.`,
    );
  }
  if (path === MEMORY_ROOT) throw badRequest('Gib eine Datei an.');
  if (content.length > MAX_MEMORY_FILE)
    throw badRequest(
      `Eine Datei hat höchstens ${MAX_MEMORY_FILE.toLocaleString('de-DE')} Zeichen.`,
    );
  const files = await filesOf(deps, agentId);
  const file = files.find((each) => each.path === path);
  if (!content.trim()) {
    const gone = files.filter((each) => each.path === path || each.path.startsWith(`${path}/`));
    if (gone.length > 0)
      await deps.db.delete(agentMemories).where(
        inArray(
          agentMemories.id,
          gone.map((each) => each.id),
        ),
      );
    return;
  }
  const values = { content, updatedBy: userId, updatedAt: deps.clock.now() };
  if (file) await deps.db.update(agentMemories).set(values).where(eq(agentMemories.id, file.id));
  else if (files.length >= MAX_FILES)
    throw badRequest(`Mehr als ${MAX_FILES} Dateien behält er nicht.`);
  else
    await deps.db
      .insert(agentMemories)
      .values({ id: crypto.randomUUID(), agentId, path, ...values });
}
