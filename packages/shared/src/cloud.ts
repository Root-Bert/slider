import { z } from 'zod';
import { accentColorSchema, accountAuthorSchema, authorSchema, workspaceRoleSchema } from './model';

/**
 * Cloud – the workspace's files beside its presentations: areas („Bereiche“) with a colour and
 * people, folders and files with a history of versions („Fassungen“), sharing, a trash
 * that keeps things 30 days, and an activity log. Real files underneath: what goes up comes
 * down byte for byte.
 */

// ── Limits ──────────────────────────────────────────────────────────────────

/** Days a deleted file or folder stays in „Gelöscht“ before it goes for good. */
export const CLOUD_TRASH_DAYS = 30;
/** Deleted presentations stay in the trash as long as deleted files. */
export const DECK_TRASH_DAYS = CLOUD_TRASH_DAYS;
/** Days an older version without a name stays; named versions and the current one stay. */
export const CLOUD_VERSION_DAYS = 180;
/** Files from this size go up in parts (tus), each part well under a proxy's limit per request. */
export const CLOUD_UPLOAD_IN_PARTS_FROM = 32 * 1024 * 1024;
export const CLOUD_UPLOAD_PART_BYTES = 32 * 1024 * 1024;
/** Where uploads in parts begin (under `API_PREFIX`). */
export const CLOUD_TUS_PATH = '/cloud/tus';
/** Folders inside folders, at most. */
export const CLOUD_MAX_DEPTH = 24;
/** Items one request moves, deletes or restores, at most. */
export const CLOUD_MAX_BATCH = 500;

// ── Names ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex -- control characters are what it refuses
const FORBIDDEN_NAME = /[\\/\u0000-\u001f\u007f]/;

/**
 * A file's or folder's name as every desktop takes it: no slash or backslash, no control
 * characters, not `.` or `..`, no space or dot at its end (Windows drops them).
 */
export const cloudNameSchema = z
  .string()
  .transform((name) => name.normalize('NFC').trim())
  .pipe(
    z
      .string()
      .min(1, 'Bitte gib einen Namen ein.')
      .max(200, 'Der Name ist zu lang (höchstens 200 Zeichen).')
      .refine((name) => !FORBIDDEN_NAME.test(name), 'Der Name darf kein / oder \\ enthalten.')
      .refine((name) => name !== '.' && name !== '..', 'Dieser Name geht nicht.')
      .refine((name) => !name.endsWith('.'), 'Der Name darf nicht mit einem Punkt enden.'),
  );

/** Names compare without case, as on macOS and Windows: „Angebot.pdf“ = „angebot.PDF“. */
export const cloudNameKey = (name: string) => name.normalize('NFC').toLocaleLowerCase('de-DE');

/** `Angebot.final.pdf` → `pdf`; no dot (or only a leading one) → ``. Lower case. */
export function cloudExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** The name without its extension – what a rename marks. */
export function cloudBaseName(name: string): string {
  const extension = cloudExtension(name);
  return extension ? name.slice(0, -(extension.length + 1)) : name;
}

/** A free name beside `taken`: „Bericht.pdf“ → „Bericht 2.pdf“, „Bericht 3.pdf“ … */
export function cloudFreeName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(cloudNameKey(name))) return name;
  const extension = cloudExtension(name);
  const base = cloudBaseName(name).replace(/ \d+$/, '');
  for (let count = 2; ; count++) {
    const candidate = extension ? `${base} ${count}.${extension}` : `${base} ${count}`;
    if (!taken.has(cloudNameKey(candidate))) return candidate;
  }
}

// ── Kinds of files ──────────────────────────────────────────────────────────

/** What a file is, for its icon, the filter chips and the preview. */
export const CLOUD_FILE_TYPES = [
  'document',
  'presentation',
  'spreadsheet',
  'pdf',
  'image',
  'video',
  'audio',
  'archive',
  'text',
  'other',
] as const;
export const cloudFileTypeSchema = z.enum(CLOUD_FILE_TYPES);
export type CloudFileType = z.infer<typeof cloudFileTypeSchema>;

