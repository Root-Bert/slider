import type { Context, MiddlewareHandler } from 'hono';
import { API_PREFIX } from '@slider/shared';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';
import { instanceClaimed, setupGrant, setupGrantMatches } from '../services/instance-settings';
import { readCookie, writeCookie } from './cookies';
import { loadSessionUser } from './session';

export const SETUP_GRANT_COOKIE = 'slider_setup';
/** Long enough to set up the logins and sign in; the claim ends it sooner. */
const SETUP_GRANT_MAX_AGE_S = 24 * 60 * 60;
/** The web app's setup page. */
const SETUP_PAGE = '/einrichtung';

/**
 * Until the instance has an admin, nobody signs in or up – except in the browser that typed in
 * the setup token from the server log on the setup page (the setup grant, {@link grantSetup}).
 * There the first account signs in and claims the instance with the token (`POST /setup/claim`).
 * A signed-in account that hasn't claimed yet gets `instance_unclaimed` (403) on everything but
 * signing out, `GET /me` and the setup page itself.
 *
 * Development with the dev login (no login provider) stays as it was: the dev owner is never
 * asked. Once claimed, the state is kept in memory – an instance never loses its admin flag again,
 * so the gate costs nothing from then on.
 */
export class InstanceGate {
  private claimedSeen = false;

  constructor(private readonly deps: AppDeps) {}

  /** An instance admin exists (cached once true). */
  async claimed(): Promise<boolean> {
    if (this.claimedSeen) return true;
    if (await instanceClaimed(this.deps.db)) this.claimedSeen = true;
    return this.claimedSeen;
  }

  /** Whether signing in and up is closed: no admin yet, and this browser has no setup grant. */
  async setupPending(c: Context): Promise<boolean> {
    if (this.deps.config.auth.devLogin || (await this.claimed())) return false;
    return !hasSetupGrant(c, this.deps);
  }

  /** Whether this request comes from a signed-in account that has to claim the instance first. */
  async mustClaim(c: Context): Promise<boolean> {
    if (this.deps.config.auth.devLogin || this.claimedSeen) return false;
    if (await this.claimed()) return false;
    return (await loadSessionUser(c, this.deps, { readOnly: true })) !== null;
  }

  readonly middleware: MiddlewareHandler = async (c, next) => {
    if (signsIn(c.req.path) && (await this.setupPending(c))) {
      // Login buttons and provider callbacks are page loads: to the setup page, not JSON.
      if (c.req.method === 'GET') return c.redirect(`${this.deps.config.webOrigin}${SETUP_PAGE}`);
      throw new ApiError(
        403,
        'instance_unclaimed',
        'Diese Slider-Instanz ist noch nicht eingerichtet. Wer sie betreibt, gibt zuerst unter /einrichtung den Setup-Token aus dem Server-Log ein.',
      );
    }
    if (!isOpen(c.req.method, c.req.path) && (await this.mustClaim(c))) {
      throw new ApiError(
        403,
        'instance_unclaimed',
        'Diese Slider-Instanz hat noch keinen Admin. Gib zuerst den Setup-Token aus dem Server-Log ein.',
      );
    }
    await next();
  };
}

/** Remembers in this browser that it typed in the right setup token. */
export function grantSetup(c: Context, deps: Pick<AppDeps, 'config'>): void {
  const grant = setupGrant(deps.config.secret, deps.config.dataDir);
  if (!grant) return;
  writeCookie(c, deps.config, SETUP_GRANT_COOKIE, grant, {
    // Lax: the provider's redirect back to the callback is a cross-site page load.
    sameSite: 'Lax',
    maxAge: SETUP_GRANT_MAX_AGE_S,
  });
}

function hasSetupGrant(c: Context, deps: Pick<AppDeps, 'config'>): boolean {
  const given = readCookie(c, deps.config, SETUP_GRANT_COOKIE);
  return setupGrantMatches(deps.config.secret, deps.config.dataDir, given);
}

/** Starting, finishing or confirming a sign-in or sign-up – not the list of ways, not signing out. */
function signsIn(path: string): boolean {
  if (!path.startsWith(`${API_PREFIX}/auth/`)) return false;
  const route = path.slice(API_PREFIX.length);
  return route !== '/auth/providers' && route !== '/auth/logout';
}

/**
 * Reachable before the claim: signing in and out, who is signed in, the setup page, health, and
 * the privacy policy and imprint.
 */
function isOpen(method: string, path: string): boolean {
  if (!path.startsWith(`${API_PREFIX}/`)) return true;
  const route = path.slice(API_PREFIX.length);
  if (route.startsWith('/auth/')) return true;
  if (route === '/me' || route === '/legal') return method === 'GET';
  return route === '/setup' || route === '/setup/claim' || route === '/health';
}
