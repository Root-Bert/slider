import { and, asc, eq, inArray } from 'drizzle-orm';
import { blankOdp } from '@slider/odp';
import {
  BOARD_NOTE,
  DECK_KINDS,
  DECK_SEARCH_MIN_LENGTH,
  MATERIAL_CARD,
  MAX_BOARD_NOTE_LENGTH,
  MAX_CREATED_SLIDES,
  MIN_CREATED_SLIDES,
  boardUrlSchema,
  createCommentInputSchema,
  deckKindSchema,
  markdownToRich,
  searchFold,
  type BoardFrame,
  type AiProposal,
  type Comment,
  type Deck,
  type DeckSearchHit,
  type Slide,
  type Viewer,
} from '@slider/shared';
import { z } from 'zod';
import { openToViewer, requireDeckAccess, type DeckViewerAccess } from '../auth/access';
import {
  aiProposals,
  deckBoardItems,
  deckMaterials,
  decks,
  materialChunks,
  slideVersions,
  workspaceMasters,
  type DeckRow,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { aiLimits } from '../http/ai-limits';
import { ApiError } from '../http/errors';
import { createProposal, listProposals } from './ai-proposals';
import { createComment, listComments } from './comments';
import { blocker, currentRevision, editTarget } from './edits/target';
import { getCreation, offerCreation, startCreation } from './deck-creation';
import { searchDecks } from './deck-search';
import { createDeckFromFile, listWorkspaceDecks, toDeckDto } from './decks';
import {
  addMaterial,
  createBoardItem,
  deleteBoardItem,
  moveBoard,
  updateBoardItem,
} from './materials';
import {
  MATERIAL_TOOLS,
  asJpeg,
  describeMaterial,
  materialsOf,
  runMaterialTool,
} from './material-tools';
import { listSlides } from './slides';
import { deckFileFromMaster, listWorkspaceMasters } from './workspace-masters';
import { listWorkspaces, resolveUploadWorkspace } from './workspaces';
import { rolesOf } from './workspaces/roles';

/*
 * Slider's MCP server (`routes/mcp.ts`): the tools an AI app (Claude, ChatGPT, Claude Code …)
 * uses for its person, with their rights – find and read presentations, look at slides, read
 * comments and the material on a deck's board, put research there (notes as stickers, links,
 * files), comment, and start a new deck that Slider's own AI builds from its board. A connection
 * held to one workspace sees only that one. Texts for the AI in English, what people see on the
 * board in the language the app writes.
 */

/** Who is calling: the person, and the workspace the connection is held to (`null`: all). */
export interface McpCaller {
  viewer: Viewer;
  workspaceId: string | null;
}

export type McpContent =
  { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  annotations: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export const MCP_INSTRUCTIONS = `Slider is where a team reviews and builds presentations. Presentations live in workspaces. Every presentation has its material – a board on a page of its own beside the slides, called "Material", never part of the deck – where people collect what the deck is built from: files (PDFs, documents, spreadsheets, pictures), links and notes (stickers with rich text).

How to work with it:
- Find: search looks through everything at once (presentations, their comments, the files and notes on all boards) and fetch reads a hit; list_presentations lists presentations (by title or text on slides and in comments), then get_presentation for its slides' text and what lies on its board. view_slide shows a slide as it looks; list_comments reads the feedback.
- Research: list_materials, search_materials, read_material, read_sheet and view_material read the board's files.
- Contribute: add_note puts a sticker on the board (Markdown; one finding or summary per note, with its sources), add_link a web address, add_file a file (text you wrote, or its bytes as base64 – download it yourself first). add_comment comments on a slide. Place several notes one by one; they are laid out next to what is there. Everything shows at once to everyone on the deck, under the person's name – write in the deck's language, as the person would.
- Change slides: edit_slides has Slider's own AI edit the real slides (it works like a person asking it in a comment; anyone can undo it). Look at the result with view_slide.
- New presentation: create_presentation makes an empty one; put material on its board; then build_presentation has Slider's AI build the slides from the board and a description (it takes a few minutes; get_presentation shows how far it is).
Presentations, slides, materials and board items are named by their ids; links to open them in Slider come with the answers – give them to the person.`;

const presentationProperty = {
  presentation: {
    type: 'string',
    description:
      'The presentation: its id (list_presentations), its Slider link, or its exact title.',
  },
};

/** The board tools Slider's own AI uses, with the presentation added. */
const materialTools: McpTool[] = MATERIAL_TOOLS.filter(
  (tool) => tool.name !== 'list_materials',
).map((tool) => {
  const schema = tool.input_schema as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  return {
    name: tool.name,
    title: {
      read_material: 'Read a file of the board',
      read_sheet: 'Read a spreadsheet of the board',
      search_materials: "Search the board's files",
      view_material: 'Look at a file of the board',
    }[tool.name]!,
    description: tool.description ?? '',
    inputSchema: {
      type: 'object',
      properties: { ...presentationProperty, ...schema.properties },
      required: ['presentation', ...(schema.required ?? [])],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  };
});

const read = { readOnlyHint: true, openWorldHint: false } as const;

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'search',
    title: 'Search Slider',
    description:
      'Searches everything the person can open in Slider at once: presentations (titles, slide text, comments) and what lies on their boards (the text of files – PDFs, documents, spreadsheets –, notes and stickers). Returns JSON `{"results": [{"id", "title", "url", "snippet"}]}`, best first; `fetch` reads a result in full.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Words to look for (any case, accents ignored; places with most of them first).',
        },
      },
      required: ['query'],
    },
    annotations: read,
  },
  {
    name: 'fetch',
    title: 'Read a search result',
    description:
      'Reads one result of `search` in full by its id: a presentation (its slides\' text and board), a file of a board (its whole text, page by page) or a note. Returns JSON `{"id", "title", "text", "url", "metadata"}`.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The id from search.' } },
      required: ['id'],
    },
    annotations: read,
  },
  {
    name: 'list_workspaces',
    title: 'List workspaces',
    description:
      "The person's workspaces (id, name, their role) with the templates presentations can be made from.",
    inputSchema: { type: 'object', properties: {} },
    annotations: read,
  },
  {
    name: 'list_presentations',
    title: 'Find presentations',
    description:
      'Presentations the person can open, most recently changed first: id, title, workspace, slides, open comments, link. `query` finds titles and text on slides and in comments (with the places it was found).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for (any case, accents ignored).' },
        workspace: { type: 'string', description: 'Only this workspace (id or name).' },
        archived: { type: 'boolean', description: 'Also archived presentations (default false).' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Default 30.' },
      },
    },
    annotations: read,
  },
  {
    name: 'get_presentation',
    title: 'Read a presentation',
    description:
      "A presentation: title, workspace, link, what the person may do, every slide's number, title and text (hidden ones marked) with open comments, what lies on its board, and – while Slider's AI builds it – how far it is.",
    inputSchema: {
      type: 'object',
      properties: presentationProperty,
      required: ['presentation'],
    },
    annotations: read,
  },
  {
    name: 'view_slide',
    title: 'Look at a slide',
    description: 'A slide as it looks (a picture), with its text and the comments on it.',
    inputSchema: {
      type: 'object',
      properties: {
        ...presentationProperty,
        slide: { type: 'integer', minimum: 1, description: 'Its number (1 = the first).' },
      },
      required: ['presentation', 'slide'],
    },
    annotations: read,
  },
  {
    name: 'list_comments',
    title: 'Read comments',
    description:
      'The comments on a presentation with their replies: who, on which slide, open or done. Default: open ones only.',
    inputSchema: {
      type: 'object',
      properties: {
        ...presentationProperty,
        slide: { type: 'integer', minimum: 1, description: 'Only on this slide.' },
        done: { type: 'boolean', description: 'Also those marked done (default false).' },
      },
      required: ['presentation'],
    },
    annotations: read,
  },
  {
    name: 'add_comment',
    title: 'Comment on a slide',
    description:
      "Writes a comment on a slide (or on the whole presentation without `slide`), or a reply to a comment (`reply_to`). Shown at once under the person's name.",
    inputSchema: {
      type: 'object',
      properties: {
        ...presentationProperty,
        text: { type: 'string', minLength: 1, maxLength: 10000 },
        slide: { type: 'integer', minimum: 1 },
        reply_to: {
          type: 'string',
          description: 'The id of the comment to answer (list_comments).',
        },
      },
      required: ['presentation', 'text'],
    },
    annotations: { openWorldHint: false },
  },
  {
    name: 'edit_slides',
    title: 'Have Slider’s AI change slides',
    description:
      "Has Slider's own AI change the presentation's real slides, as a person asks it in a comment: `instruction` says what (rewrite or shorten text, restructure a slide, add a chart or picture, add, split, reorder or delete slides …), starting at slide `slide`. It is written as a comment under the person's name; the change lands at once, and anyone can undo it in that comment's thread. Waits up to two minutes and returns what the AI did – look at the result with view_slide. Be specific (numbers, wording, which slides); one request per call. Needs the right to edit and the workspace's AI key.",
    inputSchema: {
      type: 'object',
      properties: {
        ...presentationProperty,
        slide: {
          type: 'integer',
          minimum: 1,
          description: 'The slide it starts at (1 = the first).',
        },
        instruction: { type: 'string', minLength: 1, maxLength: 4000 },
      },
      required: ['presentation', 'slide', 'instruction'],
    },
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'list_materials',
    title: "List the board's material",
    description:
      "Everything in a presentation's material (its board, the page „Material“): files with id, kind, size, pages or sheets and the start of their text; notes, stickers, links and folders with their id and text. Items marked „yours“ the person may change.",
    inputSchema: {
      type: 'object',
      properties: presentationProperty,
      required: ['presentation'],
    },
    annotations: read,
  },
  ...materialTools,
  {
    name: 'add_note',
    title: 'Put a note on the board',
    description:
      "Puts a sticker with `text` (Markdown: headings, **bold**, lists, links) on the presentation's board, next to what is there. With `attach_to` (a file's or link's id) it is a note beside that thing instead. Up to 10 000 characters – one finding or summary per note, with its sources.",
    inputSchema: {
      type: 'object',
      properties: {
        ...presentationProperty,
        text: { type: 'string', minLength: 1, maxLength: MAX_BOARD_NOTE_LENGTH },
        attach_to: { type: 'string', description: 'Id of a file or link on the board.' },
      },
      required: ['presentation', 'text'],
    },
    annotations: { openWorldHint: false },
  },
  {
    name: 'add_link',
    title: 'Put a link on the board',
    description: 'Puts a web address (http/https) as a card on the board, with an optional title.',
    inputSchema: {
      type: 'object',
      properties: {
        ...presentationProperty,
        url: { type: 'string' },
        title: { type: 'string', maxLength: 300 },
      },
      required: ['presentation', 'url'],
    },
    annotations: { openWorldHint: false },
  },
  {
    name: 'add_file',
    title: 'Put a file on the board',
    description:
      "Puts a file on the board – Slider reads its text for everyone's AI. Give exactly one of `text` (a text or Markdown file you write, e.g. research notes, a table as CSV) or `base64` (the file's bytes: PDF, Word, PowerPoint, Excel, pictures …). Slider downloads nothing itself – a web page goes on the board with add_link. `name` with its extension decides the kind.",
    inputSchema: {
      type: 'object',
      properties: {
        ...presentationProperty,
        name: { type: 'string', description: 'File name with extension, e.g. "Marktstudie.pdf".' },
        text: { type: 'string' },
        base64: { type: 'string' },
      },
      required: ['presentation', 'name'],
    },
    annotations: { openWorldHint: false },
  },
  {
    name: 'update_note',
    title: 'Change a note',
    description:
      "Replaces the text (Markdown) of one of the person's own notes or stickers on the board, or a link's title.",
    inputSchema: {
      type: 'object',
      properties: {
        ...presentationProperty,
        item: { type: 'string', description: 'Its id (list_materials).' },
        text: { type: 'string', maxLength: MAX_BOARD_NOTE_LENGTH },
      },
      required: ['presentation', 'item', 'text'],
    },
    annotations: { idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'delete_item',
    title: 'Delete from the board',
    description:
      "Deletes a file, note, sticker or link from the board – the person's own (or anyone's where they manage the presentation). Cannot be undone.",
    inputSchema: {
      type: 'object',
      properties: { ...presentationProperty, item: { type: 'string' } },
      required: ['presentation', 'item'],
    },
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'create_presentation',
    title: 'Create a presentation',
    description:
      "Makes a new, empty presentation (one blank slide) and returns its id and link. `template`: a template of the workspace (list_workspaces) for its look. Put material on its board next, then build_presentation lets Slider's AI build it.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 200 },
        workspace: { type: 'string', description: 'Id or name; default: the first.' },
        template: { type: 'string', description: 'Id of a template of that workspace.' },
      },
    },
    annotations: { openWorldHint: false },
  },
  {
    name: 'build_presentation',
    title: 'Build it with Slider’s AI',
    description: `Slider's AI builds the slides of a presentation that is still empty (create_presentation) from its board's material and \`description\` – what it is about, for whom, what it should achieve, what must be in it. \`kind\`: ${DECK_KINDS.map((kind) => `${kind.id} (${kind.meaning})`).join(', ')}. \`pages\`: ${MIN_CREATED_SLIDES}–${MAX_CREATED_SLIDES} slides. Runs a few minutes in the background with the workspace's AI key; get_presentation shows its progress.`,
    inputSchema: {
      type: 'object',
      properties: {
        ...presentationProperty,
        description: { type: 'string', minLength: 1, maxLength: 8000 },
        kind: { type: 'string', enum: DECK_KINDS.map((kind) => kind.id) },
        pages: { type: 'integer', minimum: MIN_CREATED_SLIDES, maximum: MAX_CREATED_SLIDES },
      },
      required: ['presentation', 'description'],
    },
    annotations: { openWorldHint: false },
  },
];