const TYPE_BY_EXTENSION: Record<string, CloudFileType> = {};
const extensions = (type: CloudFileType, list: string) => {
  for (const extension of list.split(' ')) TYPE_BY_EXTENSION[extension] = type;
};
extensions('document', 'doc docx docm dot dotx odt ott rtf pages');
extensions('presentation', 'ppt pptx pptm pps ppsx pot potx odp otp key');
extensions('spreadsheet', 'xls xlsx xlsm xlsb xlt xltx ods ots csv tsv numbers');
extensions('pdf', 'pdf');
extensions('image', 'png jpg jpeg gif webp avif svg heic heif tif tiff bmp ico psd ai');
extensions('video', 'mp4 m4v mov webm mkv avi wmv mpg mpeg');
extensions('audio', 'mp3 m4a wav ogg oga opus flac aac aiff wma');
extensions('archive', 'zip rar 7z tar gz tgz bz2 xz dmg iso');
extensions(
  'text',
  'txt md markdown json xml yaml yml toml ini log html htm css js mjs ts tsx jsx py rb go rs java c h cpp sh sql tex',
);

export function cloudFileType(name: string, mimeType?: string | null): CloudFileType {
  const byName = TYPE_BY_EXTENSION[cloudExtension(name)];
  if (byName) return byName;
  if (!mimeType) return 'other';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('text/')) return 'text';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'other';
}

/** What the browser shows by itself; everything else is drawn as a PDF by the server or loaded. */
export const CLOUD_INLINE_IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp']);
export const CLOUD_INLINE_VIDEO = new Set(['mp4', 'm4v', 'webm', 'mov']);
export const CLOUD_INLINE_AUDIO = new Set(['mp3', 'm4a', 'wav', 'ogg', 'oga', 'opus', 'flac']);
/** Office files the server turns into a PDF to show them (with LibreOffice). */
export const CLOUD_OFFICE_PREVIEW = new Set([
  'doc',
  'docx',
  'docm',
  'odt',
  'rtf',
  'ppt',
  'pptx',
  'pptm',
  'ppsx',
  'odp',
  'xls',
  'xlsx',
  'xlsm',
  'ods',
]);

/** How a file is shown in the preview. */
export type CloudPreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'office' | 'text' | 'none';
/** Text files are shown up to this size; larger ones are loaded. */
export const CLOUD_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

export function cloudPreviewKind(name: string, sizeBytes: number): CloudPreviewKind {
  const extension = cloudExtension(name);
  if (CLOUD_INLINE_IMAGES.has(extension) || extension === 'svg') return 'image';
  if (CLOUD_INLINE_VIDEO.has(extension)) return 'video';
  if (CLOUD_INLINE_AUDIO.has(extension)) return 'audio';
  if (extension === 'pdf') return 'pdf';
  if (CLOUD_OFFICE_PREVIEW.has(extension)) return 'office';
  if (cloudFileType(name) === 'text' || extension === 'csv' || extension === 'tsv') {
    return sizeBytes <= CLOUD_TEXT_PREVIEW_BYTES ? 'text' : 'none';
  }
  return 'none';
}

// ── Rights ──────────────────────────────────────────────────────────────────

/**
 * What the caller may do with an area, a folder or a file. `view`: open and load. `edit`: also
 * upload, rename, move, delete, share. `manage`: also the area's people and what lies in
 * „Gelöscht“ of others.
 */
export const CLOUD_ACCESS = ['view', 'edit', 'manage'] as const;
export const cloudAccessSchema = z.enum(CLOUD_ACCESS);
export type CloudAccess = z.infer<typeof cloudAccessSchema>;
const ACCESS_RANK: Record<CloudAccess, number> = { view: 0, edit: 1, manage: 2 };
export const cloudAccessAtLeast = (access: CloudAccess | null, min: CloudAccess) =>
  access !== null && ACCESS_RANK[access] >= ACCESS_RANK[min];
export const strongerCloudAccess = (
  a: CloudAccess | null,
  b: CloudAccess | null,
): CloudAccess | null => {
  if (!a) return b;
  if (!b) return a;
  return ACCESS_RANK[a] >= ACCESS_RANK[b] ? a : b;
};

/** What a share gives: „Kann ansehen“ or „Kann bearbeiten“. */
export const CLOUD_SHARE_ROLES = ['view', 'edit'] as const;
export const cloudShareRoleSchema = z.enum(CLOUD_SHARE_ROLES);
export type CloudShareRole = z.infer<typeof cloudShareRoleSchema>;

// ── Areas ───────────────────────────────────────────────────────────────────

