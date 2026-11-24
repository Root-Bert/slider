import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  ACCENT_COLORS,
  cloudAgentInputSchema,
  MAX_SENDER_MESSAGE,
  senderPostSchema,
  type SenderMessage,
  cloudAreaNameSchema,
  cloudExtension,
  cloudNameSchema,
  cloudShareRoleSchema,
  isOpenTodo,
  MAX_CLOUD_AGENT_FILE_CHARS,
  MAX_MILESTONE_NAME,
  MAX_TODO_DESCRIPTION,
  MAX_TODO_TITLE,
  searchFold,
  TODO_STATUSES,
  type TodoPriority,
  WRITER_TEMPLATES,
  writerTemplateSchema,
  type CloudArea,
  type CloudNode,
  WRITER_KINDS,
} from '@slider/shared';
import { senderChannels } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';
import { runSettingsTool, SETTINGS_TOOLS, type SettingsToolName } from './agent-settings';
import {
  agentFor,
  createCloudAgent,
  getCloudAgent,
  listCloudAgents,
  messageCloudAgent,
} from './cloud-agents';
import { MAIL_INPUTS, MAIL_TOOLS, type MailToolName } from './mail-agent';
import { runMailTool } from './mail-agent-run';
import { listMessages, postMessage, senderHome } from './sender';
import {
  cloudContext,
  createArea,
  createShare,
  listAreas,
  listNodes,
  listPeople,
  loadNode,
  mimeOf,
  nodeDetail,
  removeShare,
  restoreNodes,
  restoreVersion,
  setAreaMembers,
  storeUpload,
  updateArea,
} from './cloud';
import { runTool, target, TEXT_EXTENSIONS, TOOLS as CLOUD_TOOLS } from './cloud-chat';
import { createTodo, listTodos, milestoneNamed, todoByRef, todoLine, updateTodo } from './todos';
import { deckPlaces, followArea, followMoved, followShares } from './deck-places';
import {
  changeSchema,
  documentForPrompt,
  MAX_CHANGES,
  planChanges,
  PlanError,
} from './document-ai';
import {
  createDocument,
  DocumentLive,
  documentOf,
  editDocument,
  listDocuments,
  openDocument,
} from './documents';
import {
  findWorkspace,
  MCP_TOOLS,
  McpToolError,
  runMcpTool,
  type McpCaller,
  type McpTool,
  type McpToolResult,
} from './mcp';
import {
  CALENDAR_TOOL_NAMES,
  CALENDAR_TOOLS,
  type CalendarToolName,
} from './calendar/agent-tool-defs';
import { runCalendarTool } from './calendar/agent-tools';
import { ToolChatError } from './tool-chat';
import { atLeast } from './workspaces/roles';

/*
 * Cloud in Slider's MCP server: the files of a workspace – own files and areas – for an AI app,
 * as its person. The tools are the Cloud chat's own (`cloud-chat.ts`), run the same way with the
 * same refusals, so what the AI in Cloud can do with files an app can too; a text file is
 * written besides. Named for an app that sees them among Slider's others (`move_files`, not
 * `move`). A connection held to one workspace works in that one.
 */

/** An app's name for each of the Cloud chat's tools. */
const NAMES: Record<string, string> = {
  list_folder: 'list_folder',
  list_tree: 'list_tree',
  search_files: 'search_files',
  read_file: 'read_file',
  create_folder: 'create_folder',
  move_files: 'move',
  rename_file: 'rename',
  delete_files: 'delete',
  reorganize_files: 'apply_plan',
};
const TITLES: Record<string, string> = {
  list_folder: 'List a folder or area',
  list_tree: 'Show everything below a folder or area',
  reorganize_files: 'Make folders, move and rename in one go',
  search_files: 'Search the files by name',
  read_file: 'Read a file',
  create_folder: 'Create a folder',
  move_files: 'Move files, folders and presentations',
  rename_file: 'Rename a file or folder',
  delete_files: 'Delete files and folders',
  write_file: 'Write a text file',
};
const workspaceProperty = {
  workspace: { type: 'string', description: 'Id or name; default: the first.' },
};
const writable = [...TEXT_EXTENSIONS].join(', ');
const read = { readOnlyHint: true, openWorldHint: false } as const;

const fromChat: McpTool[] = Object.entries(NAMES).map(([name, inChat]) => {
  const tool = CLOUD_TOOLS.find((each) => each.name === inChat);
  if (!tool) throw new Error(`No tool ${inChat}`);
  const schema = tool.input_schema as { properties?: Record<string, unknown>; required?: string[] };
  return {
    name,
    title: TITLES[name]!,
    description: `Files (Cloud): ${tool.description ?? ''}`,
    inputSchema: {
      type: 'object',
      properties: { ...schema.properties, ...workspaceProperty },
      ...(schema.required ? { required: schema.required } : {}),
    },
    annotations: ['list_folder', 'list_tree', 'search_files', 'read_file'].includes(name)
      ? read
      : name === 'delete_files'
        ? { destructiveHint: true, openWorldHint: false }
        : { openWorldHint: false },
  };
});

const writeInput = z.object({
  name: cloudNameSchema,
  content: z.string().min(1).max(MAX_CLOUD_AGENT_FILE_CHARS),
  folder: z.string().min(1).max(100).optional(),
  area: z.string().min(1).max(100).optional(),
  own: z.boolean().optional(),
});

