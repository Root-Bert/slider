import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Deck } from '@slider/shared';
import { encryptToken } from '../src/auth/token-crypto';
import { users } from '../src/db/schema';
import { PICKER_CONSENT_MESSAGE } from '../src/sources/onedrive-picker';
import type { FetchLike } from '../src/sources/safe-fetch';
import { createTestContext, MICROSOFT_TEST_CONFIG, type TestContext } from './helpers';

const SECRET = 'test-secret-test-secret-test-secret!';
const TOKEN_URL =
  /^https:\/\/login\.microsoftonline\.com\/(common|consumers)\/oauth2\/v2\.0\/token$/;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const PPTX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

type Drive = { driveType: 'personal' | 'business'; webUrl: string };
const PERSONAL: Drive = { driveType: 'personal', webUrl: 'https://onedrive.live.com/?cid=abc' };
const BUSINESS: Drive = {
  driveType: 'business',
  webUrl: 'https://contoso-my.sharepoint.com/personal/robert_contoso_com/Documents',
};

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

/**
 * A Microsoft-configured app whose owner is signed in with Microsoft. Records the scopes the
 * refresh token is traded for; `refuse` makes Microsoft decline one of them.
 */
async function pickerContext({
  drive = BUSINESS,
  signedIn = true,
  refuse,
  graph = {},
}: {
  drive?: Drive;
  signedIn?: boolean;
  refuse?: { scope: string; error: string; description: string };
  graph?: Record<string, () => Response>;
} = {}) {
  const scopes: string[] = [];
  /** `tenant scope` of every token request. */
  const requests: string[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = String(input);
    const tokenMatch = TOKEN_URL.exec(url);
    if (tokenMatch) {
      const scope = new URLSearchParams(String(init?.body)).get('scope') ?? '';
      scopes.push(scope);
      requests.push(`${tokenMatch[1]} ${scope}`);
      if (refuse && scope === refuse.scope) {
        return Response.json(
          { error: refuse.error, error_description: refuse.description },
          { status: 400 },
        );
      }
      return Response.json({ access_token: `token for ${scope}`, expires_in: 3600 });
    }
    if (url.startsWith(`${GRAPH}/me/drive?`)) return Response.json(drive);
    const route = Object.keys(graph).find((prefix) => url.startsWith(prefix));
    if (route) return graph[route]!();
    throw new Error(`Unexpected request: ${url}`);
  };
  const context = await createTestContext({
    config: { microsoft: MICROSOFT_TEST_CONFIG, secret: SECRET },
    fetch,
  });
  if (signedIn) {
    await context.deps.db
      .update(users)
      .set({ msRefreshToken: await encryptToken(SECRET, 'rt-1') })
      .where(eq(users.id, context.ownerId));
  }
  ctx = context;
  return { ctx: context, scopes, requests };
}

const errorOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string; message: string; loginUrl?: string } }).error;

describe('GET /api/microsoft/file-picker', () => {
  it('opens the consumer picker for a personal OneDrive', async () => {
    const { ctx } = await pickerContext({ drive: PERSONAL });
    const res = await ctx.request('/api/microsoft/file-picker');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      account: 'personal',
      baseUrl: 'https://onedrive.live.com/picker',
      pickerUrl: 'https://onedrive.live.com/picker',
    });
  });

  it('opens the picker on the OneDrive host of a work account', async () => {
    const { ctx } = await pickerContext();
    const res = await ctx.request('/api/microsoft/file-picker');
    expect(await res.json()).toEqual({
      account: 'business',
      baseUrl: 'https://contoso-my.sharepoint.com',
      pickerUrl: 'https://contoso-my.sharepoint.com/_layouts/15/FilePicker.aspx',
    });
  });

  it('asks for a Microsoft login that comes back to the start page', async () => {
    const { ctx } = await pickerContext({ signedIn: false });
    const res = await ctx.request('/api/microsoft/file-picker');
    expect(res.status).toBe(401);
    const error = await errorOf(res);
    expect(error.code).toBe('microsoft_login_required');
    expect(error.loginUrl).toBe('/api/auth/microsoft/login?returnTo=%2Fneu');
  });

  it('says when Microsoft is not set up on this server', async () => {
    ctx = await createTestContext();
    const res = await ctx.request('/api/microsoft/file-picker');
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe('microsoft_not_configured');
  });
});