/** `workspace`: everyone in the workspace; `members`: only the people of the area (and admins). */
export const CLOUD_AREA_VISIBILITIES = ['workspace', 'members'] as const;
export const cloudAreaVisibilitySchema = z.enum(CLOUD_AREA_VISIBILITIES);
export type CloudAreaVisibility = z.infer<typeof cloudAreaVisibilitySchema>;

export const cloudAreaMemberSchema = accountAuthorSchema.extend({
  /** What they do there, e.g. „Leitung Vertrieb“; free text. */
  title: z.string().nullable(),
  /** Their role in the workspace. */
  role: workspaceRoleSchema,
});
export type CloudAreaMember = z.infer<typeof cloudAreaMemberSchema>;

/**
 * An area's colour: one of the accents (they follow the theme), or any colour of one's own as
 * `#rrggbb`.
 */
export const cloudAreaColorSchema = z.union([
  accentColorSchema,
  z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Die Farbe muss wie #1a2b3c aussehen.')
    .transform((hex) => hex.toLowerCase() as `#${string}`),
]);
export type CloudAreaColor = z.infer<typeof cloudAreaColorSchema>;

export const cloudAreaSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  /** The area it is listed under; `null`: at the top (also when that one is not the caller's to see). */
  parentId: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  color: cloudAreaColorSchema,
  visibility: cloudAreaVisibilitySchema,
  /**
   * The workspace itself as an area: called as it is, its people are everyone in it; not
   * deleted or renamed. The other areas are listed under it.
   */
  root: z.boolean().default(false),
  /** The area's people; with `workspace` visibility those named for it, everyone else sees it too. */
  members: z.array(cloudAreaMemberSchema),
  /** Files in it, folders not counted, deleted ones left out. */
  fileCount: z.number().int(),
  sizeBytes: z.number().int(),
  /** The newest change in it. */
  activeAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  /** What the caller may do in it. */
  access: cloudAccessSchema,
});
export type CloudArea = z.infer<typeof cloudAreaSchema>;

export const cloudAreaNameSchema = z.string().trim().min(1, 'Bitte gib einen Namen ein.').max(60);
export const cloudAreaInputSchema = z.object({
  name: cloudAreaNameSchema,
  description: z.string().trim().max(200).default(''),
  color: cloudAreaColorSchema,
  visibility: cloudAreaVisibilitySchema.default('workspace'),
});
export type CloudAreaInput = z.input<typeof cloudAreaInputSchema>;
/** Areas under areas, this deep at most (the top counts as one). */
export const CLOUD_AREA_MAX_DEPTH = 4;
/** `POST /workspaces/:id/cloud/areas`: with `parentId` an area under that one. */
export const cloudAreaCreateSchema = cloudAreaInputSchema.extend({
  parentId: z.string().min(1).nullable().default(null),
});
export type CloudAreaCreate = z.input<typeof cloudAreaCreateSchema>;
export const cloudAreaUpdateSchema = cloudAreaInputSchema.partial();
export type CloudAreaUpdate = z.input<typeof cloudAreaUpdateSchema>;

/** `PUT /cloud/areas/:id/members`: the area's people, all of them. */
export const cloudAreaMembersInputSchema = z.object({
  members: z
    .array(
      z.object({
        userId: z.string().min(1),
        title: z.string().trim().max(80).nullable().default(null),
      }),
    )
    .max(500),
});
export type CloudAreaMembersInput = z.input<typeof cloudAreaMembersInputSchema>;

// ── Files and folders ───────────────────────────────────────────────────────

export const CLOUD_NODE_KINDS = ['file', 'folder'] as const;
export const cloudNodeKindSchema = z.enum(CLOUD_NODE_KINDS);
export type CloudNodeKind = z.infer<typeof cloudNodeKindSchema>;

