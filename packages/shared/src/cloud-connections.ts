import { z } from 'zod';

/*
 * „Verbindungen“ in Cloud: services outside – Figma, Linear, a company's own – that a person
 * connects so that their agents can work there too. Each is an MCP server by its address, or a
 * plain HTTP API (`kind: 'api'`: a base address, how it signs in, what it is for). A connection
 * is its person's: their sign-in there, used when they write to an agent, seen by nobody else.
 */

export const MAX_CONNECTION_NAME = 60;

/** Services with a known address: named, an agent or the page connects them without one. */
export const KNOWN_CONNECTIONS = [
  { id: 'figma', name: 'Figma', url: 'https://mcp.figma.com/mcp' },
  { id: 'linear', name: 'Linear', url: 'https://mcp.linear.app/mcp' },
  { id: 'notion', name: 'Notion', url: 'https://mcp.notion.com/mcp' },
  { id: 'github', name: 'GitHub', url: 'https://api.githubcopilot.com/mcp/' },
  { id: 'atlassian', name: 'Atlassian', url: 'https://mcp.atlassian.com/v1/mcp' },
  { id: 'sentry', name: 'Sentry', url: 'https://mcp.sentry.dev/mcp' },
] as const;

/** The known service a word means – its name or id, as a person or an agent says it. */
export const knownConnection = (said: string) => {
  const key = said.trim().toLowerCase();
  return KNOWN_CONNECTIONS.find((each) => each.id === key || each.name.toLowerCase() === key);
};

/** An MCP server, or a plain HTTP API an agent calls by method and path. */
export const CLOUD_CONNECTION_KINDS = ['mcp', 'api'] as const;
export type CloudConnectionKind = (typeof CLOUD_CONNECTION_KINDS)[number];

/**
 * How an API signs in: not at all, a token (`Authorization: Bearer …`), a key in a header of its
 * own (`X-Api-Key: …`), or a user and password (`Basic`). The secret itself lies sealed on the
 * server and is never shown again – not to the page, not to an agent.
 */
export const API_AUTHS = ['none', 'bearer', 'header', 'basic'] as const;
export type ApiAuth = (typeof API_AUTHS)[number];
export const API_AUTH_LABELS: Record<ApiAuth, string> = {
  none: 'Keine',
  bearer: 'Token',
  header: 'Schlüssel im Header',
  basic: 'Benutzer und Passwort',
};
export const MAX_API_ABOUT = 1000;
/** A header's name, as HTTP has it – the key's header of an API. */
export const API_HEADER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,59}$/;
/**
 * Headers a key may not go in: they steer the request itself, or are the browser's – or a
 * redirect to another server keeps them (`CROSS_ORIGIN_HEADERS` in `safe-fetch.ts`).
 */
const RESERVED_HEADERS =
  /^(host|cookie|content-(length|type|encoding)|transfer-encoding|connection|keep-alive|upgrade|te|trailer|expect|accept(-.*)?|range|user-agent|proxy-.*|sec-.*)$/i;

export const apiSettingsSchema = z
  .object({
    auth: z.enum(API_AUTHS),
    /** The header the key goes in, with `auth: 'header'`. */
    header: z
      .string()
      .trim()
      .regex(API_HEADER_NAME, 'Das ist kein Name für einen Header.')
      .optional(),
    /** Where its OpenAPI description lies (JSON): read once, its operations kept. */
    spec: z.string().trim().min(1).max(500).optional(),
    /** What it is for, in the person's words – for the agents. */
    about: z.string().trim().max(MAX_API_ABOUT).optional(),
  })
  .refine((api) => api.auth !== 'header' || Boolean(api.header), {
    message: 'Der Name des Headers fehlt.',
    path: ['header'],
  })
  .refine((api) => !api.header || !RESERVED_HEADERS.test(api.header), {
    message: 'In diesen Header kann kein Schlüssel.',
    path: ['header'],
  });
export type ApiSettings = z.infer<typeof apiSettingsSchema>;

export const cloudConnectionInputSchema = z.object({
  /** An address, or the name of a known service; an API's base address. */
  url: z.string().trim().min(1).max(500),
  name: z.string().trim().min(1).max(MAX_CONNECTION_NAME).optional(),
  /** Left out: an MCP server. */
  kind: z.enum(CLOUD_CONNECTION_KINDS).optional(),
  /** An API's sign-in and description (`kind: 'api'`). */
  api: apiSettingsSchema.optional(),
  /** A key the service gave the person, where it signs in by one; an API's token or password. */
  token: z.string().trim().min(1).max(4000).optional(),
  /** An API's user, with `auth: 'basic'`. */
  user: z.string().trim().min(1).max(200).optional(),
});
export type CloudConnectionInput = z.infer<typeof cloudConnectionInputSchema>;

export const cloudConnectionPatchSchema = z.object({ mayChange: z.boolean() });

/**
 * `sign_in`: the service wants the person to sign in; `failed`: it did not answer as it should;
 * `proposed`: an agent suggested it – nothing is reached until the person connects it.
 */
export const CLOUD_CONNECTION_STATES = ['connected', 'sign_in', 'failed', 'proposed'] as const;
export type CloudConnectionState = (typeof CLOUD_CONNECTION_STATES)[number];

/**
 * Whether an address reads as an HTTP API rather than an MCP server – one that is no MCP server
 * is then offered as an API on the page, anything else gets an agent that helps.
 */
export function looksLikeApi(address: string): boolean {
  try {
    const url = new URL(address.trim());
    return (
      /^api[.-]/i.test(url.hostname) ||
      /(^|\/)(api|rest|graphql)(\/|$)|(^|\/)v\d+(\.\d+)?(\/|$)/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/** What a service lets an agent do there – an API's operations (`GET /users`). */
export interface CloudConnectionTool {
  name: string;
  description: string;
  /** It only reads: an agent may use it without the person's say. */
  reading: boolean;
}

export interface CloudConnection {
  id: string;
  name: string;
  kind: CloudConnectionKind;
  /** Where it goes, as a person reads it: `mcp.figma.com`. */
  host: string;
  /** The whole address – an API's base, a proposal's to connect. */
  url: string;
  /** An API's sign-in and description – never its secret. */
  api: ApiSettings | null;
  state: CloudConnectionState;
  /** Why it does not work, in words for the person. */
  error: string | null;
  tools: CloudConnectionTool[];
  /** Agents may change things there too, not only read. */
  mayChange: boolean;
  /** Where the person signs in, when the service asks for it. */
  signInUrl: string | null;
  createdAt: string;
}

/** Where the service sends the person back to after signing in. */
export const CLOUD_CONNECTION_CALLBACK_PATH = '/api/cloud/connections/callback';
/** The link that starts signing in – on the page's button and in an agent's answer. */
export const cloudConnectionSignInPath = (connectionId: string) =>
  `/api/cloud/connections/${connectionId}/sign-in`;