const CLOUD_MCP_TOOLS: McpTool[] = [
  ...fromChat,
  {
    name: 'write_file',
    title: TITLES.write_file!,
    description: `Files (Cloud): writes a new text file (${writable}) with \`content\` as its whole text into a folder (folder), to the top of an area (area) or to the top of the person's own files (own: true) – say exactly one of the three. A name taken there gets a number. Returns its id and link.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The file name with its extension.' },
        content: { type: 'string', maxLength: MAX_CLOUD_AGENT_FILE_CHARS },
        folder: { type: 'string', description: 'A folder id.' },
        area: { type: 'string', description: 'An area id: its top level.' },
        own: { type: 'boolean', description: 'true: the top of the person’s own files.' },
        ...workspaceProperty,
      },
      required: ['name', 'content'],
    },
    annotations: { openWorldHint: false },
  },
];

// ── Areas, sharing, what was deleted, versions, documents ───────────────────

const id = z.string().min(1).max(100);
const placeInput = { folder: id.optional(), area: id.optional(), own: z.boolean().optional() };
const placeProperties = {
  folder: { type: 'string', description: 'A folder id.' },
  area: { type: 'string', description: 'An area id: its top level.' },
  own: { type: 'boolean', description: 'true: the top of the person’s own files.' },
} as const;
const people = z.array(z.string().trim().min(1).max(200)).max(200);
const peopleProperty = {
  type: 'array',
  items: { type: 'string' },
  description: 'People of the workspace, each by name, e-mail address or id.',
} as const;
/** As much of a document as one answer carries. */
const DOCUMENT_CHARS = 100_000;
/** A new document's text: as many paragraphs as one step writes. */
const MAX_TEXT_CHARS = 60_000;

const todoTitle = z.string().trim().min(1).max(MAX_TODO_TITLE);
const todoInput = {
  description: z.string().max(MAX_TODO_DESCRIPTION).optional(),
  status: z.enum(TODO_STATUSES).optional(),
  priority: z.number().int().min(0).max(4).optional(),
  assignee: z.string().trim().min(1).max(200).nullable().optional(),
  start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  due: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  milestone: z.string().trim().min(1).max(MAX_MILESTONE_NAME).nullable().optional(),
};
const todoProperties = {
  description: {
    type: 'string',
    description:
      'Details, plain text or Markdown. On update it replaces the old one: keep what stays.',
  },
  status: { type: 'string', enum: [...TODO_STATUSES] },
  priority: { type: 'integer', description: '0 none, 1 urgent, 2 high, 3 medium, 4 low.' },
  assignee: {
    type: ['string', 'null'],
    description:
      'Who does it: a person of the workspace by name, e-mail address or id – on one’s own to-do only the person; null: nobody.',
  },
  start: {
    type: ['string', 'null'],
    description:
      'When work on it begins, YYYY-MM-DD (its bar on the timeline runs to due); null: none.',
  },
  due: { type: ['string', 'null'], description: 'Due date YYYY-MM-DD; null: none.' },
  milestone: {
    type: ['string', 'null'],
    description:
      'The milestone it leads to, by name: one of its place’s (made if there is none of that name yet); null: none.',
  },
} as const;

const INPUTS = {
  list_areas: z.object({}),
  create_area: z.object({
    name: cloudAreaNameSchema,
    people_only: z.boolean().optional(),
    members: people.optional(),
  }),
  update_area: z.object({
    area: id,
    name: cloudAreaNameSchema.optional(),
    people_only: z.boolean().optional(),
    members: people.optional(),
  }),
  file_details: z.object({ item: id }),
  share_file: z.object({
    item: id,
    person: z.string().trim().min(1).max(200),
    role: cloudShareRoleSchema.optional(),
  }),
  unshare_file: z.object({ item: id, person: z.string().trim().min(1).max(200) }),
  list_deleted: z.object({}),
  restore_files: z.object({ items: z.array(id).min(1).max(200) }),
  restore_version: z.object({ item: id, version: id }),
  list_documents: z.object({ query: z.string().trim().max(200).optional() }),
  read_document: z.object({ document: id }),
  create_document: z.object({
    title: z.string().trim().min(1).max(200),
    text: z.string().max(MAX_TEXT_CHARS).optional(),
    template: writerTemplateSchema.optional(),
    ...placeInput,
  }),
  edit_document: z.object({ document: id, changes: z.array(changeSchema).min(1).max(MAX_CHANGES) }),
  list_todos: z.object({ area: id.optional(), open_only: z.boolean().optional() }),
  read_todo: z.object({ todo: id }),
  create_todo: z.object({ title: todoTitle, area: id.optional(), ...todoInput }),
  update_todo: z.object({
    todo: id,
    title: todoTitle.optional(),
    area: id.nullable().optional(),
    ...todoInput,
  }),
};
type MoreName = keyof typeof INPUTS;

const tool = (
  name: MoreName,
  title: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  annotations: McpTool['annotations'] = { openWorldHint: false },
): McpTool => ({
  name,
  title,
  description,
  inputSchema: {
    type: 'object',
    properties: { ...properties, ...workspaceProperty },
    ...(required.length ? { required } : {}),
  },
  annotations,
});

const MORE_TOOLS: McpTool[] = [
  tool(
    'list_areas',
    'List the areas',
    'Files (Cloud): the areas („Bereiche“) the person sees – id, name, whether everyone in the workspace sees it or only its people, who its people are, how many files lie in it and what the person may do there.',
    {},
    [],
    read,
  ),
  tool(
    'create_area',
    'Create an area',
    'Files (Cloud): makes a new area at the top, with the person as its first member – open to everyone in the workspace, or with `people_only: true` seen only by its people (`members`, besides the person). Its name must be free. Returns its id: put things there with area.',
    {
      name: { type: 'string', maxLength: 60 },
      people_only: { type: 'boolean' },
      members: peopleProperty,
    },
    ['name'],
  ),
  tool(
    'update_area',
    'Rename an area, say who sees it',
    'Files (Cloud): renames an area (`name`), opens it to everyone in the workspace or keeps it to its people (`people_only`), or says who its people are (`members`: all of them at once – who is not named leaves; list_areas shows who is in it). Who sees an area sees the presentations in it. For whoever made the area, or an admin.',
    {
      area: { type: 'string', description: 'The area’s id.' },
      name: { type: 'string', maxLength: 60 },
      people_only: { type: 'boolean' },
      members: peopleProperty,
    },
    ['area'],
  ),
  tool(
    'file_details',
    'Details of a file or folder',
    'Files (Cloud): where a file or folder lies, who reaches it there, with whom it is shared besides, and a file’s versions (id, number, date, who) – the newest first.',
    { item: { type: 'string', description: 'A file or folder id.' } },
    ['item'],
    read,
  ),
  tool(
    'share_file',
    'Share a file or folder with a person',
    'Files (Cloud): shares a file or folder with one person of the workspace – `role` view (default) or edit; they find it under „Geteilt“. Sharing again changes the role. A presentation’s file shared this way opens the presentation to them. Only when the person asked for it.',
    {
      item: { type: 'string', description: 'A file or folder id.' },
      person: { type: 'string', description: 'Name, e-mail address or id.' },
      role: { type: 'string', enum: ['view', 'edit'] },
    },
    ['item', 'person'],
  ),
  tool(
    'unshare_file',
    'Stop sharing with a person',
    'Files (Cloud): ends a share with one person at once (file_details shows the shares). Links for people outside are the person’s own to end, in Cloud.',
    {
      item: { type: 'string', description: 'A file or folder id.' },
      person: { type: 'string', description: 'Name, e-mail address or id.' },
    },
    ['item', 'person'],
    { idempotentHint: true, openWorldHint: false },
  ),
  tool(
    'list_deleted',
    'List what was deleted',
    'Files (Cloud): what lies in „Gelöscht“ – id, name, when it went and how many days it stays.',
    {},
    [],
    read,
  ),
  tool(
    'restore_files',
    'Bring deleted files back',
    'Files (Cloud): brings files and folders back from „Gelöscht“ to where they were – or, with that folder gone, to the top of its area.',
    { items: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 200 } },
    ['items'],
  ),
  tool(
    'restore_version',
    'Bring an earlier version back',
    'Files (Cloud): makes an earlier version of a file its newest again (file_details lists a file’s versions). Nothing is overwritten: the one it replaces stays among the versions. Works for a text document and a presentation’s file too.',
    {
      item: { type: 'string', description: 'The file’s id.' },
      version: { type: 'string', description: 'The version’s id.' },
    },
    ['item', 'version'],
  ),
  tool(
    'list_documents',
    'List text documents',
    'Writer: the workspace’s text documents the person reaches, the last changed first – id, title, where it lies, comments. `query`: only those whose title holds it.',
    { query: { type: 'string', maxLength: 200 } },
    [],
    read,
  ),
  tool(
    'read_document',
    'Read a text document',
    'Writer: a document’s whole text, a paragraph a line – `<p id kind …>` with **bold**, *italic*, <u>underlined</u> and [links](…), tables with their cells. The ids are what edit_document names.',
    { document: { type: 'string', description: 'The document’s id (list_documents).' } },
    ['document'],
    read,
  ),
  tool(
    'create_document',
    'Create a text document',
    `Writer: makes a new text document and returns its id and link. \`text\`: what stands in it, a paragraph a line – \`# \` to \`###### \` before a line make it a heading, \`- \` a bullet, \`1. \` a numbered point; marks as read_document shows them. \`template\`: ${WRITER_TEMPLATES.join(', ')} (default plain). It lies in the person's own files („Meine Dateien“) unless a place is said: folder, area or own: true.`,
    {
      title: { type: 'string', maxLength: 200 },
      text: { type: 'string', maxLength: MAX_TEXT_CHARS },
      template: { type: 'string', enum: [...WRITER_TEMPLATES] },
      ...placeProperties,
    },
    ['title'],
  ),
  tool(
    'edit_document',
    'Change a text document',
    'Writer: changes a document’s text, all changes in one call, written at once as a version of its own – people who have it open see it, the version before stays (file_details, restore_version). Paragraphs are named by their id (read_document, read it first): "replace" gives one a new text, "insert" puts a new paragraph after the one named (or before it, `before: true`), "delete" removes one. Everything not named stays. A paragraph marked locked cannot be changed.',
    {
      document: { type: 'string', description: 'The document’s id.' },
      changes: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_CHANGES,
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['replace', 'insert', 'delete'] },
            id: { type: 'string', description: 'The paragraph’s id.' },
            before: { type: 'boolean' },
            text: { type: 'string' },
            kind: { type: 'string', enum: [...WRITER_KINDS] },
            level: { type: 'integer', minimum: 1, maximum: 6 },
            list: { type: 'string', enum: ['none', 'bullet', 'number'] },
          },
          required: ['action', 'id'],
        },
      },
    },
    ['document', 'changes'],
  ),
  tool(
    'list_todos',
    'List to-dos',
    'To-dos: the person’s own (only they see them) and each area’s they see – an area’s list is its project plan. With area: that area’s only. Each with id, number, status, priority, who does it, due date and place, what is under way first.',
    {
      area: { type: 'string', description: 'An area id: only its to-dos.' },
      open_only: { type: 'boolean', description: 'true: without done and canceled ones.' },
    },
    [],
    read,
  ),
  tool(
    'read_todo',
    'Read a to-do',
    'One to-do in full – with its description and where it came from – by its id or its number („12“ for #12).',
    { todo: { type: 'string' } },
    ['todo'],
    read,
  ),
  tool(
    'create_todo',
    'Create a to-do',
    'Makes a to-do. With area: in that area, seen by its people (needs edit rights there); without: the person’s own, only they see it. Only when the person asks for to-dos or for planning work as tasks.',
    {
      title: { type: 'string', description: 'Short, as a task: what is to be done.' },
      area: { type: 'string', description: 'An area id; left out: the person’s own.' },
      ...todoProperties,
    },
    ['title'],
  ),
  tool(
    'update_todo',
    'Change a to-do',
    'Changes a to-do (by id or number): only the fields given. area moves it – an area id, or null for the person’s own; whoever would not see it there is no longer the one doing it.',
    {
      todo: { type: 'string' },
      title: { type: 'string' },
      area: { type: ['string', 'null'] },
      ...todoProperties,
    },
    ['todo'],
  ),
];