/** Where a file lies, for lists across folders (Zuletzt, the search, Gelöscht). */
export const cloudLocationSchema = z.object({
  /** `null`: someone's own files („Meine Dateien“). */
  areaId: z.string().nullable(),
  areaName: z.string().nullable(),
  areaColor: cloudAreaColorSchema.nullable(),
  /** The folders down to it, outermost first, without the area. */
  folders: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type CloudLocation = z.infer<typeof cloudLocationSchema>;

export const cloudNodeSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  /** `null`: in its owner's own files. */
  areaId: z.string().nullable(),
  parentId: z.string().nullable(),
  kind: cloudNodeKindSchema,
  name: z.string(),
  /** Files: what kind; folders: `null`. */
  fileType: cloudFileTypeSchema.nullable(),
  mimeType: z.string().nullable(),
  /** A file's size; a folder's: everything in it. */
  sizeBytes: z.number().int(),
  /** Folders: files in it, at any depth. Files: `null`. */
  fileCount: z.number().int().nullable(),
  /** A folder's own colour; `null` (or absent): the plain one. */
  color: cloudAreaColorSchema.nullable().optional(),
  /** Folders in a list: the newest few files lying directly in it – what its card lets one guess. */
  peek: z
    .array(
      z.object({
        id: z.string(),
        versionId: z.string().nullable(),
        fileType: cloudFileTypeSchema,
        thumbnail: z.boolean(),
      }),
    )
    .optional(),
  /** The current version (files) – part of every content link, so a new one is a new link. */
  versionId: z.string().nullable(),
  versionCount: z.number().int(),
  /** A small picture of it exists (pictures, PDFs, office files once drawn). */
  thumbnail: z.boolean(),
  createdAt: z.iso.datetime(),
  /** The last change of its content or name. */
  updatedAt: z.iso.datetime(),
  /** Who changed it last. */
  updatedBy: authorSchema,
  /** Whose it is: who put it there. */
  owner: authorSchema,
  /** A folder the caller pinned to the side bar („Anpinnen“). */
  pinned: z.boolean(),
  /** Shared beyond where it lies: with how many people, and by link. */
  shared: z.object({ people: z.number().int(), link: z.boolean() }),
  /**
   * Agents at work on it right now (gone once they stop): each made or changed it, or the
   * presentation whose file it is, in the work it is at. Those the caller sees.
   */
  agents: z.array(z.object({ id: z.string(), title: z.string() })).optional(),
  /** In „Gelöscht“: when, by whom, and how many days it stays. */
  deleted: z
    .object({ at: z.iso.datetime(), by: authorSchema, daysLeft: z.number().int() })
    .nullable(),
  /** What the caller may do with it. */
  access: cloudAccessSchema,
  /** Only in lists across folders. */
  location: cloudLocationSchema.optional(),
});
export type CloudNode = z.infer<typeof cloudNodeSchema>;

/** Which list: a folder (or an area's or one's own top), or one across folders. */
export const CLOUD_SCOPES = ['folder', 'all', 'recent', 'shared', 'sharedByMe', 'trash'] as const;
export const cloudScopeSchema = z.enum(CLOUD_SCOPES);
export type CloudScope = z.infer<typeof cloudScopeSchema>;

/**
 * `GET /workspaces/:id/cloud/nodes`: `scope=folder` with `folder=<id>`, `area=<id>` (its top) or
 * neither (one's own files' top); the other scopes take nothing more.
 */
export const cloudListQuerySchema = z.object({
  scope: cloudScopeSchema.default('folder'),
  folder: z.string().min(1).optional(),
  area: z.string().min(1).optional(),
});
export type CloudListQuery = z.input<typeof cloudListQuerySchema>;

export const cloudListingSchema = z.object({
  scope: cloudScopeSchema,
  /** The area the folder lies in; `null` in one's own files and in lists across folders. */
  area: cloudAreaSchema.nullable(),
  /** The open folder; `null` at a top and in lists across folders. */
  folder: cloudNodeSchema.nullable(),
  /** The folders from the top down to the open one, the open one last. */
  path: z.array(z.object({ id: z.string(), name: z.string() })),
  /** Someone else's files reached through a share: whose. */
  sharedBy: authorSchema.nullable(),
  nodes: z.array(cloudNodeSchema),
  /** What the caller may do here (upload, new folder). */
  access: cloudAccessSchema,
});
export type CloudListing = z.infer<typeof cloudListingSchema>;

/** Where something new goes: a folder, an area's top, or (neither) one's own files. */
const targetShape = {
  parentId: z.string().min(1).nullable().optional(),
  areaId: z.string().min(1).nullable().optional(),
};

/** `PUT /decks/:deckId/place`: the folder (or the top of an area, or of one's own files). */
export const cloudTargetInputSchema = z.object(targetShape);
export type CloudTargetInput = z.input<typeof cloudTargetInputSchema>;

