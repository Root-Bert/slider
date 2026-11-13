import { isNotNull, notInArray } from 'drizzle-orm';
import { decryptToken } from '../auth/token-crypto';
import type { Executor } from '../db/client';
import { googleConnections, microsoftConnections } from '../db/schema';
import type { Logger } from '../logger';

/*
 * Google Drive and OneDrive/SharePoint are gone (files come from Nextcloud, a link or an upload;
 * Google and Microsoft only sign in). Their connections held refresh tokens with access to
 * people's files: at start each Google grant is revoked at Google, then every row of both is
 * deleted – decks pointing at one let go of it (`set null`). Microsoft has no call that revokes a
 * single refresh token: deleted here, it is never used again and runs out on its own (90 days);
 * people remove Slider from their Microsoft account themselves. A Google grant Google could not be
 * asked about (offline at start) stays for the next start. Once both are empty: nothing to do.
 */

const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_PURPOSE = 'google-refresh-token';

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export async function retireFileConnections(deps: {
  db: Executor;
  secret: string;
  log: Logger;
  fetch?: Fetch;
}): Promise<void> {
  const fetchImpl = deps.fetch ?? fetch;
  const grants = await deps.db
    .select({ id: googleConnections.id, refreshToken: googleConnections.refreshToken })
    .from(googleConnections)
    .where(isNotNull(googleConnections.refreshToken));
  let revoked = 0;
  /** Google could not be asked (offline, an error there): kept for the next start. */
  const retry: string[] = [];
  for (const grant of grants) {
    let token: string;
    try {
      token = await decryptToken(deps.secret, grant.refreshToken!, GOOGLE_PURPOSE);
    } catch (error) {
      // Unreadable (another secret): it can never be used or revoked – deleted.
      deps.log.warn(`Could not read a Google grant (connection ${grant.id})`, error);
      continue;
    }
    try {
      const response = await fetchImpl(GOOGLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(15_000),
      });
      await response.body?.cancel();
      // 400 `invalid_token`: revoked or expired already.
      if (response.ok || response.status === 400) revoked += 1;
      else retry.push(grant.id);
    } catch (error) {
      deps.log.warn(`Could not revoke a Google grant (connection ${grant.id})`, error);
      retry.push(grant.id);
    }
  }
  const google = await deps.db
    .delete(googleConnections)
    .where(retry.length > 0 ? notInArray(googleConnections.id, retry) : undefined)
    .returning({ id: googleConnections.id });
  const microsoft = await deps.db
    .delete(microsoftConnections)
    .returning({ id: microsoftConnections.id });
  if (google.length + microsoft.length > 0) {
    deps.log.info(
      `Retired file connections: ${google.length} Google (${revoked} revoked), ${microsoft.length} Microsoft`,
    );
  }
}