/**
 * The person's own beyond the files: Sender's conversations (posted under their name), their
 * mailboxes and mail, their agents, their settings – each as the person may, nothing more.
 */
const PERSON_INPUTS = {
  list_conversations: z.object({}),
  read_conversation: z.object({ conversation: id }),
  post_message: z.object({ conversation: id, text: senderPostSchema.shape.text }),
  list_agents: z.object({}),
  read_agent: z.object({ agent: id }),
  message_agent: z.object({
    agent: id.optional(),
    text: cloudAgentInputSchema.shape.text,
    area: id.optional(),
  }),
};
type PersonName = keyof typeof PERSON_INPUTS;

const personTool = (
  name: PersonName,
  title: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  annotations: McpTool['annotations'] = { openWorldHint: false },
): McpTool => ({
  name,
  title,
  description,
  inputSchema: {
    type: 'object',
    properties: { ...properties, ...workspaceProperty },
    ...(required.length ? { required } : {}),
  },
  annotations,
});

/** An agent's tool (`Anthropic` form) as an app's – the mail's and the settings'. */
const asAppTool = (
  each: { name: string; description?: string; input_schema: unknown },
  title: string,
  annotations: McpTool['annotations'],
): McpTool => {
  const schema = each.input_schema as { properties?: Record<string, unknown>; required?: string[] };
  return {
    name: each.name,
    title,
    description: each.description ?? title,
    inputSchema: {
      type: 'object',
      properties: { ...(schema.properties ?? {}), ...workspaceProperty },
      ...(schema.required?.length ? { required: schema.required } : {}),
    },
    annotations,
  };
};