export const cloudFolderInputSchema = z.object({
  name: cloudNameSchema,
  /** A name already there is counted on („Neuer Ordner 2“) instead of refused. */
  numbered: z.boolean().optional(),
  ...targetShape,
});
export type CloudFolderInput = z.input<typeof cloudFolderInputSchema>;

export const cloudRenameInputSchema = z.object({ name: cloudNameSchema });

const idsSchema = z.array(z.string().min(1)).min(1).max(CLOUD_MAX_BATCH);

/** `POST /cloud/nodes/move` and `/copy`. */
export const cloudMoveInputSchema = z.object({ ids: idsSchema, ...targetShape });
export type CloudMoveInput = z.input<typeof cloudMoveInputSchema>;

/** `POST /cloud/nodes/trash`, `/restore`, `/purge`. */
export const cloudIdsInputSchema = z.object({ ids: idsSchema });
export type CloudIdsInput = z.input<typeof cloudIdsInputSchema>;

/** What a batch did: the items as they are now, and those left out with the reason. */
export const cloudBatchResultSchema = z.object({
  nodes: z.array(cloudNodeSchema),
  skipped: z.array(z.object({ id: z.string(), name: z.string(), reason: z.string() })),
});
export type CloudBatchResult = z.infer<typeof cloudBatchResultSchema>;

export const cloudPinInputSchema = z.object({ pinned: z.boolean() });

/** A pinned folder, as the side bar shows it. */
export const cloudPinSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: cloudNodeSchema.shape.color,
});
export type CloudPin = z.infer<typeof cloudPinSchema>;
/** A folder's colour; `null` takes it off again. */
export const cloudColorInputSchema = z.object({ color: cloudAreaColorSchema.nullable() });

/**
 * A file sent whole (`POST /workspaces/:id/cloud/files?…`, the bytes as the body) or the finish
 * of one sent in parts. With `nodeId` it becomes that file's new version; else a file of the
 * same name in the same place gets the new version (no „Bericht (1).pdf“) unless `keepBoth`.
 */
export const cloudUploadQuerySchema = z.object({
  name: cloudNameSchema,
  parentId: z.string().min(1).optional(),
  areaId: z.string().min(1).optional(),
  nodeId: z.string().min(1).optional(),
  keepBoth: z.enum(['1']).optional(),
  /** Folders to make on the way (a dropped folder), `/`-separated, under the target. */
  path: z.string().max(2000).optional(),
  /** The file's own time on the computer it came from (ms). */
  modifiedAt: z.coerce.number().int().positive().optional(),
  /**
   * From a computer keeping a copy: the version its change was made on, or `none` for a file it
   * holds to be new. Another one there by now: refused (409 `cloud_conflict`), nothing stored –
   * the computer keeps both.
   */
  ifVersion: z.string().min(1).max(64).optional(),
});
export type CloudUploadQuery = z.input<typeof cloudUploadQuerySchema>;

export const cloudUploadResultSchema = z.object({
  node: cloudNodeSchema,
  /** `true`: a new file; `false`: a new version of one that was there. */
  created: z.boolean(),
});
export type CloudUploadResult = z.infer<typeof cloudUploadResultSchema>;

// ── Keeping a copy on a computer ────────────────────────────────────────────

/** Days a computer may stay away and still be told what went; after that it starts over. */
export const CLOUD_REMOVED_DAYS = 60;

export const cloudChangesQuerySchema = z.object({
  /** Where the last answer ended; none: everything from the start. */
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});
export type CloudChangesQuery = z.input<typeof cloudChangesQuerySchema>;

/** Where files lie at the top: one's own files, or an area. */
export const cloudDriveRootSchema = z.object({
  /** `mine`, the area's id, or `shared`: what others shared from where one does not see. */
  id: z.string(),
  /** `workspace`: the workspace's own area – no folder, what lies in it lies in the workspace's. */
  kind: z.enum(['mine', 'area', 'workspace', 'shared']),
  /** The area it stands under, as a folder in that one's; `null`: in the workspace's folder. */
  parentId: z.string().nullable(),
  name: z.string(),
  canEdit: z.boolean(),
});
export type CloudDriveRoot = z.infer<typeof cloudDriveRootSchema>;

