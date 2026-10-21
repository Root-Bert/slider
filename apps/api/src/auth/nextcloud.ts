import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { NextcloudLoginStart } from '@slider/shared';
import type { Clock } from '../clock';
import { normalizeNextcloudServer, type NextcloudConfig } from '../config';
import type { Executor } from '../db/client';
import { nextcloudConnections } from '../db/schema';
import { ApiError, badRequest } from '../http/errors';
import type { Logger } from '../logger';
import {
  dnsLookup,
  fetchHop,
  readBodyCapped,
  safeFetch,
  type FetchLike,
  type LookupAll,
  type SafeFetchOptions,
} from '../sources/safe-fetch';
import {
  NextcloudClient,
  NextcloudUnauthorized,
  nextcloudLoginRequired,
  type NextcloudAccess,
  type NextcloudCredentials,
} from '../sources/nextcloud';
import type { NextcloudUser } from './nextcloud-login';
import { decryptToken, encryptToken } from './token-crypto';

/**
 * Connecting Nextcloud accounts with Login Flow v2 (BER-135): Slider asks the Nextcloud for a
 * login, the person signs in on Nextcloud's own page in a popup (with SSO and MFA, whatever that
 * Nextcloud uses) and Slider picks up an app password by polling. Works with every Nextcloud,
 * nothing to register there. The app password is stored encrypted and never sent to a browser.
 */

const PURPOSE = 'nextcloud-app-password';
/** Nextcloud keeps a login flow open for 20 minutes. */
const LOGIN_TTL_MS = 20 * 60 * 1000;
const MAX_PENDING_PER_USER = 5;
/** Names the app password in Nextcloud → Settings → Security. */
const DEVICE_NAME = 'Slider';
const MAX_ANSWER_BYTES = 64 * 1024;

interface PendingLogin {
  /** Whose login this is: an account id, or a browser's key for a sign-in (`auth/nextcloud`). */
  owner: string;
  server: string;
  token: string;
  endpoint: URL;
  expiresAt: number;
}

export interface NextcloudAccountsDeps {
  db: Executor;
  secret: string;
  clock: Clock;
  config: NextcloudConfig;
  log: Logger;
  maxBytes: number;
  /**
   * This Slider's address: Nextcloud shows "Slider (<host>)" on its grant page and as the app
   * password's name, so a forwarded login link says whose it is.
   */
  webOrigin?: string;
  fetch?: FetchLike;
  lookup?: LookupAll;
}

/** Only the organisation's Nextcloud may be internal or plain http. */
export function trustedNextcloud(config: NextcloudConfig): (url: URL) => boolean {
  if (!config.server) return () => false;
  const trusted = new URL(config.server);
  return (url) => url.origin === trusted.origin;
}

const loginFailed = (message: string) => new ApiError(502, 'source_unreachable', message);

type Granted = Pick<NextcloudCredentials, 'server' | 'loginName' | 'appPassword'>;

export class NextcloudAccounts implements NextcloudAccess {
  private readonly pending = new Map<string, PendingLogin>();
  readonly http: SafeFetchOptions;
  private readonly deviceName: string;

  constructor(private readonly deps: NextcloudAccountsDeps) {
    this.http = {
      fetch: deps.fetch ?? globalThis.fetch,
      lookup: deps.lookup ?? dnsLookup,
      maxBytes: deps.maxBytes,
      trusted: trustedNextcloud(deps.config),
    };
    this.deviceName = deps.webOrigin
      ? `${DEVICE_NAME} (${new URL(deps.webOrigin).host})`
      : DEVICE_NAME;
  }