const MAIL_TITLES: Record<MailToolName, string> = {
  list_mailboxes: 'List the mailboxes',
  prepare_mailbox: 'Prepare a mailbox to connect',
  update_mailbox: 'Change a mailbox',
  check_mailbox: 'Check a mailbox',
  search_mail: 'Search the mail',
  read_mail_thread: 'Read a mail conversation',
  draft_mail_reply: 'Draft a reply',
  file_mail_attachment: 'Put an attachment into the files',
};
const MAIL_READING = new Set<string>(['list_mailboxes', 'search_mail', 'read_mail_thread']);

const PERSON_TOOLS: McpTool[] = [
  personTool(
    'list_conversations',
    'List the conversations',
    "Sender, the workspace's messages: the conversations the person sees – each area's channel and the channels in it, their groups and direct conversations – with id, kind and name.",
    {},
    [],
    read,
  ),
  personTool(
    'read_conversation',
    'Read a conversation',
    'The latest messages of a Sender conversation, by its id (from list_conversations).',
    { conversation: { type: 'string' } },
    ['conversation'],
    read,
  ),
  personTool(
    'post_message',
    'Write in a conversation',
    `Writes a message (at most ${MAX_SENDER_MESSAGE} characters, plain text, „@first name“ names someone) into a Sender conversation under the person's name – everyone there reads it at once. Only when the person asks for exactly this message.`,
    { conversation: { type: 'string' }, text: { type: 'string' } },
    ['conversation', 'text'],
  ),
  personTool(
    'list_agents',
    'List the agents',
    "Cloud's agents the person sees: their own and those shared with them – id, name, what it is about, whether it works right now, whose it is and where it is shared.",
    {},
    [],
    read,
  ),
  personTool(
    'read_agent',
    'Read an agent’s chat',
    "An agent's latest messages in its first chat – what it was asked and what it answered, whether it still works – by its id (from list_agents).",
    { agent: { type: 'string' } },
    ['agent'],
    read,
  ),
  personTool(
    'message_agent',
    'Give an agent an order',
    'Sends an order to one of the agents (agent: its id) – or, without agent, starts a new agent of the person with it (area: an area id makes it that area’s agent, seen by its people). It works on the server with the person’s rights; read_agent shows how far it is.',
    {
      agent: { type: 'string' },
      text: { type: 'string', description: 'The order, as the person would write it.' },
      area: { type: 'string' },
    },
    ['text'],
  ),
  ...MAIL_TOOLS.map((each) =>
    asAppTool(
      each,
      MAIL_TITLES[each.name as MailToolName],
      MAIL_READING.has(each.name) ? read : { openWorldHint: true },
    ),
  ),
  // Reading only: an app does not change the person's settings – they do, in Slider.
  ...SETTINGS_TOOLS.filter((each) => each.name === 'read_settings').map((each) =>
    asAppTool(each, 'Read the settings', read),
  ),
];
const PERSON_NAMES = new Set<string>(Object.keys(PERSON_INPUTS));
const MAIL_NAMES = new Set<string>(Object.keys(MAIL_INPUTS));
const SETTINGS_NAMES = new Set<string>(['read_settings']);
const ALL_PERSON = new Set<string>(PERSON_TOOLS.map((each) => each.name));

/** All an app gets: Slider's tools for presentations, Cloud's for the files, Writer's. */
export const APP_TOOLS: McpTool[] = [
  ...MCP_TOOLS,
  ...CLOUD_MCP_TOOLS,
  ...MORE_TOOLS,
  ...PERSON_TOOLS,
  // The calendars (`calendar/agent-tools.ts`), as the person may.
  ...CALENDAR_TOOLS.map((each): McpTool => ({
    name: each.name,
    title: each.title,
    description: each.description,
    inputSchema: {
      type: 'object',
      properties: { ...each.properties, ...workspaceProperty },
      ...(each.required.length ? { required: each.required } : {}),
    },
    annotations: each.reads ? read : { openWorldHint: false },
  })),
];
const CLOUD_NAMES = new Set(CLOUD_MCP_TOOLS.map((tool) => tool.name));
const MORE_NAMES = new Set<string>(MORE_TOOLS.map((each) => each.name));
const CALENDAR_NAMES = new Set<string>(CALENDAR_TOOL_NAMES);

/** One call: who, where it may reach, and who hears a document change. */
interface Call {
  deps: AppDeps;
  caller: McpCaller;
  userId: string;
  /** The workspace named, or the connection's – `null`: any of the person's. */
  held: string | null;
  /** The workspace to list and make things in: the one named, else the first. */
  workspaceId: () => Promise<string>;
  live: DocumentLive;
}

/** Only where the call may reach: a thing elsewhere is not there. */
function within(call: Call, workspaceId: string, what: string): void {
  if (call.held && call.held !== workspaceId) throw new ToolChatError(`Nothing with id ${what}.`);
}

async function nodeOf(call: Call, nodeId: string, min: 'view' | 'edit' = 'view') {
  const loaded = await loadNode(call.deps, call.userId, nodeId, min);
  within(call, loaded.node.workspaceId, nodeId);
  return loaded;
}

async function personNamed(call: Call, workspaceId: string, wanted: string) {
  const all = await listPeople(call.deps, call.userId, workspaceId);
  const key = searchFold(wanted);
  const exact = all.filter((each) => each.id === wanted || searchFold(each.email) === key);
  const found = exact.length > 0 ? exact : all.filter((each) => searchFold(each.name) === key);
  if (found.length === 1 && found[0]) return found[0];
  if (found.length > 1)
    throw new ToolChatError(
      `${found.length} people are called "${wanted}" – name one by e-mail address: ${found.map((each) => each.email).join(', ')}.`,
    );
  throw new ToolChatError(
    `Nobody "${wanted}" in the workspace. Its people: ${all.map((each) => `${each.name} (${each.email})`).join(', ')}.`,
  );
}