export const cloudDriveNodeSchema = z.object({
  id: z.string(),
  /** The root it lies in (`cloudDriveRootSchema.id`) … */
  rootId: z.string(),
  /** … and the folder there; `null`: at the root's top. */
  parentId: z.string().nullable(),
  kind: cloudNodeKindSchema,
  name: z.string(),
  sizeBytes: z.number().int(),
  /** A file's current version and its bytes' SHA-256: the same pair, nothing to fetch. */
  versionId: z.string().nullable(),
  sha256: z.string().nullable(),
  createdAt: z.iso.datetime(),
  modifiedAt: z.iso.datetime(),
  canEdit: z.boolean(),
});
export type CloudDriveNode = z.infer<typeof cloudDriveNodeSchema>;

/**
 * What changed for the caller since `cursor`, oldest first. Applying it twice changes nothing:
 * `nodes` are as they are now, `removed` are gone from the caller's view (deleted, or moved
 * where they do not see). `reset`: forget what you hold, this is the start of everything.
 */
export const cloudChangesSchema = z.object({
  cursor: z.string(),
  reset: z.boolean(),
  /** More is waiting: ask again with `cursor` right away. */
  more: z.boolean(),
  roots: z.array(cloudDriveRootSchema),
  nodes: z.array(cloudDriveNodeSchema),
  removed: z.array(z.string()),
});
export type CloudChanges = z.infer<typeof cloudChangesSchema>;

// ── Versions ────────────────────────────────────────────────────────────────

export const cloudVersionSchema = z.object({
  id: z.string(),
  /** 1 for the first; counts on with every new one. */
  number: z.number().int(),
  sizeBytes: z.number().int(),
  createdAt: z.iso.datetime(),
  createdBy: authorSchema,
  /** A named version („An den Vorstand“) stays for good. */
  label: z.string().nullable(),
  current: z.boolean(),
  /** Brought back from this earlier version. */
  restoredFrom: z.number().int().nullable(),
});
export type CloudVersion = z.infer<typeof cloudVersionSchema>;

export const cloudVersionLabelInputSchema = z.object({
  label: z.string().trim().max(80).nullable(),
});

// ── Sharing ─────────────────────────────────────────────────────────────────

export const cloudShareSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  kind: z.enum(['user', 'link']),
  /** `user` shares: with whom. */
  user: accountAuthorSchema.extend({ email: z.string() }).nullable(),
  role: cloudShareRoleSchema,
  /** `link` shares: the address to pass on. */
  url: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  /** `link` shares: how often it was opened. */
  opens: z.number().int(),
  createdAt: z.iso.datetime(),
  createdBy: authorSchema,
});
export type CloudShare = z.infer<typeof cloudShareSchema>;

/** `POST /cloud/nodes/:id/shares`: with a member of the workspace, or a link. */
export const cloudShareInputSchema = z.union([
  z.object({ userId: z.string().min(1), role: cloudShareRoleSchema.default('view') }),
  z.object({ link: z.literal(true), expiresAt: z.iso.datetime().nullable().default(null) }),
]);
export type CloudShareInput = z.input<typeof cloudShareInputSchema>;

export const cloudShareUpdateSchema = z.object({
  role: cloudShareRoleSchema.optional(),
  expiresAt: z.iso.datetime().nullable().optional(),
});
export type CloudShareUpdate = z.input<typeof cloudShareUpdateSchema>;

/** People of the workspace a file can be shared with. */
export const cloudPersonSchema = accountAuthorSchema.extend({
  email: z.string(),
  role: workspaceRoleSchema,
});
export type CloudPerson = z.infer<typeof cloudPersonSchema>;

// ── Activity ────────────────────────────────────────────────────────────────

export const CLOUD_EVENT_KINDS = [
  'uploaded',
  'version',
  'folder_created',
  'renamed',
  'moved',
  'copied',
  'deleted',
  'restored',
  'purged',
  'shared',
  'unshared',
  'link_created',
  'link_removed',
  'version_restored',
  'version_named',
  'area_created',
  'area_changed',
  'area_people',
] as const;
export const cloudEventKindSchema = z.enum(CLOUD_EVENT_KINDS);
export type CloudEventKind = z.infer<typeof cloudEventKindSchema>;