describe('POST /api/microsoft/file-picker/token', () => {
  const tokenFor = (context: TestContext, resource: string) =>
    context.request('/api/microsoft/file-picker/token', { method: 'POST', json: { resource } });

  it('trades the refresh token for a SharePoint token of the own tenant', async () => {
    const { ctx, scopes } = await pickerContext();
    for (const host of ['contoso-my.sharepoint.com', 'contoso.sharepoint.com']) {
      const res = await tokenFor(ctx, `https://${host}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ token: `token for https://${host}/.default` });
    }
    expect(scopes).toContain('https://contoso-my.sharepoint.com/.default');
  });

  it('serves Graph with the usual read token', async () => {
    const { ctx } = await pickerContext();
    const res = await tokenFor(ctx, 'https://graph.microsoft.com');
    expect(((await res.json()) as { token: string }).token).toMatch(/Files\.Read\.All/);
  });

  it.each(['https://fabrikam.sharepoint.com', 'https://example.com', 'not a url'])(
    'never mints tokens for %s',
    async (resource) => {
      const { ctx, scopes } = await pickerContext();
      const res = await tokenFor(ctx, resource);
      expect(res.status).toBe(400);
      expect(scopes.some((scope) => scope.endsWith('/.default'))).toBe(false);
    },
  );

  it('asks the consumers authority for OneDrive.ReadOnly on personal accounts', async () => {
    const { ctx, requests } = await pickerContext({ drive: PERSONAL });
    const res = await tokenFor(ctx, 'https://my.microsoftpersonalcontent.com');
    expect(await res.json()).toEqual({ token: 'token for OneDrive.ReadOnly' });
    expect(requests).toContain('consumers OneDrive.ReadOnly');
  });

  it('does not hand the picker a Graph token when Microsoft refuses the consumer scope', async () => {
    const { ctx } = await pickerContext({
      drive: PERSONAL,
      refuse: {
        scope: 'OneDrive.ReadOnly',
        error: 'invalid_scope',
        description: 'AADSTS70011: The provided value for the input parameter scope is not valid.',
      },
    });
    const res = await tokenFor(ctx, 'https://onedrive.live.com/picker');
    expect(res.status).toBe(502);
    expect((await errorOf(res)).message).toContain('invalid_scope');
  });

  it('explains missing SharePoint permissions and keeps the sign-in', async () => {
    const { ctx } = await pickerContext({
      refuse: {
        scope: 'https://contoso-my.sharepoint.com/.default',
        error: 'invalid_grant',
        description: 'AADSTS65001: The user or administrator has not consented.',
      },
    });
    const res = await tokenFor(ctx, 'https://contoso-my.sharepoint.com');
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({
      code: 'microsoft_consent_required',
      message: PICKER_CONSENT_MESSAGE,
    });
    const [owner] = await ctx.deps.db.select().from(users).where(eq(users.id, ctx.ownerId));
    expect(owner?.msRefreshToken).not.toBeNull();
  });
});

describe('POST /api/decks/drive-item', () => {
  const item = (name: string, driveId: string) => () =>
    Response.json({
      id: 'ITEM!1',
      name,
      size: PPTX.byteLength,
      cTag: 'ctag-1',
      webUrl: `https://example.invalid/${name}`,
      file: { mimeType: 'application/octet-stream' },
      parentReference: { driveId },
      '@microsoft.graph.downloadUrl': 'https://download.example.com/file',
    });
  const download = () => new Response(PPTX, { status: 200 });

  it.each([
    ['b!work-drive', 'sharepoint'],
    ['abc123def', 'onedrive'],
  ])('imports a picked file from drive %s as a %s deck', async (driveId, source) => {
    const { ctx } = await pickerContext({
      graph: {
        [`${GRAPH}/drives/${driveId}/items/ITEM!1`]: item('Pitch.pptx', driveId),
        'https://download.example.com/': download,
      },
    });
    const res = await ctx.request('/api/decks/drive-item', {
      method: 'POST',
      json: { driveId, itemId: 'ITEM!1', workspaceId: ctx.workspaceId },
    });
    expect(res.status).toBe(201);
    const deck = (await res.json()) as Deck;
    expect(deck.title).toBe('Pitch');
    expect(deck.source).toBe(source);
  });

  it('refuses anything but a PowerPoint', async () => {
    const { ctx } = await pickerContext({
      graph: { [`${GRAPH}/drives/b!d/items/ITEM!1`]: item('Notes.docx', 'b!d') },
    });
    const res = await ctx.request('/api/decks/drive-item', {
      method: 'POST',
      json: { driveId: 'b!d', itemId: 'ITEM!1' },
    });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('not_a_powerpoint');
  });

  it('sends the person to sign in again, back to the start page', async () => {
    const { ctx } = await pickerContext({ signedIn: false });
    const res = await ctx.request('/api/decks/drive-item', {
      method: 'POST',
      json: { driveId: 'b!d', itemId: 'ITEM!1' },
    });
    expect(res.status).toBe(401);
    expect((await errorOf(res)).loginUrl).toBe('/api/auth/microsoft/login?returnTo=%2Fneu');
  });
});