const day = (iso: string) => iso.slice(0, 10);
const areaLine = (area: CloudArea) =>
  `area ${area.id} „${area.name}“ – ${area.visibility === 'workspace' ? 'everyone in the workspace sees it' : 'only its people see it'}; people: ${area.members.map((each) => each.name).join(', ') || 'none named'}; ${area.fileCount} files; the person may ${area.access}`;
const documentLink = (deps: AppDeps, documentId: string) =>
  `${deps.config.webOrigin}/t/${documentId}`;

/** An area the call may reach, as the person sees it. */
async function areaOf(call: Call, areaId: string): Promise<CloudArea> {
  const workspaceId = call.held ?? (await call.workspaceId());
  const ctx = await cloudContext(call.deps.db, workspaceId, call.userId);
  const found = (await listAreas(call.deps, ctx)).find((each) => each.id === areaId);
  if (!found) throw new ToolChatError(`No area with id ${areaId} – list_areas shows them.`);
  return found;
}

/** A new document's text as the changes that write it: a paragraph a line. */
function textChanges(text: string, firstId: string, replaceFirst: boolean) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > MAX_CHANGES)
    throw new ToolChatError(
      `At most ${MAX_CHANGES} paragraphs at once – make it with the first ones and add the rest with edit_document.`,
    );
  return lines.map((line, index) => {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    return {
      action: index === 0 && replaceFirst ? ('replace' as const) : ('insert' as const),
      id: firstId,
      text: heading?.[2] ?? bullet?.[1] ?? numbered?.[1] ?? line,
      kind: heading ? ('heading' as const) : ('text' as const),
      ...(heading && { level: heading[1]!.length }),
      list: bullet ? ('bullet' as const) : numbered ? ('number' as const) : ('none' as const),
    };
  });
}

/** Writes changes into a document as one step of its own; what does not fit is said. */
async function writeChanges(
  call: Call,
  documentId: string,
  changes: z.infer<typeof changeSchema>[],
): Promise<number> {
  const opened = await openDocument(call.deps, call.userId, documentId);
  let plan: ReturnType<typeof planChanges>;
  try {
    plan = planChanges(opened.content.blocks, changes);
  } catch (error) {
    if (error instanceof PlanError) throw new ToolChatError(error.message);
    throw error;
  }
  if (plan.operations.length === 0) return 0;
  await editDocument(
    call.deps,
    call.live,
    call.userId,
    documentId,
    { operations: plan.operations, clientEditId: crypto.randomUUID() },
    { apart: true },
  );
  return plan.operations.length;
}

/** To-dos as the person may (`services/todos.ts`) – an app works as them, under their name. */
async function runTodoTool(
  call: Call,
  name: 'list_todos' | 'read_todo' | 'create_todo' | 'update_todo',
  raw: unknown,
): Promise<string> {
  const { deps, userId } = call;
  const workspaceId = await call.workspaceId();
  const ctx = await cloudContext(deps.db, workspaceId, userId);
  const line = (todo: Parameters<typeof todoLine>[0]) =>
    todoLine(todo, (areaId) => ctx.areas.get(areaId)?.row.name);
  const who = async (assignee: string | null | undefined) =>
    assignee ? (await personNamed(call, workspaceId, assignee)).id : assignee;
  switch (name) {
    case 'list_todos': {
      const input = INPUTS.list_todos.parse(raw);
      const list = await listTodos(deps, userId, workspaceId, { areaId: input.area });
      return (
        list
          .filter((todo) => !input.open_only || isOpenTodo(todo.status))
          .map(line)
          .join('\n') || 'No to-dos.'
      );
    }
    case 'read_todo': {
      const todo = await todoByRef(deps, userId, workspaceId, INPUTS.read_todo.parse(raw).todo);
      return [
        line(todo),
        todo.description ? `\n${todo.description}` : '',
        todo.source?.url ? `\nFrom a mail; where it is done: ${todo.source.url}` : '',
        `\n${deps.config.webOrigin}/w/${workspaceId}/dateien/${todo.areaId ? `bereich/${todo.areaId}/aufgaben` : 'aufgaben'}`,
      ].join('');
    }
    case 'create_todo': {
      const input = INPUTS.create_todo.parse(raw);
      const todo = await createTodo(
        deps,
        userId,
        workspaceId,
        {
          title: input.title,
          description: input.description,
          areaId: input.area ?? null,
          status: input.status,
          priority: input.priority as TodoPriority | undefined,
          assigneeId: await who(input.assignee),
          startOn: input.start,
          dueOn: input.due,
          milestoneId: input.milestone
            ? await milestoneNamed(deps, userId, workspaceId, input.area ?? null, input.milestone)
            : undefined,
        },
        {},
      );
      return `Made: ${line(todo)}`;
    }
    case 'update_todo': {
      const input = INPUTS.update_todo.parse(raw);
      const todo = await todoByRef(deps, userId, workspaceId, input.todo);
      const changed = await updateTodo(
        deps,
        userId,
        todo.id,
        {
          title: input.title,
          description: input.description,
          areaId: input.area,
          status: input.status,
          priority: input.priority as TodoPriority | undefined,
          assigneeId: await who(input.assignee),
          startOn: input.start,
          dueOn: input.due,
          milestoneId: input.milestone
            ? await milestoneNamed(
                deps,
                userId,
                workspaceId,
                input.area !== undefined ? input.area : todo.areaId,
                input.milestone,
              )
            : input.milestone,
        },
        {},
      );
      return `Changed: ${line(changed)}`;
    }
  }
}

