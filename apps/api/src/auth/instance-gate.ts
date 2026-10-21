import type { Context, MiddlewareHandler } from 'hono';
import { API_PREFIX } from '@slider/shared';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';
import { instanceClaimed } from '../services/instance-settings';
import { loadSessionUser } from './session';

/**
 * Until the instance has an admin, every signed-in account must enter the setup token from the
 * server log first (`POST /setup/claim`) – the first one to do so becomes instance admin. Until
 * then the API answers `instance_unclaimed` (403) on everything but signing in and out, `GET /me`
 * and the setup page itself. Anyone may sign up meanwhile, whatever `SIGNUP` says
 * (`services/accounts`): nobody gets past this screen without the token.
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

  /** Whether this request comes from a signed-in account that has to claim the instance first. */
  async mustClaim(c: Context): Promise<boolean> {
    if (this.deps.config.auth.devLogin || this.claimedSeen) return false;
    if (await this.claimed()) return false;
    return (await loadSessionUser(c, this.deps, { readOnly: true })) !== null;
  }

  readonly middleware: MiddlewareHandler = async (c, next) => {
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