const TOOL_NAMES = new Set(MCP_TOOLS.map((tool) => tool.name));

/** A mistake the AI can fix by calling again – told as the tool's error. */
class ToolError extends Error {}

const text = (value: string): McpToolResult => ({ content: [{ type: 'text', text: value }] });

/** A window of the page's own (`aiLimits`): one budget whether asked in Slider or by an app. */
function withinLimit(hit: { allowed: boolean; retryAfterS: number }, what: string) {
  if (!hit.allowed)
    throw new ToolError(`Too many ${what} at once – try again in ${hit.retryAfterS} s.`);
}

const deckLink = (deps: AppDeps, deckId: string, suffix = '') =>
  `${deps.config.webOrigin}/d/${deckId}${suffix}`;

// ── Who may see what ───────────────────────────────────────────────────────

/** The caller's workspaces and roles – only the connection's workspace when it is held to one. */
async function accessOf(deps: AppDeps, caller: McpCaller): Promise<DeckViewerAccess> {
  const roles = await rolesOf(deps.db, caller.viewer.author.id);
  if (caller.workspaceId)
    for (const id of [...roles.keys()]) if (id !== caller.workspaceId) roles.delete(id);
  return { kind: 'user', userId: caller.viewer.author.id, roles };
}

/** The caller's workspaces – not blocked ones (BER-167), only the connection's when held to one. */
async function workspacesOf(deps: AppDeps, caller: McpCaller) {
  const all = await listWorkspaces(deps, caller.viewer.author.id);
  return all.filter(
    (each) => !each.blocked && (!caller.workspaceId || each.id === caller.workspaceId),
  );
}

async function findWorkspace(deps: AppDeps, caller: McpCaller, wanted: string | undefined) {
  const mine = await workspacesOf(deps, caller);
  if (!wanted) {
    if (!mine[0]) throw new ToolError('The person has no workspace Slider lets this app into.');
    return mine[0];
  }
  const key = wanted.trim();
  const found =
    mine.find((each) => each.id === key) ??
    mine.find((each) => searchFold(each.name) === searchFold(key));
  if (!found)
    throw new ToolError(
      `No workspace "${key}". The person's: ${mine.map((each) => `${each.name} (${each.id})`).join(', ') || 'none'}.`,
    );
  return found;
}