export const cloudEventSchema = z.object({
  id: z.string(),
  kind: cloudEventKindSchema,
  at: z.iso.datetime(),
  actor: authorSchema,
  areaId: z.string().nullable(),
  /** `null` once the file is gone for good. */
  nodeId: z.string().nullable(),
  /** As it was called then. */
  name: z.string(),
  nodeKind: cloudNodeKindSchema.nullable(),
  /** `renamed`: the old name; `moved`/`copied`: where to; `shared`: with whom; versions: which. */
  detail: z.string().nullable(),
  /** Several of a kind at once (an upload of 12 files): how many more. */
  more: z.number().int(),
});
export type CloudEvent = z.infer<typeof cloudEventSchema>;

export const cloudActivityQuerySchema = z.object({
  area: z.string().min(1).optional(),
  node: z.string().min(1).optional(),
  /** Events before this one (its `at`), for the next page. */
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});
export type CloudActivityQuery = z.input<typeof cloudActivityQuerySchema>;

// ── One file, opened ────────────────────────────────────────────────────────

/** `GET /cloud/nodes/:id`: everything the preview and its panel show. */
export const cloudNodeDetailSchema = z.object({
  node: cloudNodeSchema,
  area: cloudAreaSchema.nullable(),
  path: z.array(z.object({ id: z.string(), name: z.string() })),
  versions: z.array(cloudVersionSchema),
  shares: z.array(cloudShareSchema),
  /** Who reaches it through where it lies: the area's people, or only its owner. */
  audience: z.object({
    kind: z.enum(['area', 'workspace', 'owner']),
    count: z.number().int(),
  }),
  events: z.array(cloudEventSchema),
  /** The server can draw office files as a PDF (LibreOffice is there). */
  officePreview: z.boolean(),
});
export type CloudNodeDetail = z.infer<typeof cloudNodeDetailSchema>;

// ── Search ──────────────────────────────────────────────────────────────────

export const cloudSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  /** In the names (files and folders), in what the files say, or both (names first). */
  in: z.enum(['name', 'text', 'all']).default('name'),
  /** Only where it lies: an area's id, `own` (one's own files) or `shared` (shared with one). */
  area: z.string().min(1).optional(),
  /** Only whose it is: who put it there (a user id). */
  owner: z.string().min(1).optional(),
});
export type CloudSearchQuery = z.infer<typeof cloudSearchQuerySchema>;
export const cloudSearchResultSchema = z.object({
  nodes: z.array(cloudNodeSchema),
  /** More matched than are listed. */
  more: z.boolean(),
  /** `in=text`/`all`: by node id, the place in the file where it was found. */
  snippets: z.record(z.string(), z.string()).optional(),
  /** `in=text`/`all`: some files are not read yet – asking again reads on. */
  pending: z.boolean().optional(),
});
export type CloudSearchResult = z.infer<typeof cloudSearchResultSchema>;

// ── The workspace's own overview ────────────────────────────────────────────

/**
 * `GET /workspaces/:id/cloud`: what the shell needs on every page – the areas, the counts beside
 * the navigation, the storage bar.
 */
export const cloudHomeSchema = z.object({
  areas: z.array(cloudAreaSchema),
  /** The folders the caller pinned, in the order pinned. */
  pins: z.array(cloudPinSchema),
  /** May found areas (members and admins). */
  canCreateAreas: z.boolean(),
  counts: z.object({
    /** Shared with the caller and not opened yet. */
    sharedNew: z.number().int(),
    trash: z.number().int(),
  }),
  storage: z.object({
    /** Everything the workspace stores: presentations and files. */
    usedBytes: z.number().int(),
    maxBytes: z.number().int().nullable(),
    /** Its parts, for the bar. */
    presentationBytes: z.number().int(),
    documentBytes: z.number().int(),
    mediaBytes: z.number().int(),
    otherBytes: z.number().int(),
  }),
  /** The largest file one request may send (bytes). */
  maxFileBytes: z.number().int(),
  /** Files can be opened to people outside by a link (off unless the instance says so). */
  links: z.boolean().default(false),
  /** Files can be shared with a person by hand (off unless the instance says so). */
  sharing: z.boolean().default(false),
  /** The caller has files of their own (members and admins). */
  ownFiles: z.boolean().default(true),
  /** Something is shared with the caller or by them. */
  shared: z.boolean().default(false),
});
export type CloudHome = z.infer<typeof cloudHomeSchema>;

/**
 * `GET /workspaces/:id/cloud/overview` (admins): where the workspace's storage goes, who is in
 * which area, what is shared by link – sizes and names of files, never their content.
 */