async function runMore(call: Call, name: MoreName, raw: unknown): Promise<string> {
  const { deps, userId } = call;
  switch (name) {
    case 'list_todos':
    case 'read_todo':
    case 'create_todo':
    case 'update_todo':
      return runTodoTool(call, name, raw);
    case 'list_areas': {
      const ctx = await cloudContext(deps.db, await call.workspaceId(), userId);
      const areas = await listAreas(deps, ctx);
      return areas.map(areaLine).join('\n') || 'No areas.';
    }
    case 'create_area': {
      const input = INPUTS.create_area.parse(raw);
      const workspaceId = await call.workspaceId();
      const members = [];
      for (const each of input.members ?? [])
        members.push(await personNamed(call, workspaceId, each));
      const ctx = await cloudContext(deps.db, workspaceId, userId);
      const taken = new Set([...ctx.areas.values()].map((each) => each.row.color));
      let made = await createArea(deps, userId, workspaceId, {
        name: input.name,
        description: '',
        // A colour no area has yet, as the dialog offers it.
        color: ACCENT_COLORS.find((each) => !taken.has(each)) ?? ACCENT_COLORS[0],
        visibility: input.people_only ? 'members' : 'workspace',
        parentId: null,
      });
      const others = members.filter((each) => each.id !== userId);
      if (others.length > 0)
        made = await setAreaMembers(deps, userId, made.id, [
          { userId, title: null },
          ...others.map((each) => ({ userId: each.id, title: null })),
        ]);
      return `Made: ${areaLine(made)}.`;
    }
    case 'update_area': {
      const input = INPUTS.update_area.parse(raw);
      if (
        input.name === undefined &&
        input.people_only === undefined &&
        input.members === undefined
      )
        throw new ToolChatError('Say what to change: `name`, `people_only` or `members`.');
      let area = await areaOf(call, input.area);
      // Named before anything is changed: a name that fits nobody changes nothing.
      const members = [];
      for (const each of input.members ?? [])
        members.push(await personNamed(call, area.workspaceId, each));
      if (input.name !== undefined || input.people_only !== undefined)
        area = await updateArea(deps, userId, area.id, {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.people_only !== undefined && {
            visibility: input.people_only ? ('members' as const) : ('workspace' as const),
          }),
        });
      if (input.members !== undefined) {
        // What someone does there stays with them.
        const titles = new Map(area.members.map((each) => [each.id, each.title]));
        area = await setAreaMembers(
          deps,
          userId,
          area.id,
          [...new Map(members.map((each) => [each.id, each])).values()].map((each) => ({
            userId: each.id,
            title: titles.get(each.id) ?? null,
          })),
        );
      }
      // Its presentations are seen by whom it says now.
      if (input.people_only !== undefined || input.members !== undefined)
        await followArea(deps, area.id);
      return `Now: ${areaLine(area)}.`;
    }
    case 'file_details': {
      const { item } = INPUTS.file_details.parse(raw);
      await nodeOf(call, item);
      const detail = await nodeDetail(deps, userId, item);
      const { node } = detail;
      const where = [
        detail.area ? `area „${detail.area.name}“` : 'Meine Dateien',
        ...detail.path.slice(0, -1).map((each) => each.name),
      ].join(' › ');
      const reach =
        detail.audience.kind === 'owner'
          ? 'its owner alone'
          : detail.audience.kind === 'workspace'
            ? `everyone in the workspace (${detail.audience.count})`
            : `the area’s people (${detail.audience.count})`;
      return [
        `${node.kind} ${node.id} „${node.name}“ in ${where} – changed ${day(node.updatedAt)}; the person may ${node.access}.`,
        `Reached there by ${reach}.`,
        `Shared with: ${
          detail.shares
            .map((share) =>
              share.user ? `${share.user.name} (${share.role})` : 'people outside, by a link',
            )
            .join(', ') || 'nobody besides'
        }.`,
        ...(node.kind === 'file'
          ? [
              'Versions:',
              ...detail.versions.map(
                (version) =>
                  `- version ${version.id}: no. ${version.number}, ${day(version.createdAt)} by ${version.createdBy.name}${version.label ? `, „${version.label}“` : ''}${version.current ? ' (current)' : ''}`,
              ),
            ]
          : []),
      ].join('\n');
    }
    case 'share_file': {
      const input = INPUTS.share_file.parse(raw);
      const { node } = await nodeOf(call, input.item, 'edit');
      const person = await personNamed(call, node.workspaceId, input.person);
      if (person.id === userId) throw new ToolChatError('That is the person themselves.');
      const role = input.role ?? 'view';
      await createShare(deps, userId, node.id, { userId: person.id, role });
      // A presentation's file: the presentation is open to exactly those it is shared with.
      await followShares(deps, node.id);
      return `Shared „${node.name}“ with ${person.name} (${role}).`;
    }
    case 'unshare_file': {
      const input = INPUTS.unshare_file.parse(raw);
      const { node } = await nodeOf(call, input.item, 'edit');
      const person = await personNamed(call, node.workspaceId, input.person);
      const { shares } = await nodeDetail(deps, userId, node.id);
      const share = shares.find((each) => each.user?.id === person.id);
      if (!share) return `„${node.name}“ is not shared with ${person.name}.`;
      await removeShare(deps, userId, share.id);
      await followShares(deps, node.id);
      return `„${node.name}“ is no longer shared with ${person.name}.`;
    }
    case 'list_deleted': {
      const { nodes } = await listNodes(deps, userId, await call.workspaceId(), {
        scope: 'trash',
      });
      return (
        nodes
          .map(
            (node: CloudNode) =>
              `${node.kind} ${node.id} „${node.name}“${node.deleted ? ` – deleted ${day(node.deleted.at)} by ${node.deleted.by.name}, ${node.deleted.daysLeft} days left` : ''}`,
          )
          .join('\n') || 'Nothing in „Gelöscht“.'
      );
    }
    case 'restore_files': {
      const { items } = INPUTS.restore_files.parse(raw);
      for (const each of items) {
        const loaded = await loadNode(deps, userId, each, 'view', { deleted: true });
        within(call, loaded.node.workspaceId, each);
      }
      const before = await deckPlaces(deps.db, items);
      const result = await restoreNodes(deps, userId, items);
      // Their folder may be gone, and they lie at the top of their area now.
      await followMoved(deps, result.nodes, userId, before);
      return [
        `Back: ${result.nodes.length}${result.nodes.length ? ` (${result.nodes.map((node) => `„${node.name}“`).join(', ')})` : ''}.`,
        ...result.skipped.map((each) => `Not „${each.name}“: ${each.reason}`),
      ].join('\n');
    }
    case 'restore_version': {
      const { item, version } = INPUTS.restore_version.parse(raw);
      await nodeOf(call, item, 'edit');
      // The file's own version: none of another file, or of another workspace.
      const { versions } = await nodeDetail(deps, userId, item);
      if (!versions.some((each) => each.id === version))
        throw new ToolChatError(
          `That file has no version with id ${version} – file_details lists them.`,
        );
      const node = await restoreVersion(deps, userId, version);
      return `„${node.name}“: that version is its newest again.`;
    }
    case 'list_documents': {
      const { query } = INPUTS.list_documents.parse(raw);
      const all = await listDocuments(deps, userId, await call.workspaceId(), 'all');
      const needle = searchFold(query ?? '');
      const found = needle ? all.filter((each) => searchFold(each.title).includes(needle)) : all;
      return (
        found
          .slice(0, 100)
          .map(
            (each) =>
              `document ${each.id} „${each.title}“ in ${each.place} – changed ${day(each.updatedAt)}${each.openComments ? `, ${each.openComments} open comments` : ''}${each.permissions.canEdit ? '' : ', read only'}: ${documentLink(deps, each.id)}`,
          )
          .join('\n') + (found.length > 100 ? `\n… and ${found.length - 100} more.` : '') ||
        'No documents.'
      );
    }
    case 'read_document': {
      const { document } = INPUTS.read_document.parse(raw);
      within(call, (await documentOf(deps, userId, document)).workspaceId, document);
      const opened = await openDocument(deps, userId, document);
      const whole = documentForPrompt(opened.content.blocks);
      return [
        `„${opened.document.title}“ (document id ${opened.document.id}) in ${opened.document.place}${opened.document.permissions.canEdit ? '' : ', read only'}: ${documentLink(deps, document)}`,
        whole.length > DOCUMENT_CHARS
          ? `${whole.slice(0, DOCUMENT_CHARS)}\n… the text goes on (${whole.length} characters in all).`
          : whole,
      ].join('\n\n');
    }
    case 'create_document': {
      const input = INPUTS.create_document.parse(raw);
      const workspaceId = await call.workspaceId();
      const placed = input.folder ?? input.area ?? input.own;
      const into = placed === undefined ? null : target(input);
      if (input.folder) {
        const { node } = await nodeOf(call, input.folder, 'edit');
        if (node.workspaceId !== workspaceId || node.kind !== 'folder')
          throw new ToolChatError(`No folder with id ${input.folder}.`);
      }
      // Made where it is to go – unless said, in the person's own files.
      const made = await createDocument(
        deps,
        userId,
        {
          workspaceId,
          title: input.title,
          ...(input.template && { template: input.template }),
        },
        into ?? {},
      );
      const said = [
        `Created „${made.title}“ (document id ${made.id}): ${documentLink(deps, made.id)}`,
      ];
      if (input.text?.trim()) {
        const { content } = await openDocument(deps, userId, made.id);
        const flat = content.blocks.flatMap((block) => (block.type === 'paragraph' ? [block] : []));
        const plain = (input.template ?? 'plain') === 'plain';
        // A plain one starts with its one empty line; a template's text stands, this follows it.
        const at = plain ? flat[0] : flat.at(-1);
        if (!at) said.push('Its text was not written: the document has no paragraph to start at.');
        else {
          const written = await writeChanges(call, made.id, textChanges(input.text, at.id, plain));
          said.push(`Text written: ${written} paragraphs.`);
        }
      }
      said.push(
        into
          ? 'It lies where it was to go.'
          : "It lies in the person's own files („Meine Dateien“).",
      );
      return said.join('\n');
    }
    case 'edit_document': {
      const input = INPUTS.edit_document.parse(raw);
      const document = await documentOf(deps, userId, input.document);
      within(call, document.workspaceId, input.document);
      if (!document.permissions.canEdit)
        throw new ToolChatError('The person may read this document, not change it.');
      const written = await writeChanges(call, input.document, input.changes);
      return written === 0
        ? 'Nothing to change.'
        : `Written into „${document.title}“: ${documentLink(deps, input.document)}`;
    }
  }
}