const DECK_LINK = /\/d\/([A-Za-z0-9-]{8,})/;

/** The presentation named – by id, link or exact title – checked for the right and workspace. */
async function findDeck(
  deps: AppDeps,
  caller: McpCaller,
  wanted: unknown,
  right: 'view' | 'comment' | 'own' = 'view',
): Promise<DeckRow> {
  if (typeof wanted !== 'string' || !wanted.trim())
    throw new ToolError('Name the presentation (`presentation`: its id from list_presentations).');
  const key = wanted.trim();
  let id = DECK_LINK.exec(key)?.[1] ?? key;
  const [byId] = await deps.db.select({ id: decks.id }).from(decks).where(eq(decks.id, id));
  if (!byId) {
    // Only the caller's workspaces (the connection's one): titles elsewhere are none of theirs.
    const access = await accessOf(deps, caller);
    const workspaceIds = [...access.roles.keys()];
    const rows =
      workspaceIds.length === 0
        ? []
        : await deps.db
            .select({
              id: decks.id,
              title: decks.title,
              updatedAt: decks.updatedAt,
              archivedAt: decks.archivedAt,
            })
            .from(decks)
            .where(
              and(
                inArray(decks.workspaceId, workspaceIds),
                openToViewer(access),
                eq(decks.isTemplate, false),
              ),
            );
    const matches = rows.filter((row) => searchFold(row.title) === searchFold(key));
    if (matches.length === 0)
      throw new ToolError(`No presentation "${key}" – list_presentations finds it.`);
    if (matches.length > 1)
      throw new ToolError(
        `${matches.length} presentations are called "${key}" – name one by its id: ${matches
          .map(
            (row) =>
              `${row.id} (changed ${new Date(row.updatedAt).toISOString().slice(0, 16).replace('T', ' ')}${row.archivedAt ? ', archived' : ''})`,
          )
          .join(', ')}. get_presentation shows each; ask the person if unsure.`,
      );
    id = matches[0]!.id;
  }
  const deck = await requireDeckAccess(deps, caller.viewer, id, right);
  if (caller.workspaceId && deck.workspaceId !== caller.workspaceId)
    throw new ToolError('This app is let into another workspace only.');
  return deck;
}

// ── Reading ────────────────────────────────────────────────────────────────

async function listWorkspacesTool(deps: AppDeps, caller: McpCaller): Promise<McpToolResult> {
  const mine = await workspacesOf(deps, caller);
  if (mine.length === 0) return text('No workspace.');
  const lines = await Promise.all(
    mine.map(async (workspace) => {
      const masters = await listWorkspaceMasters(deps, caller.viewer.author.id, workspace.id).catch(
        () => [],
      );
      const templates = masters
        .filter((master) => !master.draftDeckId)
        .map((master) => `  - template ${master.id}: „${master.name}“ (${master.format})`);
      return [
        `- ${workspace.name} (id ${workspace.id}) – role ${workspace.role}${workspace.locked ? ', locked (read only)' : ''}`,
        ...templates,
      ].join('\n');
    }),
  );
  return text(lines.join('\n'));
}