export const cloudOverviewSchema = z.object({
  totals: z.object({
    files: z.number().int(),
    folders: z.number().int(),
    bytes: z.number().int(),
    /** Older versions of files, counted in `bytes`. */
    versionBytes: z.number().int(),
    trashBytes: z.number().int(),
    trashCount: z.number().int(),
    links: z.number().int(),
    shares: z.number().int(),
  }),
  storage: cloudHomeSchema.shape.storage,
  byArea: z.array(
    z.object({
      /** `null`: everyone's own files together. */
      areaId: z.string().nullable(),
      name: z.string(),
      color: cloudAreaColorSchema.nullable(),
      files: z.number().int(),
      bytes: z.number().int(),
    }),
  ),
  byType: z.array(
    z.object({ type: cloudFileTypeSchema, files: z.number().int(), bytes: z.number().int() }),
  ),
  /** Per person: what their own files take – a size, never what they are. */
  byPerson: z.array(
    z.object({
      person: cloudPersonSchema,
      areaIds: z.array(z.string()),
      ownBytes: z.number().int(),
      lastActiveAt: z.iso.datetime().nullable(),
    }),
  ),
  /** The largest files in areas (not people's own). */
  largest: z.array(cloudNodeSchema),
  /** Every link that opens something to people outside. */
  links: z.array(z.object({ share: cloudShareSchema, node: cloudNodeSchema })),
  /** Files that came and went per day, the last 30 days, oldest first. */
  days: z.array(z.object({ day: z.string(), uploads: z.number().int(), bytes: z.number().int() })),
});
export type CloudOverview = z.infer<typeof cloudOverviewSchema>;

// ── A link, opened by someone outside ───────────────────────────────────────

/** `GET /cloud/public/:token`: what the link shows – a file, or a folder to walk through. */
export const cloudPublicSchema = z.object({
  workspaceName: z.string(),
  sharedBy: z.string(),
  expiresAt: z.iso.datetime().nullable(),
  /** The shared file or folder itself. */
  root: z.object({ id: z.string(), name: z.string(), kind: cloudNodeKindSchema }),
  /** The open folder (the root or one inside), or the file. */
  node: z.object({
    id: z.string(),
    name: z.string(),
    kind: cloudNodeKindSchema,
    fileType: cloudFileTypeSchema.nullable(),
    sizeBytes: z.number().int(),
    updatedAt: z.iso.datetime(),
    versionId: z.string().nullable(),
    thumbnail: z.boolean(),
  }),
  path: z.array(z.object({ id: z.string(), name: z.string() })),
  children: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: cloudNodeKindSchema,
      fileType: cloudFileTypeSchema.nullable(),
      sizeBytes: z.number().int(),
      updatedAt: z.iso.datetime(),
      versionId: z.string().nullable(),
      thumbnail: z.boolean(),
    }),
  ),
});
export type CloudPublic = z.infer<typeof cloudPublicSchema>;

// ── Links to content ────────────────────────────────────────────────────────

/** Paths under `API_PREFIX`; the version in the query makes a new version a new address. */
export const cloudPaths = {
  content: (nodeId: string, versionId?: string | null, download = false) =>
    `/cloud/nodes/${nodeId}/content${query({ v: versionId, download: download ? '1' : null })}`,
  thumbnail: (nodeId: string, versionId?: string | null) =>
    `/cloud/nodes/${nodeId}/thumbnail${query({ v: versionId })}`,
  /** The file as a PDF (office files). */
  preview: (nodeId: string, versionId?: string | null) =>
    `/cloud/nodes/${nodeId}/preview${query({ v: versionId })}`,
  /** Several files and folders as one ZIP. */
  archive: (workspaceId: string, ids: readonly string[]) =>
    `/workspaces/${workspaceId}/cloud/archive${query({ ids: ids.join(',') })}`,
  publicContent: (token: string, nodeId: string, download = false) =>
    `/cloud/public/${token}/content${query({ node: nodeId, download: download ? '1' : null })}`,
  publicThumbnail: (token: string, nodeId: string) =>
    `/cloud/public/${token}/thumbnail${query({ node: nodeId })}`,
  publicArchive: (token: string, nodeId: string) =>
    `/cloud/public/${token}/archive${query({ node: nodeId })}`,
};

function query(values: Record<string, string | null | undefined>): string {
  const parts = Object.entries(values)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}
