import { z } from 'zod';

/*
 * „KI-Apps“ (`/konto`): Claude, ChatGPT and other AI apps reach Slider over MCP – read the
 * presentations and their material, put research and summaries on a deck's board. Each app is
 * let in by its person, for all their workspaces or one: over OAuth (the app asks, Slider asks
 * its person, `/verbinden`), or with a token made here for apps that take one (Claude Code, the
 * desktop app). Taken away any time („Entfernen“).
 */

/** Where Slider's MCP server answers, below the web app's origin. */
export const MCP_PATH = '/api/mcp';

/** `oauth`: the app asked and its person let it in; `token`: a token made on `/konto`. */
export const APP_CONNECTION_KINDS = ['oauth', 'token'] as const;
export type AppConnectionKind = (typeof APP_CONNECTION_KINDS)[number];

export const appConnectionSchema = z.object({
  id: z.string(),
  /** The app's name as it gave it, or the token's name. */
  name: z.string(),
  kind: z.enum(APP_CONNECTION_KINDS),
  /** Only this workspace; `null`: all of the person's workspaces. */
  workspaceId: z.string().nullable(),
  workspaceName: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type AppConnection = z.infer<typeof appConnectionSchema>;

export const appConnectionsSchema = z.object({
  /** The address an app is given (`https://…/api/mcp`). */
  mcpUrl: z.string(),
  /** Whether apps can sign in themselves (OAuth) – not on the desktop's local server. */
  oauth: z.boolean(),
  connections: z.array(appConnectionSchema),
});
export type AppConnections = z.infer<typeof appConnectionsSchema>;

export const MAX_APP_NAME = 80;

export const createAppTokenInputSchema = z.object({
  name: z.string().trim().min(1, 'Gib dem Token einen Namen.').max(MAX_APP_NAME),
  workspaceId: z.string().min(1).max(100).nullable(),
});
export type CreateAppTokenInput = z.infer<typeof createAppTokenInputSchema>;

/** A token just made: shown once, never again. */
export const createdAppTokenSchema = z.object({
  connection: appConnectionSchema,
  token: z.string(),
});
export type CreatedAppToken = z.infer<typeof createdAppTokenSchema>;

/** An app asking to be let in (`/verbinden?anfrage=…`): what its person is shown. */
export const appRequestSchema = z.object({
  clientName: z.string(),
  /** Where it goes back to (its host), so a look-alike name gives itself away. */
  redirectHost: z.string(),
  workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type AppRequest = z.infer<typeof appRequestSchema>;

export const appRequestInputSchema = z.object({ request: z.string().min(1).max(8000) });

export const approveAppInputSchema = appRequestInputSchema.extend({
  workspaceId: z.string().min(1).max(100).nullable(),
});
export type ApproveAppInput = z.infer<typeof approveAppInputSchema>;

/** Where the browser goes on: back to the app, with its code or the refusal. */
export const appRedirectSchema = z.object({ redirectUrl: z.string() });