const listInput = z.object({
  query: z.string().max(200).optional(),
  workspace: z.string().optional(),
  archived: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

function deckLine(deps: AppDeps, deck: Deck, workspaceName: string | undefined) {
  const facts = [
    workspaceName ? `workspace ${workspaceName}` : null,
    `${deck.slideCount} slides`,
    deck.openCommentCount > 0 ? `${deck.openCommentCount} open comments` : null,
    `by ${deck.owner.name}`,
    `changed ${deck.updatedAt.slice(0, 10)}`,
    deck.archivedAt ? 'archived' : null,
    deck.import.status === 'failed'
      ? 'could not be read'
      : deck.import.status !== 'ready'
        ? 'still being read'
        : null,
  ].filter(Boolean);
  return `- ${deck.id}: „${deck.title}“ (${facts.join(', ')}) ${deckLink(deps, deck.id)}`;
}

async function listPresentations(
  deps: AppDeps,
  caller: McpCaller,
  input: z.infer<typeof listInput>,
): Promise<McpToolResult> {
  const workspaces = input.workspace
    ? [await findWorkspace(deps, caller, input.workspace)]
    : await workspacesOf(deps, caller);
  const names = new Map(workspaces.map((each) => [each.id, each.name]));
  const ids = workspaces.map((each) => each.id);
  const access = await accessOf(deps, caller);
  let all = await listWorkspaceDecks(deps, ids, access);
  if (!input.archived) all = all.filter((deck) => !deck.archivedAt);
  const limit = input.limit ?? 30;
  const query = input.query?.trim();
  if (!query) {
    if (all.length === 0) return text('No presentations.');
    const shown = all.slice(0, limit);
    return text(
      `${all.length} presentation(s)${all.length > shown.length ? `, the ${shown.length} changed last` : ''}:\n${shown.map((deck) => deckLine(deps, deck, names.get(deck.workspaceId))).join('\n')}`,
    );
  }
  withinLimit(aiLimits(deps).searches.hit(caller.viewer.author.id), 'searches');
  const needle = searchFold(query);
  const found = await searchDecks(deps, ids, access, query);
  const hitsOf = new Map(found.map((result) => [result.deckId, result]));
  const matching = all.filter(
    (deck) => searchFold(deck.title).includes(needle) || hitsOf.has(deck.id),
  );
  if (matching.length === 0) return text(`No presentation with "${query}".`);
  const lines = matching.slice(0, limit).map((deck) => {
    const hits = hitsOf.get(deck.id);
    const places = (hits?.hits ?? []).map(
      (hit) =>
        `\n    ${hit.kind === 'slide' ? `slide ${hit.slideNumber ?? '?'}` : `comment by ${hit.author ?? '?'}${hit.slideNumber ? ` on slide ${hit.slideNumber}` : ''}`}: …${hit.snippet}…`,
    );
    const more =
      hits && hits.hitCount > places.length ? `\n    (${hits.hitCount} places in all)` : '';
    return deckLine(deps, deck, names.get(deck.workspaceId)) + places.join('') + more;
  });
  return text(`${matching.length} presentation(s) with "${query}":\n${lines.join('\n')}`);
}

// ── search / fetch (the pair ChatGPT's research and company knowledge use) ──

const searchInput = z.object({ query: z.string().trim().min(1).max(200) });
const fetchInput = z.object({ id: z.string().trim().min(1).max(200) });
const SEARCH_RESULTS = 20;
const FETCH_CHARS = 100_000;

interface Found {
  score: number;
  id: string;
  title: string;
  url: string;
  snippet: string;
}

/** How well `text` matches the words: words found first, then how often; with a snippet. */
function matchOf(text: string, words: string[]): { score: number; snippet: string } | null {
  const folded = searchFold(text);
  let found = 0;
  let count = 0;
  let first = -1;
  for (const word of words) {
    let at = folded.indexOf(word);
    if (at === -1) continue;
    found += 1;
    if (first === -1 || at < first) first = at;
    while (at !== -1) {
      count += 1;
      at = folded.indexOf(word, at + word.length);
    }
  }
  if (found === 0) return null;
  const start = Math.max(0, first - 100);
  const snippet = text
    .slice(start, start + 300)
    .replace(/\s+/g, ' ')
    .trim();
  return {
    score: found * 1000 + Math.min(count, 999),
    snippet: `${start > 0 ? '…' : ''}${snippet}…`,
  };
}

/**
 * Everything at once. The text of slides, comments and files is encrypted at rest, so it is
 * read and compared in the server, not in SQL – counted in the page's search window.
 */
async function searchEverything(
  deps: AppDeps,
  caller: McpCaller,
  query: string,
): Promise<McpToolResult> {
  withinLimit(aiLimits(deps).searches.hit(caller.viewer.author.id), 'searches');
  const words = [...new Set(searchFold(query).split(/\s+/).filter(Boolean))];
  const workspaces = await workspacesOf(deps, caller);
  const ids = workspaces.map((each) => each.id);
  const access = await accessOf(deps, caller);
  const all = (await listWorkspaceDecks(deps, ids, access)).filter((deck) => !deck.archivedAt);
  const titleOf = new Map(all.map((deck) => [deck.id, deck.title]));
  const workspaceOf = new Map(workspaces.map((each) => [each.id, each.name]));
  const results: Found[] = [];

  // Slides and comments: the words together, and each word apart (places with most of them first).
  const asked =
    words.length > 1
      ? [query, ...words.filter((word) => word.length >= DECK_SEARCH_MIN_LENGTH).slice(0, 8)]
      : [query];
  const searched = await Promise.all(asked.map((each) => searchDecks(deps, ids, access, each)));
  const phrase = new Map(
    words.length > 1 ? searched[0]!.map((result) => [result.deckId, result]) : [],
  );
  const perWord = new Map<string, { words: number; places: number; hit?: DeckSearchHit }>();
  for (const results of words.length > 1 ? searched.slice(1) : searched)
    for (const result of results) {
      const before = perWord.get(result.deckId) ?? { words: 0, places: 0 };
      perWord.set(result.deckId, {
        words: before.words + 1,
        places: before.places + result.hitCount,
        hit: before.hit ?? result.hits[0],
      });
    }
  for (const deck of all) {
    const inTitle = matchOf(deck.title, words);
    const together = phrase.get(deck.id);
    const apart = perWord.get(deck.id);
    if (!inTitle && !together && !apart) continue;
    const hit = together?.hits[0] ?? apart?.hit;
    const inText = together
      ? (words.length + 1) * 1000 + Math.min(together.hitCount, 999)
      : apart
        ? apart.words * 1000 + Math.min(apart.places, 999)
        : 0;
    results.push({
      // A title naming the words weighs most; then text on slides and in comments.
      score: Math.max(inTitle ? inTitle.score + 1500 : 0, inText),
      id: `presentation:${deck.id}`,
      title: deck.title,
      url: deckLink(deps, deck.id),
      // Which one it is (titles repeat), then where the words are.
      snippet: `Presentation in ${workspaceOf.get(deck.workspaceId) ?? '?'}, ${deck.slideCount} slides, changed ${deck.updatedAt.slice(0, 10)}${
        hit
          ? ` – ${hit.kind === 'slide' ? `slide ${hit.slideNumber ?? '?'}` : `comment by ${hit.author ?? '?'}`}: …${hit.snippet}…`
          : ''
      }`,
    });
  }

  const deckIds = all.map((deck) => deck.id);
  if (deckIds.length > 0) {
    const [files, chunks, items] = await Promise.all([
      deps.db
        .select({ id: deckMaterials.id, name: deckMaterials.name, deckId: deckMaterials.deckId })
        .from(deckMaterials)
        .where(inArray(deckMaterials.deckId, deckIds)),
      deps.db
        .select({
          materialId: materialChunks.materialId,
          page: materialChunks.page,
          sheet: materialChunks.sheet,
          text: materialChunks.text,
        })
        .from(materialChunks)
        .where(inArray(materialChunks.deckId, deckIds)),
      deps.db
        .select({
          id: deckBoardItems.id,
          deckId: deckBoardItems.deckId,
          kind: deckBoardItems.kind,
          text: deckBoardItems.text,
          url: deckBoardItems.url,
        })
        .from(deckBoardItems)
        .where(inArray(deckBoardItems.deckId, deckIds)),
    ]);
    const best = new Map<string, { score: number; snippet: string; where: string }>();
    for (const chunk of chunks) {
      const match = matchOf(chunk.text, words);
      if (!match) continue;
      const before = best.get(chunk.materialId);
      if (before && before.score >= match.score) continue;
      best.set(chunk.materialId, {
        ...match,
        where: chunk.page ? `page ${chunk.page}` : chunk.sheet ? `sheet „${chunk.sheet}“` : '',
      });
    }
    for (const file of files) {
      const inName = matchOf(file.name, words);
      const inText = best.get(file.id);
      if (!inName && !inText) continue;
      const on = `on the board of „${titleOf.get(file.deckId) ?? '?'}“`;
      results.push({
        score: Math.max(inName ? inName.score + 500 : 0, inText?.score ?? 0),
        id: `file:${file.id}`,
        title: file.name,
        url: deckLink(deps, file.deckId, '?material'),
        snippet: inText
          ? `File ${on}${inText.where ? `, ${inText.where}` : ''}: ${inText.snippet}`
          : `File ${on}`,
      });
    }
    for (const item of items) {
      if (item.kind === 'folder') continue;
      const match = matchOf(`${item.text} ${item.url ?? ''}`, words);
      if (!match) continue;
      const label = item.kind === 'link' ? 'Link' : 'Note';
      results.push({
        score: match.score,
        id: `note:${item.id}`,
        title: `${label}: ${(item.text.split('\n')[0] ?? '').replace(/^#+\s*/, '').slice(0, 80) || item.url || label}`,
        url: item.kind === 'link' && item.url ? item.url : deckLink(deps, item.deckId, '?material'),
        snippet: `${label} on the board of „${titleOf.get(item.deckId) ?? '?'}“: ${match.snippet}`,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return text(
    JSON.stringify({
      results: results.slice(0, SEARCH_RESULTS).map(({ score: _score, ...result }) => result),
    }),
  );
}

async function fetchResult(deps: AppDeps, caller: McpCaller, id: string): Promise<McpToolResult> {
  const [kind, key] = /^(presentation|file|note):(.+)$/.exec(id)?.slice(1) ?? ['presentation', id];
  const answer = (value: {
    id: string;
    title: string;
    text: string;
    url: string;
    metadata: Record<string, string>;
  }) => text(JSON.stringify(value));

  if (kind === 'file') {
    const [file] = await deps.db.select().from(deckMaterials).where(eq(deckMaterials.id, key!));
    if (!file) throw new ToolError(`No file "${key}".`);
    const deck = await findDeck(deps, caller, file.deckId);
    const chunks = await deps.db
      .select({ page: materialChunks.page, sheet: materialChunks.sheet, text: materialChunks.text })
      .from(materialChunks)
      .where(eq(materialChunks.materialId, file.id))
      .orderBy(asc(materialChunks.seq));
    let body = '';
    let page: number | null = null;
    let sheet: string | null = null;
    for (const chunk of chunks) {
      if (chunk.page && chunk.page !== page) body += `\n\n[page ${chunk.page}]\n`;
      else if (chunk.sheet && chunk.sheet !== sheet) body += `\n\n[sheet „${chunk.sheet}“]\n`;
      else if (body) body += '\n';
      page = chunk.page;
      sheet = chunk.sheet;
      body += chunk.text;
      if (body.length > FETCH_CHARS) break;
    }
    body = body.trim();
    if (body.length > FETCH_CHARS)
      body = `${body.slice(0, FETCH_CHARS)}\n[… more – read_material reads on from a page.]`;
    return answer({
      id,
      title: file.name,
      text:
        body ||
        (file.readState === 'pending'
          ? 'Slider is still reading this file – try again shortly.'
          : 'This file has no text Slider could read (view_material shows it).'),
      url: deckLink(deps, deck.id, '?material'),
      metadata: {
        presentation: deck.title,
        presentation_id: deck.id,
        file_id: file.id,
        kind: file.kind,
        ...(file.pages ? { pages: String(file.pages) } : {}),
      },
    });
  }

  if (kind === 'note') {
    const [item] = await deps.db.select().from(deckBoardItems).where(eq(deckBoardItems.id, key!));
    if (!item) throw new ToolError(`No note "${key}".`);
    const deck = await findDeck(deps, caller, item.deckId);
    return answer({
      id,
      title: (item.text.split('\n')[0] ?? '').replace(/^#+\s*/, '').slice(0, 80) || item.kind,
      text: [item.text, item.url].filter(Boolean).join('\n\n'),
      url: deckLink(deps, deck.id, '?material'),
      metadata: {
        presentation: deck.title,
        presentation_id: deck.id,
        kind: item.kind,
        item_id: item.id,
      },
    });
  }

  const deck = await findDeck(deps, caller, key);
  const outline = await getPresentation(deps, caller, deck.id);
  return answer({
    id: `presentation:${deck.id}`,
    title: deck.title,
    text: outline.content[0]?.type === 'text' ? outline.content[0].text : '',
    url: deckLink(deps, deck.id),
    metadata: { presentation_id: deck.id },
  });
}

/** The slides people see, numbered as Slider numbers them (variants made in the editor apart). */
async function slidesOf(deps: AppDeps, deck: DeckRow): Promise<Slide[]> {
  return (await listSlides(deps.db, deck)).filter((slide) => !slide.variantOf);
}

const slideText = (slide: Slide) =>
  slide.shapes
    .map((shape) => shape.text?.replace(/\s+\n/g, '\n').trim())
    .filter((each): each is string => !!each)
    .join('\n');

/** Characters of slide text get_presentation gives in all, and per slide. */
const OUTLINE_CHARS = 60_000;
const SLIDE_CHARS = 2_500;

async function getPresentation(
  deps: AppDeps,
  caller: McpCaller,
  wanted: unknown,
): Promise<McpToolResult> {
  const row = await findDeck(deps, caller, wanted);
  const access = await accessOf(deps, caller);
  const [deck, slides, materials, items, creation, workspaces] = await Promise.all([
    toDeckDto(deps.db, row, { access }),
    slidesOf(deps, row),
    materialsOf(deps, row.id),
    deps.db.select().from(deckBoardItems).where(eq(deckBoardItems.deckId, row.id)),
    getCreation(deps, caller.viewer, row.id),
    workspacesOf(deps, caller),
  ]);
  const may = deck.permissions.canManage
    ? 'manage it (and comment, add material)'
    : deck.permissions.canComment
      ? 'comment and add material'
      : 'only look';
  const out = [
    `„${deck.title}“ (id ${deck.id})`,
    `Workspace: ${workspaces.find((each) => each.id === deck.workspaceId)?.name ?? deck.workspaceId} · by ${deck.owner.name} · changed ${deck.updatedAt.slice(0, 16).replace('T', ' ')} · version ${deck.revisionNumber}`,
    `Open in Slider: ${deckLink(deps, deck.id)} · its board: ${deckLink(deps, deck.id, '?material')}`,
    `The person may ${may}.`,
  ];
  if (deck.import.status === 'queued' || deck.import.status === 'running')
    out.push('Its file is still being read – slides follow shortly.');
  if (deck.import.status === 'failed') out.push(`Its file could not be read: ${deck.import.error}`);
  if (creation && creation.status === 'running')
    out.push(
      `Slider's AI is building it: ${creation.built}${creation.pages ? ` of ${creation.pages}` : ''} slides built${creation.step ? ` – ${creation.step}` : ''}.`,
    );
  else if (creation?.status === 'failed')
    out.push(`Slider's AI stopped: ${creation.error ?? 'failed'}.`);
  else if (creation?.prompt)
    out.push("It is still empty – build_presentation lets Slider's AI build it from its board.");

  if (deck.permissions.canManage && !creation?.prompt) {
    const reason = blocker(deps, row, await currentRevision(deps.db, row));
    out.push(
      reason
        ? `Slider's AI cannot change its slides now (edit_slides): ${reason}`
        : "Slider's AI can change its slides (edit_slides).",
    );
  }

  out.push('', `Slides (${slides.length}):`);
  let budget = OUTLINE_CHARS;
  for (const [index, slide] of slides.entries()) {
    // The title is the head already – not again as the first line of the text.
    const lines = slideText(slide).split('\n');
    if (slide.title && lines[0]?.trim() === slide.title.trim()) lines.shift();
    const body = lines.join('\n').trim();
    const marks = [
      slide.hidden ? 'hidden' : null,
      slide.openCommentCount > 0 ? `${slide.openCommentCount} open comment(s)` : null,
    ].filter(Boolean);
    const head = `${index + 1}. ${slide.title?.trim() || '(no title)'}${marks.length ? ` [${marks.join(', ')}]` : ''}`;
    if (budget <= 0) {
      out.push(head);
      continue;
    }
    const shown = body.length > SLIDE_CHARS ? `${body.slice(0, SLIDE_CHARS)} […]` : body;
    const block = shown ? `${head}\n   ${shown.replace(/\n/g, '\n   ')}` : head;
    budget -= block.length;
    out.push(block);
  }
  if (budget <= 0) out.push('[More text than fits – view_slide reads a slide in full.]');

  out.push('', 'Board (Material):');
  const notes = items.filter((item) => item.kind !== 'folder');
  if (materials.length === 0 && notes.length === 0) out.push('empty');
  else {
    for (const material of materials) out.push(`- ${describeMaterial(material)}`);
    if (notes.length > 0)
      out.push(`- and ${notes.length} note(s), sticker(s) or link(s) – list_materials lists them`);
  }
  return text(out.join('\n'));
}

const slideInput = z.object({ slide: z.number().int().min(1) });

async function slideAt(deps: AppDeps, deck: DeckRow, number: number) {
  const slides = await slidesOf(deps, deck);
  const slide = slides[number - 1];
  if (!slide)
    throw new ToolError(
      slides.length === 0
        ? 'The presentation has no slides yet.'
        : `There is no slide ${number} – it has ${slides.length}.`,
    );
  return slide;
}

const commentLine = (comment: Comment, indent = '') =>
  `${indent}- ${comment.id} ${comment.author.name}, ${comment.createdAt.slice(0, 16).replace('T', ' ')}${comment.status === 'done' ? ' (done)' : ''}: ${comment.body.trim() || '(a drawing)'}`;

async function viewSlide(
  deps: AppDeps,
  caller: McpCaller,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const deck = await findDeck(deps, caller, args.presentation);
  const { slide: number } = slideInput.parse(args);
  const slide = await slideAt(deps, deck, number);
  const [version] = await deps.db
    .select({ imageKey: slideVersions.imageKey })
    .from(slideVersions)
    .where(
      and(
        eq(slideVersions.revisionId, deck.currentRevisionId!),
        eq(slideVersions.slideId, slide.id),
      ),
    );
  const content: McpContent[] = [];
  const bytes = version ? await deps.storage.get(version.imageKey) : null;
  if (bytes) {
    try {
      content.push({
        type: 'image',
        data: Buffer.from(await asJpeg(bytes)).toString('base64'),
        mimeType: 'image/jpeg',
      });
    } catch {
      // A picture the canvas cannot draw – the text tells the rest.
    }
  }
  const comments = (await listComments(deps, caller.viewer, deck.id)).filter(
    (comment) => comment.slideId === slide.id,
  );
  const roots = comments.filter((comment) => !comment.parentId);
  const body = slideText(slide);
  const parts = [
    `Slide ${number}: ${slide.title?.trim() || '(no title)'}${slide.hidden ? ' (hidden)' : ''} – ${deckLink(deps, deck.id, `?slide=${encodeURIComponent(slide.id)}`)}`,
    body ? `Text:\n${body}` : 'No text.',
  ];
  if (!content.length) parts.push('(No picture of this slide.)');
  if (roots.length > 0)
    parts.push(
      `Comments:\n${roots
        .map((root) =>
          [
            commentLine(root),
            ...comments
              .filter((reply) => reply.parentId === root.id)
              .map((reply) => commentLine(reply, '  ')),
          ].join('\n'),
        )
        .join('\n')}`,
    );
  content.unshift({ type: 'text', text: parts.join('\n\n') });
  return { content };
}

const commentsInput = z.object({
  slide: z.number().int().min(1).optional(),
  done: z.boolean().optional(),
});

async function listCommentsTool(
  deps: AppDeps,
  caller: McpCaller,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const deck = await findDeck(deps, caller, args.presentation);
  const input = commentsInput.parse(args);
  const [all, slides, proposals] = await Promise.all([
    listComments(deps, caller.viewer, deck.id),
    slidesOf(deps, deck),
    listProposals(deps, caller.viewer, deck.id),
  ]);
  // What Slider's AI answered to a comment that asked it, right after that comment.
  const answers = (comment: Comment, indent: string) =>
    proposals
      .filter((proposal) => proposal.commentId === comment.id)
      .map((proposal) => `${indent}  - Slider's AI ${proposalLine(proposal)}`);
  const numberOf = new Map(slides.map((slide, index) => [slide.id, index + 1]));
  const only = input.slide ? (await slideAt(deps, deck, input.slide)).id : null;
  const roots = all.filter(
    (comment) =>
      !comment.parentId &&
      (input.done || comment.status === 'open') &&
      (!only || comment.slideId === only),
  );
  if (roots.length === 0) return text(input.done ? 'No comments.' : 'No open comments.');
  const lines = roots.map((root) => {
    const where = root.slideId
      ? numberOf.has(root.slideId)
        ? `slide ${numberOf.get(root.slideId)}`
        : 'a slide no longer in the deck'
      : 'the whole presentation';
    return [
      `On ${where}:`,
      commentLine(root, '  '),
      ...answers(root, '  '),
      ...all
        .filter((reply) => reply.parentId === root.id)
        .flatMap((reply) => [commentLine(reply, '    '), ...answers(reply, '    ')]),
    ].join('\n');
  });
  return text(`${roots.length} thread(s):\n${lines.join('\n')}`);
}

async function listMaterialsTool(
  deps: AppDeps,
  caller: McpCaller,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const deck = await findDeck(deps, caller, args.presentation);
  const [materials, items] = await Promise.all([
    materialsOf(deps, deck.id),
    deps.db.select().from(deckBoardItems).where(eq(deckBoardItems.deckId, deck.id)),
  ]);
  if (materials.length === 0 && items.length === 0)
    return text(`The board is empty. ${deckLink(deps, deck.id, '?material')}`);
  const me = caller.viewer.author.id;
  const yours = (author: { id: string }) => (author.id === me ? ', yours' : '');
  const nameOf = new Map<string, string>([
    ...materials.map((row) => [row.id, `„${row.name}“`] as const),
    ...items.map(
      (item) =>
        [
          item.id,
          item.kind === 'link' ? (item.url ?? item.text) : `„${item.text.slice(0, 40)}“`,
        ] as const,
    ),
  ]);
  const lines: string[] = [];
  for (const row of materials) {
    const summary = row.summary?.replace(/\s+/g, ' ').trim();
    lines.push(
      `- file ${describeMaterial(row)}, by ${row.author.name}${yours(row.author)}${summary ? `\n  ${summary.slice(0, 600)}` : ''}`,
    );
  }
  for (const item of items) {
    const on = item.boundIds.map((id) => nameOf.get(id) ?? id);
    const body = item.text.trim().slice(0, 1500);
    if (item.kind === 'link')
      lines.push(
        `- link ${item.id}: ${item.url}${body ? ` „${body}“` : ''} (by ${item.author.name}${yours(item.author)})`,
      );
    else if (item.kind === 'folder')
      lines.push(
        `- folder ${item.id}: „${item.text}“ with ${on.join(', ') || 'nothing'} (by ${item.author.name})`,
      );
    else if (item.kind === 'note')
      lines.push(
        `- note ${item.id} on ${on.join(', ')} (by ${item.author.name}${yours(item.author)}): ${body}`,
      );
    else
      lines.push(
        `- sticker ${item.id} (by ${item.author.name}${yours(item.author)})${on.length ? ` holding ${on.join(', ')}` : ''}: ${body}`,
      );
  }
  return text(
    `Board of „${deck.title}“ – ${deckLink(deps, deck.id, '?material')}\n${lines.join('\n')}`,
  );
}

/** The board tools Slider's AI uses, run for the presentation named. */
async function materialTool(
  deps: AppDeps,
  caller: McpCaller,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const deck = await findDeck(deps, caller, args.presentation);
  const result = await runMaterialTool(deps, deck.id, name, args);
  if (!result) throw new ToolError(`Unknown tool ${name}.`);
  const blocks =
    typeof result.content === 'string'
      ? [{ type: 'text' as const, text: result.content }]
      : (result.content ?? []);
  const content: McpContent[] = [];
  for (const block of blocks) {
    if (block.type === 'text') content.push({ type: 'text', text: block.text });
    else if (block.type === 'image' && block.source.type === 'base64')
      content.push({ type: 'image', data: block.source.data, mimeType: block.source.media_type });
  }
  return { content, isError: result.isError || undefined };
}

// ── Putting things on the board ───────────────────────────────────────────

const GAP = 32;

/**
 * Where a new thing of `size` lies: beside `near` if given (to its right, then lower), else in the
 * first free place scanning the board's area row by row – gaps first, then right of it all.
 */
async function freeFrame(
  deps: AppDeps,
  deckId: string,
  size: { w: number; h: number },
  near?: BoardFrame,
): Promise<BoardFrame> {
  const [materials, items] = await Promise.all([
    deps.db
      .select({ x: deckMaterials.x, y: deckMaterials.y, w: deckMaterials.w, h: deckMaterials.h })
      .from(deckMaterials)
      .where(eq(deckMaterials.deckId, deckId)),
    deps.db
      .select({
        x: deckBoardItems.x,
        y: deckBoardItems.y,
        w: deckBoardItems.w,
        h: deckBoardItems.h,
      })
      .from(deckBoardItems)
      .where(eq(deckBoardItems.deckId, deckId)),
  ]);
  const taken = [...materials, ...items];
  const free = (x: number, y: number) =>
    taken.every(
      (box) =>
        x + size.w + GAP <= box.x ||
        box.x + box.w + GAP <= x ||
        y + size.h + GAP <= box.y ||
        box.y + box.h + GAP <= y,
    );
  if (taken.length === 0) return { x: 0, y: 0, ...size };
  if (near) {
    for (let step = 0; step < 200; step++) {
      const x = near.x + near.w + GAP;
      const y = near.y + step * 40;
      if (free(x, y)) return { x, y, ...size };
    }
  }
  const left = Math.min(...taken.map((box) => box.x));
  const top = Math.min(...taken.map((box) => box.y));
  const right = Math.max(...taken.map((box) => box.x + box.w));
  const width = Math.max(right - left, 1600);
  for (let y = top; y < top + 40 * 400; y += 40)
    for (let x = left; x <= left + width - size.w; x += 40)
      if (free(x, y)) return { x, y, ...size };
  return { x: right + GAP, y: top, ...size };
}

/** A sticker's size for its Markdown – about as the board sets it (360 wide, 15px lines). */
function stickerSize(markdown: string): { w: number; h: number } {
  const w = 360;
  let lines = 0;
  for (const line of markdown.split('\n')) {
    // Measured on the board: 20px lines, about 40 characters a line (36 in a list, 26 in a heading).
    const heading = /^#{1,6}\s/.test(line);
    const listed = /^\s*([-*+]|\d+[.)])\s/.test(line);
    const chars = line.replace(/[*_`#>[\]()]/g, '').length;
    const perLine = heading ? 26 : listed ? 36 : 40;
    lines += Math.max(1, Math.ceil(chars / perLine)) * (heading ? 1.5 : 1);
  }
  return { w, h: Math.min(2400, Math.max(120, Math.round(32 + lines * 20))) };
}

const noteInput = z.object({
  text: z.string().trim().min(1).max(MAX_BOARD_NOTE_LENGTH),
  attach_to: z.string().min(1).max(100).optional(),
});

async function thingOnBoard(
  deps: AppDeps,
  deckId: string,
  id: string,
): Promise<BoardFrame & { kind: string }> {
  const [material] = await deps.db
    .select({ x: deckMaterials.x, y: deckMaterials.y, w: deckMaterials.w, h: deckMaterials.h })
    .from(deckMaterials)
    .where(and(eq(deckMaterials.id, id), eq(deckMaterials.deckId, deckId)));
  if (material) return { ...material, kind: 'file' };
  const [item] = await deps.db
    .select({
      x: deckBoardItems.x,
      y: deckBoardItems.y,
      w: deckBoardItems.w,
      h: deckBoardItems.h,
      kind: deckBoardItems.kind,
    })
    .from(deckBoardItems)
    .where(and(eq(deckBoardItems.id, id), eq(deckBoardItems.deckId, deckId)));
  if (item) return item;
  throw new ToolError(`Nothing with id "${id}" on the board – list_materials names what is there.`);
}

async function addNote(
  deps: AppDeps,
  caller: McpCaller,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const deck = await findDeck(deps, caller, args.presentation, 'comment');
  const input = noteInput.parse(args);
  const near = input.attach_to ? await thingOnBoard(deps, deck.id, input.attach_to) : undefined;
  const size = near
    ? { w: BOARD_NOTE.w + 80, h: stickerSize(input.text).h }
    : stickerSize(input.text);
  const frame = await freeFrame(deps, deck.id, size, near);
  const { item } = await createBoardItem(deps, caller.viewer, deck.id, {
    id: crypto.randomUUID(),
    kind: near ? 'note' : 'box',
    text: input.text,
    url: null,
    boundIds: near ? [input.attach_to!] : [],
    rich: markdownToRich(input.text, { spaced: true }),
    ...frame,
  });
  return text(
    `Put on the board as ${near ? 'note' : 'sticker'} ${item.id}: ${deckLink(deps, deck.id, '?material')}`,
  );
}

const linkInput = z.object({ url: boardUrlSchema, title: z.string().trim().max(300).optional() });

async function addLink(
  deps: AppDeps,
  caller: McpCaller,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const deck = await findDeck(deps, caller, args.presentation, 'comment');
  const input = linkInput.parse(args);
  const frame = await freeFrame(deps, deck.id, { w: 240, h: 96 });
  const { item } = await createBoardItem(deps, caller.viewer, deck.id, {
    id: crypto.randomUUID(),
    kind: 'link',
    text: input.title ?? '',
    url: input.url,
    boundIds: [],
    ...frame,
  });
  return text(`Link ${item.id} is on the board: ${deckLink(deps, deck.id, '?material')}`);
}

/**
 * A file the app sends – never one Slider fetches for it: an address read off the board's files
 * would let what a file says send the server anywhere (the page has no „file from a link“).
 */
const fileInput = z
  .object({
    name: z.string().trim().min(1, 'Give the file a name with its extension.').max(200),
    text: z.string().min(1).optional(),
    base64: z.string().min(1).optional(),
  })
  .refine((input) => [input.text, input.base64].filter(Boolean).length === 1, {
    message: 'Give exactly one of text or base64.',
  });

async function addFile(
  deps: AppDeps,
  caller: McpCaller,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const deck = await findDeck(deps, caller, args.presentation, 'comment');
  const input = fileInput.parse(args);
  let bytes: Uint8Array<ArrayBuffer>;
  let name = input.name;
  if (input.text !== undefined) {
    bytes = new TextEncoder().encode(input.text) as Uint8Array<ArrayBuffer>;
    if (!/\.[a-z0-9]{1,5}$/i.test(name)) name = `${name}.md`;
  } else {
    const clean = (input.base64 ?? '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    bytes = new Uint8Array(Buffer.from(clean, 'base64'));
    if (bytes.byteLength === 0) throw new ToolError('base64 holds no bytes.');
  }
  const frame = await freeFrame(deps, deck.id, MATERIAL_CARD);
  const { material } = await addMaterial(
    deps,
    caller.viewer,
    deck.id,
    { id: crypto.randomUUID(), ...frame },
    { name, bytes },
  );
  return text(
    `File ${material.id} „${material.name}“ (${material.kind}) is on the board${material.readState === 'pending' ? ' – Slider reads its text now' : ''}: ${deckLink(deps, deck.id, '?material')}`,
  );
}

const updateInput = z.object({
  item: z.string().min(1).max(100),
  text: z.string().max(MAX_BOARD_NOTE_LENGTH),
});

async function updateNote(
  deps: AppDeps,
  caller: McpCaller,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const deck = await findDeck(deps, caller, args.presentation, 'comment');
  const input = updateInput.parse(args);
  const [item] = await deps.db
    .select({
      kind: deckBoardItems.kind,
      x: deckBoardItems.x,
      y: deckBoardItems.y,
      w: deckBoardItems.w,
      h: deckBoardItems.h,
      boundIds: deckBoardItems.boundIds,
    })
    .from(deckBoardItems)
    .where(and(eq(deckBoardItems.id, input.item), eq(deckBoardItems.deckId, deck.id)));
  if (!item)
    throw new ToolError(`No note "${input.item}" on the board – list_materials names them.`);
  const rich = item.kind === 'box' || item.kind === 'note';
  await updateBoardItem(deps, caller.viewer, deck.id, input.item, {
    text: input.text,
    ...(rich && { rich: markdownToRich(input.text, { spaced: true }) }),
  });
  // A sticker on its own grows or shrinks with its text, as on the board.
  if (item.kind === 'box' && item.boundIds.length === 0) {
    const { h } = stickerSize(input.text);
    if (Math.abs(h - item.h) > 8)
      await moveBoard(deps, caller.viewer, deck.id, {
        frames: [{ id: input.item, x: item.x, y: item.y, w: item.w, h }],
      });
  }
  return text(`Changed ${input.item}.`);
}

async function deleteItem(
  deps: AppDeps,
  caller: McpCaller,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const deck = await findDeck(deps, caller, args.presentation, 'view');
  const { item } = z.object({ item: z.string().min(1).max(100) }).parse(args);
  await thingOnBoard(deps, deck.id, item);
  await deleteBoardItem(deps, caller.viewer, deck.id, item);
  return text(`Deleted ${item} from the board.`);
}

// ── Comments ───────────────────────────────────────────────────────────────

const commentInput = z.object({
  text: z.string().trim().min(1).max(10_000),
  slide: z.number().int().min(1).optional(),
  reply_to: z.string().min(1).max(100).optional(),
});

async function addComment(
  deps: AppDeps,
  caller: McpCaller,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const deck = await findDeck(deps, caller, args.presentation, 'comment');
  const input = commentInput.parse(args);
  let slideId: string | null = null;
  if (input.reply_to) {
    const parent = (await listComments(deps, caller.viewer, deck.id)).find(
      (comment) => comment.id === input.reply_to,
    );
    if (!parent) throw new ToolError(`No comment "${input.reply_to}" – list_comments names them.`);
    if (parent.parentId) throw new ToolError("Answer the thread's first comment (its root).");
    slideId = parent.slideId;
  } else if (input.slide) slideId = (await slideAt(deps, deck, input.slide)).id;
  const comment = await createComment(
    deps,
    caller.viewer,
    deck.id,
    createCommentInputSchema.parse({
      slideId,
      parentId: input.reply_to ?? null,
      body: input.text,
      anchor: { type: 'slide' },
    }),
  );
  return text(
    `Comment ${comment.id} written: ${deckLink(deps, deck.id, slideId ? `?slide=${encodeURIComponent(slideId)}` : '')}`,
  );
}

/** How long a tool waits for a deck's file to be read (a new one takes a few seconds). */
const IMPORT_WAIT_MS = 90_000;

/** The deck once its file is read – a deck just made is still being prepared for a moment. */
async function whenRead(deps: AppDeps, deck: DeckRow, waitMs = IMPORT_WAIT_MS): Promise<DeckRow> {
  const until = Date.now() + waitMs;
  let now = deck;
  while (now.importState.status === 'queued' || now.importState.status === 'running') {
    if (Date.now() > until)
      throw new ToolError('The presentation is still being prepared – try again in a minute.');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const [row] = await deps.db.select().from(decks).where(eq(decks.id, deck.id));
    if (!row) throw new ToolError('The presentation is gone.');
    now = row;
  }
  return now;
}

const editInput = z.object({
  slide: z.number().int().min(1),
  instruction: z.string().trim().min(1).max(4000),
});
/** How long edit_slides waits for Slider's AI before it answers „still working“. */
const EDIT_WAIT_MS = 120_000;

/** What Slider's AI did for a request, told for the AI app. */
function proposalLine(proposal: Pick<AiProposal, 'status' | 'summary' | 'error' | 'asks'>) {
  const said = proposal.summary?.trim();
  switch (proposal.status) {
    case 'running':
      return 'still working';
    case 'applied':
      return `changed the slides${said ? `: ${said}` : ''}`;
    case 'ready':
      return proposal.asks
        ? `asks back: ${said ?? ''}`
        : `changed nothing${said ? `: ${said}` : ''}`;
    case 'failed':
      return `failed: ${proposal.error ?? said ?? 'unknown'}`;
    case 'reverted':
      return `its change was undone${said ? ` (it had: ${said})` : ''}`;
    default:
      return proposal.status;
  }
}

async function editSlides(
  deps: AppDeps,
  caller: McpCaller,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const input = editInput.parse(args);
  withinLimit(aiLimits(deps).aiRequests.hit(caller.viewer.author.id), 'AI requests');
  const deck = await whenRead(deps, await findDeck(deps, caller, args.presentation, 'own'));
  const slide = await slideAt(deps, deck, input.slide);
  // Refused before anything is written: no comment left behind for a change that cannot be.
  await editTarget(deps, caller.viewer, deck.id);
  const comment = await createComment(
    deps,
    caller.viewer,
    deck.id,
    createCommentInputSchema.parse({
      slideId: slide.id,
      parentId: null,
      body: input.instruction,
      anchor: { type: 'slide' },
    }),
  );
  const started = await createProposal(deps, caller.viewer, deck.id, { commentId: comment.id });
  const link = deckLink(deps, deck.id, `?slide=${encodeURIComponent(slide.id)}`);
  const until = Date.now() + EDIT_WAIT_MS;
  let now = started;
  while (now.status === 'running' && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const [row] = await deps.db
      .select({
        status: aiProposals.status,
        summary: aiProposals.summary,
        error: aiProposals.error,
        asks: aiProposals.asks,
      })
      .from(aiProposals)
      .where(eq(aiProposals.id, started.id));
    if (!row) break;
    now = { ...now, ...row };
  }
  const next =
    now.status === 'running'
      ? ' It goes on in the background – list_comments shows the outcome in its thread, view_slide the slide.'
      : now.status === 'applied'
        ? ' Check it with view_slide; it can be undone in the comment thread in Slider.'
        : now.asks
          ? ' Ask the person, then call edit_slides again with the answer in the instruction.'
          : '';
  const said = `Slider's AI ${proposalLine(now)}`;
  return {
    content: [{ type: 'text', text: `${said}${/[.!?…]$/.test(said) ? '' : '.'}${next}\n${link}` }],
    isError: now.status === 'failed' || undefined,
  };
}

// ── New presentations ─────────────────────────────────────────────────────

const createInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  workspace: z.string().optional(),
  template: z.string().min(1).max(100).optional(),
});

async function createPresentation(
  deps: AppDeps,
  caller: McpCaller,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const input = createInput.parse(args);
  const userId = caller.viewer.author.id;
  const workspace = await findWorkspace(deps, caller, input.workspace);
  const workspaceId = await resolveUploadWorkspace(deps, userId, workspace.id);
  const bytes = input.template
    ? await deckFileFromMaster(deps, userId, workspaceId, input.template)
    : await blankOdp(deps.clock.now());
  const deck = await createDeckFromFile(
    deps,
    { ownerId: userId, workspaceId },
    {
      fileName: 'Neue Präsentation.odp',
      bytes,
      source: 'upload',
      masterId: input.template ?? null,
    },
  );
  await offerCreation(deps.db, deck.id);
  if (input.title)
    await deps.db.update(decks).set({ title: input.title }).where(eq(decks.id, deck.id));
  // Ready for the next call (edit_slides, view_slide) – a blank deck is read in seconds.
  const [row] = await deps.db.select().from(decks).where(eq(decks.id, deck.id));
  if (row) await whenRead(deps, row, 30_000).catch(() => undefined);
  return text(
    `Created „${input.title ?? deck.title}“ (id ${deck.id}) in ${workspace.name}: ${deckLink(deps, deck.id)}\nIts board: ${deckLink(deps, deck.id, '?material')}\nNext: put material on its board (add_file, add_note, add_link), then build_presentation.`,
  );
}

const buildInput = z.object({
  description: z.string().trim().min(1).max(8000),
  kind: deckKindSchema.optional(),
  pages: z.number().int().min(MIN_CREATED_SLIDES).max(MAX_CREATED_SLIDES).optional(),
});

async function buildPresentation(
  deps: AppDeps,
  caller: McpCaller,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const input = buildInput.parse(args);
  withinLimit(aiLimits(deps).deckCreations.hit(caller.viewer.author.id), 'presentations built');
  const deck = await whenRead(deps, await findDeck(deps, caller, args.presentation, 'own'));
  let templateId: string | null = null;
  if (deck.masterId) {
    const [master] = await deps.db
      .select({ format: workspaceMasters.format })
      .from(workspaceMasters)
      .where(eq(workspaceMasters.id, deck.masterId));
    if (master?.format === 'odp') templateId = deck.masterId;
  }
  const kind = input.kind ?? 'keynote';
  const pages = input.pages ?? DECK_KINDS.find((each) => each.id === kind)!.pages;
  await startCreation(deps, caller.viewer, deck.id, {
    description: input.description,
    kind,
    pages,
    templateId,
  });
  return text(
    `Slider's AI is building ${pages} slides now – this takes a few minutes. get_presentation shows how far it is; the person can watch it in Slider: ${deckLink(deps, deck.id)}`,
  );
}

// ── Dispatch ───────────────────────────────────────────────────────────────

/** Runs a tool for the caller; mistakes and refusals come back as the tool's error. */
export async function runMcpTool(
  deps: AppDeps,
  caller: McpCaller,
  name: string,
  args: Record<string, unknown> = {},
): Promise<McpToolResult> {
  if (!TOOL_NAMES.has(name))
    return { content: [{ type: 'text', text: `Unknown tool ${name}.` }], isError: true };
  try {
    switch (name) {
      case 'search':
        return await searchEverything(deps, caller, searchInput.parse(args).query);
      case 'fetch':
        return await fetchResult(deps, caller, fetchInput.parse(args).id);
      case 'list_workspaces':
        return await listWorkspacesTool(deps, caller);
      case 'list_presentations':
        return await listPresentations(deps, caller, listInput.parse(args));
      case 'get_presentation':
        return await getPresentation(deps, caller, args.presentation);
      case 'view_slide':
        return await viewSlide(deps, caller, args);
      case 'list_comments':
        return await listCommentsTool(deps, caller, args);
      case 'add_comment':
        return await addComment(deps, caller, args);
      case 'edit_slides':
        return await editSlides(deps, caller, args);
      case 'list_materials':
        return await listMaterialsTool(deps, caller, args);
      case 'add_note':
        return await addNote(deps, caller, args);
      case 'add_link':
        return await addLink(deps, caller, args);
      case 'add_file':
        return await addFile(deps, caller, args);
      case 'update_note':
        return await updateNote(deps, caller, args);
      case 'delete_item':
        return await deleteItem(deps, caller, args);
      case 'create_presentation':
        return await createPresentation(deps, caller, args);
      case 'build_presentation':
        return await buildPresentation(deps, caller, args);
      default:
        return await materialTool(deps, caller, name, args);
    }
  } catch (error) {
    const message =
      error instanceof ToolError || error instanceof ApiError
        ? error.message
        : error instanceof z.ZodError
          ? z.prettifyError(error)
          : null;
    if (message === null) throw error;
    return { content: [{ type: 'text', text: message }], isError: true };
  }
}