async function writeFile(
  deps: AppDeps,
  caller: McpCaller,
  workspaceId: string,
  raw: unknown,
): Promise<string> {
  const input = writeInput.parse(raw);
  const userId = caller.viewer.author.id;
  if (!TEXT_EXTENSIONS.has(cloudExtension(input.name)))
    throw new ToolChatError(`Only text files (${writable}) can be written.`);
  if (!atLeast((await cloudContext(deps.db, workspaceId, userId)).role, 'member'))
    throw new ToolChatError('Not done: writing files is for members and admins of the workspace.');
  const into = target(input);
  if (input.folder) {
    const { node } = await loadNode(deps, userId, input.folder, 'edit');
    if (node.workspaceId !== workspaceId || node.kind !== 'folder')
      throw new ToolChatError(`No folder with id ${input.folder}.`);
  }
  const bytes = new TextEncoder().encode(input.content);
  const { node } = await storeUpload(
    deps,
    userId,
    workspaceId,
    { name: input.name, keepBoth: true, ...into },
    {
      data: (async function* () {
        yield bytes;
      })(),
      size: bytes.byteLength,
      mimeType: mimeOf(input.name),
    },
  );
  return `Wrote „${node.name}“ (file id ${node.id}): ${deps.config.webOrigin}/w/${workspaceId}/dateien?datei=${node.id}`;
}

/** What a conversation's message reads as for an app: when, who, what. */
const messageLine = (each: SenderMessage) =>
  `${each.createdAt} ${each.agent ? `${each.agent.title} (agent)` : (each.author?.name ?? 'someone gone')}: ${each.text}`;

/**
 * Runs one of the person's own tools: Sender, mail, agents, settings – as the person, within the
 * workspace the call may reach (`held`).
 */
