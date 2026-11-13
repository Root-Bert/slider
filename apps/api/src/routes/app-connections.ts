import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Hono, type Context } from 'hono';
import {
  MCP_PATH,
  appRequestInputSchema,
  approveAppInputSchema,
  createAppTokenInputSchema,
} from '@slider/shared';
import { userViewer, viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { aiLimits } from '../http/ai-limits';
import { notFound } from '../http/errors';
import { rateLimit } from '../http/rate-limit';
import { MAX_JSON_BODY_BYTES, readJson } from '../http/validate';
import {
  OAuthError,
  approveAppRequest,
  authenticateAppToken,
  authorizeRedirect,
  createAppToken,
  denyAppRequest,
  describeAppRequest,
  exchangeToken,
  issuerOf,
  listAppConnections,
  mcpUrlOf,
  oauthOffered,
  registerClient,
  removeAppConnection,
} from '../services/app-connections';
import { MCP_INSTRUCTIONS, MCP_TOOLS, runMcpTool } from '../services/mcp';

/*
 * „KI-Apps“ (`services/app-connections.ts`, `services/mcp.ts`):
 * - `/.well-known/oauth-protected-resource[/api/mcp]` and `/.well-known/oauth-authorization-server`
 *   (also as `openid-configuration`): how an app finds out how to sign in – at the origin's root;
 * - `/api/oauth/register|authorize|token`: OAuth 2.1 with PKCE, dynamic client registration;
 * - `/api/connections…`: „KI-Apps“ on `/konto` and the consent page `/verbinden` (session);
 * - `/api/mcp`: the MCP server (Streamable HTTP, stateless), a bearer token only – never the
 *   session cookie, so no page can make an app's calls in its person's name.
 * The desktop's local server has no OAuth (no app can reach it to sign in): tokens only.
 */

const HOUR_MS = 60 * 60 * 1000;

/** Paths whose answers any origin may read (apps in a browser, the MCP Inspector) – no cookies. */
export const OPEN_PATHS = [MCP_PATH, '/api/oauth/token', '/api/oauth/register'];
export const isOpenPath = (path: string) =>
  OPEN_PATHS.includes(path) || path.startsWith('/.well-known/');

const resourceMetadataUrl = (deps: AppDeps) =>
  `${issuerOf(deps)}/.well-known/oauth-protected-resource${MCP_PATH}`;

/** The discovery documents at the origin's root. */
export function wellKnownRoutes(deps: AppDeps) {
  const resource = () => ({
    resource: mcpUrlOf(deps),
    authorization_servers: [issuerOf(deps)],
    bearer_methods_supported: ['header'],
    scopes_supported: ['slider'],
    resource_name: 'Slider',
    resource_documentation: `${issuerOf(deps)}/konto`,
  });
  const server = () => {
    const issuer = issuerOf(deps);
    return {
      issuer,
      authorization_endpoint: `${issuer}/api/oauth/authorize`,
      token_endpoint: `${issuer}/api/oauth/token`,
      registration_endpoint: `${issuer}/api/oauth/register`,
      scopes_supported: ['slider'],
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      service_documentation: `${issuer}/konto`,
    };
  };
  const offered = (c: Context, body: () => object) =>
    oauthOffered(deps) ? c.json(body()) : c.json({ error: 'not_found' }, 404);
  return new Hono()
    .get('/.well-known/oauth-protected-resource', (c) => offered(c, resource))
    .get(`/.well-known/oauth-protected-resource${MCP_PATH}`, (c) => offered(c, resource))
    .get('/.well-known/oauth-authorization-server', (c) => offered(c, server))
    .get(`/.well-known/oauth-authorization-server${MCP_PATH}`, (c) => offered(c, server))
    .get('/.well-known/openid-configuration', (c) => offered(c, server));
}

/** An OAuth endpoint's body: a form (as the standard says) or JSON. */
async function readForm(c: Context): Promise<Record<string, string | undefined>> {
  const type = c.req.header('content-type') ?? '';
  const raw = await c.req.raw.text();
  if (raw.length > MAX_JSON_BODY_BYTES) throw new OAuthError('invalid_request', 'Body too large.');
  if (type.includes('application/json')) {
    try {
      const body = JSON.parse(raw) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(body).map(([key, value]) => [
          key,
          typeof value === 'string' ? value : undefined,
        ]),
      );
    } catch {
      throw new OAuthError('invalid_request', 'The body is no JSON.');
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

const oauthError = (c: Context, error: unknown) => {
  if (!(error instanceof OAuthError)) throw error;
  return c.json(error.toBody(), error.status as 400, { 'Cache-Control': 'no-store' });
};

/** A plain page for what cannot go back to the app (unknown app, foreign redirect). */
const problemPage = (message: string) =>
  `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Slider</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#222"><h1 style="font-size:1.25rem">Verbindung nicht möglich</h1><p>${message.replace(/[<>&]/g, '')}</p></body></html>`;

export function appConnectionsRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const registrations = rateLimit({ limit: 30, windowMs: HOUR_MS, clock: deps.clock });
  const tokens = rateLimit({ limit: 120, windowMs: 60 * 1000, clock: deps.clock });
  // May fetch an app's metadata document: a person signs in a few times, a loop is stopped.
  const authorizations = rateLimit({ limit: 60, windowMs: 60 * 1000, clock: deps.clock });
  const noOAuth = () => notFound('Auf diesem Server melden sich KI-Apps mit einem Token an.');

  return (
    new Hono<ViewerEnv>()
      // ── OAuth ────────────────────────────────────────────────────────────
      .post('/oauth/register', registrations, async (c) => {
        if (!oauthOffered(deps)) throw noOAuth();
        try {
          const raw = await c.req.raw.text();
          if (raw.length > 64 * 1024) throw new OAuthError('invalid_client_metadata', 'Too large.');
          let body: Record<string, unknown>;
          try {
            body = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            throw new OAuthError('invalid_client_metadata', 'The body is no JSON.');
          }
          return c.json(await registerClient(deps, body), 201, { 'Cache-Control': 'no-store' });
        } catch (error) {
          return oauthError(c, error);
        }
      })
      .get('/oauth/authorize', authorizations, async (c) => {
        if (!oauthOffered(deps)) throw noOAuth();
        const result = await authorizeRedirect(deps, c.req.query());
        if ('problem' in result) return c.html(problemPage(result.problem), 400);
        return c.redirect(result.to, 302);
      })
      .post('/oauth/token', tokens, async (c) => {
        if (!oauthOffered(deps)) throw noOAuth();
        try {
          return c.json(await exchangeToken(deps, await readForm(c)), 200, {
            'Cache-Control': 'no-store',
            Pragma: 'no-cache',
          });
        } catch (error) {
          return oauthError(c, error);
        }
      })

      // ── „KI-Apps“ on /konto and the consent page ─────────────────────────
      .get('/connections', viewer, async (c) =>
        c.json(await listAppConnections(deps, { id: c.var.viewer.author.id })),
      )
      .post('/connections/tokens', viewer, async (c) => {
        const input = await readJson(c, createAppTokenInputSchema);
        return c.json(await createAppToken(deps, { id: c.var.viewer.author.id }, input), 201);
      })
      .delete('/connections/:connectionId', viewer, async (c) => {
        await removeAppConnection(
          deps,
          { id: c.var.viewer.author.id },
          c.req.param('connectionId'),
        );
        return c.body(null, 204);
      })
      .post('/connections/request', viewer, async (c) => {
        const { request } = await readJson(c, appRequestInputSchema);
        return c.json(await describeAppRequest(deps, { id: c.var.viewer.author.id }, request));
      })
      .post('/connections/approve', viewer, async (c) => {
        const { request, workspaceId } = await readJson(c, approveAppInputSchema);
        const redirectUrl = await approveAppRequest(
          deps,
          { id: c.var.viewer.author.id },
          request,
          workspaceId,
        );
        return c.json({ redirectUrl });
      })
      .post('/connections/deny', viewer, async (c) => {
        const { request } = await readJson(c, appRequestInputSchema);
        return c.json({ redirectUrl: denyAppRequest(deps, request) });
      })

      // ── MCP ──────────────────────────────────────────────────────────────
      .all('/mcp', async (c) => {
        const given = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header('authorization') ?? '')?.[1];
        const found = given ? await authenticateAppToken(deps, given) : null;
        if (!found) {
          const challenge = [
            `Bearer resource_metadata="${resourceMetadataUrl(deps)}"`,
            ...(given ? ['error="invalid_token"'] : []),
          ].join(', ');
          return c.json(
            {
              error: given ? 'invalid_token' : 'unauthorized',
              error_description: given
                ? 'The token is unknown, expired or was removed.'
                : 'Sign in to Slider (OAuth) or send a token from Slider → Konto → KI-Apps.',
            },
            401,
            { 'WWW-Authenticate': challenge },
          );
        }
        // Per person, whatever the tool – the costly ones count in the page's windows too.
        const hit = aiLimits(deps).mcpCalls.hit(found.user.id);
        if (!hit.allowed)
          return c.json(
            {
              error: 'rate_limited',
              error_description: `Too many calls at once – try again in ${hit.retryAfterS} s.`,
            },
            429,
            { 'Retry-After': String(hit.retryAfterS) },
          );
        const caller = {
          viewer: userViewer(found.user),
          workspaceId: found.connection.workspaceId,
        };
        const server = new Server(
          { name: 'slider', title: 'Slider', version: '1.0.0', websiteUrl: issuerOf(deps) },
          { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS },
        );
        server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: MCP_TOOLS }));
        server.setRequestHandler(CallToolRequestSchema, async (request) => {
          const result = await runMcpTool(
            deps,
            caller,
            request.params.name,
            (request.params.arguments ?? {}) as Record<string, unknown>,
          );
          return { ...result };
        });
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        await server.connect(transport);
        try {
          return await transport.handleRequest(c.req.raw);
        } finally {
          void server.close();
        }
      })
  );
}