  /**
   * The organisation's Nextcloud, else the address typed – normalised, must be a URL. With
   * `anyServer` (the sign-in) the typed address counts even when there is an organisation's one.
   */
  serverFor(input: string | undefined, anyServer = false): string {
    const fixed = this.deps.config.server;
    if (fixed && !anyServer) return fixed;
    const typed = (input ?? '').trim();
    if (!typed) throw badRequest('Gib die Adresse deiner Nextcloud ein.');
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`;
    let url: URL;
    try {
      url = new URL(normalizeNextcloudServer(withScheme));
    } catch {
      throw badRequest('Das ist keine gültige Adresse.');
    }
    // The organisation's Nextcloud may be plain http on an internal address.
    if (fixed && url.origin === new URL(fixed).origin) return fixed;
    if (url.protocol !== 'https:') {
      throw badRequest('Die Nextcloud muss über https:// erreichbar sein.');
    }
    return normalizeNextcloudServer(url.href);
  }

  /**
   * `POST /nextcloud/login` (and the sign-in, `POST /auth/nextcloud/flow`): asks the Nextcloud for
   * a login; the browser opens `loginUrl`.
   */
  async startLogin(
    owner: string,
    input: string | undefined,
    options: {
      /** The typed address counts even when there is an organisation's Nextcloud (sign-in). */
      anyServer?: boolean;
      /** After this, a grant is no longer picked up (Nextcloud itself keeps the link 20 minutes). */
      ttlMs?: number;
      /**
       * Who asks, after the device name – Nextcloud shows it on its grant page, so whoever is
       * asked to confirm sees it: "für robert@firma.de", or a code the asking window shows.
       */
      requester?: string;
    } = {},
  ): Promise<NextcloudLoginStart> {
    const { anyServer = false, ttlMs = LOGIN_TTL_MS, requester } = options;
    const server = this.serverFor(input, anyServer);
    this.dropExpired();
    const mine = [...this.pending.entries()].filter(([, login]) => login.owner === owner);
    for (const [id] of mine.slice(0, Math.max(0, mine.length - MAX_PENDING_PER_USER + 1))) {
      this.pending.delete(id);
    }
    let answer: { poll?: { token?: unknown; endpoint?: unknown }; login?: unknown };
    try {
      const { response } = await safeFetch(new URL(`${server}/index.php/login/v2`), this.http, {
        method: 'POST',
        headers: {
          'User-Agent': requester ? `${this.deviceName} ${requester}` : this.deviceName,
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw loginFailed('Unter dieser Adresse antwortet keine Nextcloud.');
      }
      answer = JSON.parse(
        new TextDecoder().decode(await readBodyCapped(response, MAX_ANSWER_BYTES)),
      );
    } catch (error) {
      if (error instanceof ApiError && error.code !== 'source_unreachable') throw error;
      throw loginFailed('Unter dieser Adresse antwortet keine Nextcloud.');
    }
    const origin = new URL(server).origin;
    const endpoint = sameOriginUrl(answer.poll?.endpoint, origin);
    const loginUrl = sameOriginUrl(answer.login, origin);
    const token = answer.poll?.token;
    if (!endpoint || !loginUrl || typeof token !== 'string' || !token) {
      throw loginFailed('Unter dieser Adresse antwortet keine Nextcloud.');
    }
    const id = crypto.randomUUID();
    this.pending.set(id, {
      owner,
      server,
      token,
      endpoint,
      expiresAt: this.deps.clock.now().getTime() + Math.min(ttlMs, LOGIN_TTL_MS),
    });
    return { id, loginUrl: loginUrl.href };
  }

  /**
   * `POST /nextcloud/login/:id/poll`: done once the person granted access in the popup. Then the
   * app password is checked against the Nextcloud and the connection saved.
   */
  async pollLogin(
    userId: string,
    id: string,
  ): Promise<{ status: 'pending' | 'expired' } | { status: 'done'; connectionId: string }> {
    const result = await this.pollGrant(userId, id);
    if (result.status !== 'granted') return result;
    const { granted } = result;
    try {
      const user = await this.identify(granted);
      return { status: 'done', connectionId: await this.connect(userId, granted, user.id) };
    } catch (error) {
      // Stored nowhere, so nobody could ever revoke it later: take the app password back now.
      await this.discard(granted);
      throw error;
    }
  }

  /**
   * One poll of a login flow: `granted` once the person granted access in the popup, with the
   * app password – which the caller either keeps ({@link connect}) or gives back
   * ({@link discard}); Nextcloud hands it out only once.
   */
  async pollGrant(
    owner: string,
    id: string,
  ): Promise<{ status: 'pending' | 'expired' } | { status: 'granted'; granted: Granted }> {
    this.dropExpired();
    const login = this.pending.get(id);
    if (!login || login.owner !== owner) return { status: 'expired' };
    const { response } = await safeFetch(login.endpoint, this.http, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.deviceName,
      },
      body: new URLSearchParams({ token: login.token }).toString(),
    });
    // 404 until the person granted access.
    if (response.status === 404) {
      await response.body?.cancel();
      return { status: 'pending' };
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw loginFailed('Nextcloud hat die Anmeldung nicht bestätigt. Bitte versuche es erneut.');
    }
    // Nextcloud hands the password out once: whatever happens now, this login is used up.
    this.pending.delete(id);
    let granted: { loginName?: unknown; appPassword?: unknown };
    try {
      granted = JSON.parse(
        new TextDecoder().decode(await readBodyCapped(response, MAX_ANSWER_BYTES)),
      );
    } catch {
      throw loginFailed('Nextcloud hat eine unerwartete Antwort geschickt.');
    }
    if (typeof granted.loginName !== 'string' || typeof granted.appPassword !== 'string') {
      throw loginFailed('Nextcloud hat eine unerwartete Antwort geschickt.');
    }
    return {
      status: 'granted',
      granted: {
        server: login.server,
        loginName: granted.loginName,
        appPassword: granted.appPassword,
      },
    };
  }

  /** Who the app password belongs to: the Nextcloud user id, address and display name. */
  async identify(granted: Granted): Promise<NextcloudUser> {
    const client = new NextcloudClient(this.http, { ...granted, userId: '' });
    let data: { id?: unknown; email?: unknown; displayname?: unknown } | undefined;
    try {
      const response = await client.request('GET', '/ocs/v2.php/cloud/user?format=json');
      const body = JSON.parse(
        new TextDecoder().decode(await readBodyCapped(response, MAX_ANSWER_BYTES)),
      ) as { ocs?: { data?: typeof data } };
      data = body.ocs?.data;
    } catch (error) {
      if (error instanceof NextcloudUnauthorized) {
        throw loginFailed('Nextcloud hat die Anmeldung nicht bestätigt. Bitte versuche es erneut.');
      }
      if (error instanceof ApiError) throw error;
      // Not JSON: handled below.
    }
    if (typeof data?.id !== 'string' || !data.id) {
      throw loginFailed('Nextcloud hat eine unerwartete Antwort geschickt.');
    }
    return {
      id: data.id,
      email: typeof data.email === 'string' && data.email.includes('@') ? data.email : null,
      displayName:
        typeof data.displayname === 'string' && data.displayname.trim() ? data.displayname : null,
    };
  }

  /** Gives an app password back to Nextcloud that will not be kept. */
  async discard(granted: Granted): Promise<void> {
    await this.revokeAppPassword(granted);
  }

  /** Stores (or renews) the connection of `ncUserId` ({@link identify}) for the account. */
  async connect(userId: string, granted: Granted, ncUserId: string): Promise<string> {
    const appPassword = await encryptToken(this.deps.secret, granted.appPassword, PURPOSE);
    const account = and(
      eq(nextcloudConnections.userId, userId),
      eq(nextcloudConnections.serverUrl, granted.server),
      eq(nextcloudConnections.ncUserId, ncUserId),
    );
    let [existing] = await this.deps.db.select().from(nextcloudConnections).where(account);
    if (!existing) {
      const [inserted] = await this.deps.db
        .insert(nextcloudConnections)
        .values({
          id: crypto.randomUUID(),
          userId,
          serverUrl: granted.server,
          loginName: granted.loginName,
          ncUserId,
          appPassword,
          createdAt: this.deps.clock.now(),
        })
        .onConflictDoNothing()
        .returning({ id: nextcloudConnections.id });
      if (inserted) return inserted.id;
      // Another tab connected the same account a moment ago: renew that connection instead.
      [existing] = await this.deps.db.select().from(nextcloudConnections).where(account);
      if (!existing) throw new Error('Nextcloud connection vanished while connecting');
    }
    // Connected again: the new app password replaces the old one, which goes at Nextcloud too.
    await this.revoke(existing).catch(() => false);
    await this.deps.db
      .update(nextcloudConnections)
      .set({ appPassword, loginName: granted.loginName, lastUsedAt: this.deps.clock.now() })
      .where(eq(nextcloudConnections.id, existing.id));
    return existing.id;
  }

  async credentials(userId: string, connectionId: string): Promise<NextcloudCredentials> {
    const [row] = await this.deps.db
      .select()
      .from(nextcloudConnections)
      .where(
        and(eq(nextcloudConnections.id, connectionId), eq(nextcloudConnections.userId, userId)),
      );
    if (!row) throw new ApiError(404, 'not_found', 'Dieses Nextcloud-Konto ist nicht verbunden.');
    if (!row.appPassword) throw nextcloudLoginRequired(row.serverUrl);
    let appPassword: string;
    try {
      appPassword = await decryptToken(this.deps.secret, row.appPassword, PURPOSE);
    } catch {
      // SLIDER_SECRET changed: connect again.
      throw nextcloudLoginRequired(row.serverUrl);
    }
    return { server: row.serverUrl, loginName: row.loginName, userId: row.ncUserId, appPassword };
  }

  async connectionsFor(userId: string, server: string): Promise<string[]> {
    const rows = await this.deps.db
      .select({ id: nextcloudConnections.id })
      .from(nextcloudConnections)
      .where(
        and(
          eq(nextcloudConnections.userId, userId),
          sql`lower(${nextcloudConnections.serverUrl}) = ${server.toLowerCase()}`,
          isNotNull(nextcloudConnections.appPassword),
        ),
      )
      .orderBy(
        sql`${nextcloudConnections.lastUsedAt} desc nulls last`,
        desc(nextcloudConnections.createdAt),
        asc(nextcloudConnections.id),
      );
    return rows.map((row) => row.id);
  }

  async markUsed(connectionId: string): Promise<void> {
    await this.deps.db
      .update(nextcloudConnections)
      .set({ lastUsedAt: this.deps.clock.now() })
      .where(eq(nextcloudConnections.id, connectionId));
  }

  async markRefused(connectionId: string): Promise<void> {
    this.deps.log.warn(`Nextcloud refused the app password of connection ${connectionId}`);
    await this.deps.db
      .update(nextcloudConnections)
      .set({ appPassword: null })
      .where(eq(nextcloudConnections.id, connectionId));
  }

  /**
   * Deletes the app password at Nextcloud (`DELETE /ocs/v2.php/core/apppassword`) – the one
   * write Slider ever sends there. `false` when Nextcloud could not be reached; then only the
   * person can revoke it (Settings → Security).
   */
  async revoke(row: {
    serverUrl: string;
    loginName: string;
    appPassword: string | null;
  }): Promise<boolean> {
    if (!row.appPassword) return true;
    let appPassword: string;
    try {
      appPassword = await decryptToken(this.deps.secret, row.appPassword, PURPOSE);
    } catch {
      return false;
    }
    return this.revokeAppPassword({ server: row.serverUrl, loginName: row.loginName, appPassword });
  }

  private async revokeAppPassword({ server, loginName, appPassword }: Granted): Promise<boolean> {
    try {
      const auth = Buffer.from(`${loginName}:${appPassword}`).toString('base64');
      const response = await fetchHop(new URL(`${server}/ocs/v2.php/core/apppassword`), this.http, {
        method: 'DELETE',
        headers: { Authorization: `Basic ${auth}`, 'OCS-APIRequest': 'true' },
      });
      await response.body?.cancel();
      // 401: already revoked at Nextcloud.
      return response.ok || response.status === 401;
    } catch (error) {
      this.deps.log.warn(`Could not revoke a Nextcloud app password at ${server}`, error);
      return false;
    }
  }

  private dropExpired(): void {
    const now = this.deps.clock.now().getTime();
    for (const [id, login] of this.pending) if (login.expiresAt <= now) this.pending.delete(id);
  }
}

/** `value` as a URL on `origin` (what Nextcloud answers must point back at itself). */
function sameOriginUrl(value: unknown, origin: string): URL | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.origin === origin ? url : null;
  } catch {
    return null;
  }
}