async function runPerson(
  deps: AppDeps,
  caller: McpCaller,
  held: string | null,
  workspaceOf: () => Promise<string>,
  name: string,
  raw: unknown,
): Promise<string> {
  const { viewer } = caller;
  const userId = viewer.author.id;
  if (viewer.kind !== 'owner') throw new ToolChatError('Only for a signed-in person.');
  if (SETTINGS_NAMES.has(name)) return runSettingsTool(deps, viewer, name as SettingsToolName, raw);
  if (MAIL_NAMES.has(name))
    return (await runMailTool(deps, userId, await workspaceOf(), name as MailToolName, raw))
      .content;
  if (!PERSON_NAMES.has(name)) throw new ToolChatError(`No tool "${name}".`);
  /** A conversation the person sees, in the workspace the call may reach. */
  const conversationIn = async (conversation: string) => {
    const [row] = await deps.db
      .select({ workspaceId: senderChannels.workspaceId })
      .from(senderChannels)
      .where(eq(senderChannels.id, conversation));
    if (!row || (held && held !== row.workspaceId))
      throw new ToolChatError(`Nothing with id ${conversation}.`);
  };
  switch (name as PersonName) {
    case 'list_conversations': {
      const home = await senderHome(deps, userId, await workspaceOf());
      const lines = [
        ...home.areas.flatMap((area) =>
          area.channels.map(
            (each) =>
              `${each.id} ${each.kind === 'area' ? `channel of the area „${area.name}“` : `#${each.name} in „${area.name}“`}${each.canWrite ? '' : ' (read only)'}`,
          ),
        ),
        ...home.groups.map((each) => `${each.id} group „${each.name}“`),
        ...home.direct.map(
          (each) => `${each.id} direct with ${each.person?.name ?? 'someone gone'}`,
        ),
      ];
      return lines.join('\n') || 'No conversations.';
    }
    case 'read_conversation': {
      const input = PERSON_INPUTS.read_conversation.parse(raw);
      await conversationIn(input.conversation);
      const page = await listMessages(deps, userId, input.conversation);
      return (
        page.messages
          .filter((each) => !each.deleted)
          .map(messageLine)
          .join('\n') || 'Nothing written there yet.'
      );
    }
    case 'post_message': {
      const input = PERSON_INPUTS.post_message.parse(raw);
      await conversationIn(input.conversation);
      await postMessage(deps, userId, input.conversation, input.text, viewer);
      return 'Posted.';
    }
    case 'list_agents': {
      const agents = await listCloudAgents(deps, userId, await workspaceOf());
      return (
        agents
          .map(
            (each) =>
              `${each.id} „${each.title}“${each.summary ? ` – ${each.summary}` : ''}${each.running ? ' (working)' : ''}${each.mine ? '' : ` (${each.owner.name}'s)`}${each.shared ? ' (shared)' : ''}`,
          )
          .join('\n') || 'No agents.'
      );
    }
    case 'read_agent': {
      const input = PERSON_INPUTS.read_agent.parse(raw);
      const row = await agentFor(deps, userId, input.agent);
      if (held && held !== row.workspaceId)
        throw new ToolChatError(`Nothing with id ${input.agent}.`);
      const agent = await getCloudAgent(deps, viewer.author, input.agent);
      const chat = agent.chats[0];
      const said = (chat?.messages ?? [])
        .slice(-12)
        .map(
          (each) =>
            `${each.role === 'user' ? (each.author?.name ?? 'someone') : agent.title}: ${each.text}`,
        );
      return [
        `„${agent.title}“${agent.running ? ' – working now' : ''}`,
        ...said,
        `${deps.config.webOrigin}/w/${row.workspaceId}/dateien/agenten/${row.id}`,
      ].join('\n');
    }
    case 'message_agent': {
      const input = PERSON_INPUTS.message_agent.parse(raw);
      if (input.agent) {
        const row = await agentFor(deps, userId, input.agent);
        if (held && held !== row.workspaceId)
          throw new ToolChatError(`Nothing with id ${input.agent}.`);
        // An app's words, not the person's own: no mail, connections or what only they open.
        await messageCloudAgent(
          deps,
          viewer,
          row.id,
          input.text,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          true,
        );
        return `Sent to „${row.title}“ – it works on it now (read_agent ${row.id}).`;
      }
      const workspaceId = await workspaceOf();
      const made = await createCloudAgent(
        deps,
        viewer,
        workspaceId,
        input.text,
        input.area ?? null,
        undefined,
        undefined,
        undefined,
        true,
      );
      return `A new agent „${made.title}“ (id ${made.id}) works on it now (read_agent ${made.id}).`;
    }
  }
}

/** Runs one of an app's tools for the caller – a presentation's or a file's. */
export async function runAppTool(
  deps: AppDeps,
  caller: McpCaller,
  name: string,
  args: Record<string, unknown> = {},
  /** Who has a document open hears a change through this (`routes/documents.ts`). */
  live: DocumentLive = new DocumentLive(),
): Promise<McpToolResult> {
  if (
    !CLOUD_NAMES.has(name) &&
    !MORE_NAMES.has(name) &&
    !ALL_PERSON.has(name) &&
    !CALENDAR_NAMES.has(name)
  )
    return runMcpTool(deps, caller, name, args);
  try {
    const { workspace, ...input } = args;
    const named = typeof workspace === 'string' ? workspace : undefined;
    const workspaceOf = async () => (await findWorkspace(deps, caller, named)).id;
    let said: string;
    if (CALENDAR_NAMES.has(name)) {
      said = await runCalendarTool(
        deps,
        caller.viewer.author.id,
        await workspaceOf(),
        name as CalendarToolName,
        input,
      );
    } else if (ALL_PERSON.has(name)) {
      said = await runPerson(
        deps,
        caller,
        named ? await workspaceOf() : caller.workspaceId,
        workspaceOf,
        name,
        input,
      );
    } else if (MORE_NAMES.has(name)) {
      said = await runMore(
        {
          deps,
          caller,
          userId: caller.viewer.author.id,
          held: named ? await workspaceOf() : caller.workspaceId,
          workspaceId: workspaceOf,
          live,
        },
        name as MoreName,
        input,
      );
    } else {
      const workspaceId = await workspaceOf();
      said =
        name === 'write_file'
          ? await writeFile(deps, caller, workspaceId, input)
          : (
              await runTool(
                deps,
                { userId: caller.viewer.author.id, workspaceId, viewer: caller.viewer },
                NAMES[name]!,
                input,
              )
            ).content;
    }
    return { content: [{ type: 'text', text: said }] };
  } catch (error) {
    const message =
      error instanceof ToolChatError || error instanceof McpToolError || error instanceof ApiError
        ? error.message
        : error instanceof z.ZodError
          ? z.prettifyError(error)
          : null;
    if (message === null) deps.log.error(`MCP tool ${name} failed`, error);
    return {
      content: [{ type: 'text', text: message ?? 'That did not work – a problem on the server.' }],
      isError: true,
    };
  }
}
