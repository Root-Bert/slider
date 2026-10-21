import { randomBytes } from 'node:crypto';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import {
  domainJoinAllowed,
  emailDomain,
  ssoDnsName,
  type UpdateWorkspaceSsoInput,
  type WorkspaceSso,
} from '@slider/shared';
import {
  hasSsoTxtRecord,
  ssoRedirectUri,
  ssoTxtValue,
  workspaceSsoClient,
} from '../../auth/workspace-sso';
import { workspaceSso, workspaces, type WorkspaceRow, type WorkspaceSsoRow } from '../../db/schema';
import type { AppDeps } from '../../deps';
import { badRequest } from '../../http/errors';
import { planLimit, ssoAvailable } from '../plans';
import { findDomainWorkspace, isCompanyMailDomain } from './domains';
import { requireRole, workspaceNotFound } from './roles';

/**
 * Company login per organisation (BER-162). Admins connect their OpenID Connect provider; it
 * works for addresses at the organisation's company domain (`join_domain`) once a DNS TXT record
 * proved that domain – a mailbox there (what opening the organisation to it takes) is not enough,
 * as the provider vouches for every address at the domain (`services/accounts`
 * `signInWithCompanySso`).
 */

type SsoDeps = Pick<AppDeps, 'db' | 'config' | 'clock' | 'log' | 'ssoNetwork'>;

const ADMIN_ONLY = 'Nur Admins können den Firmen-Login einrichten.';

async function workspaceRow(deps: Pick<AppDeps, 'db'>, workspaceId: string): Promise<WorkspaceRow> {
  const [row] = await deps.db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!row) throw workspaceNotFound();
  return row;
}

async function ssoRow(
  deps: Pick<AppDeps, 'db'>,
  workspaceId: string,
): Promise<WorkspaceSsoRow | null> {
  const [row] = await deps.db
    .select()
    .from(workspaceSso)
    .where(eq(workspaceSso.workspaceId, workspaceId));
  return row ?? null;
}

/** Whether people at the domain can sign in through it right now. */
function isActive(
  deps: Pick<AppDeps, 'config'>,
  workspace: WorkspaceRow,
  sso: WorkspaceSsoRow | null,
): sso is WorkspaceSsoRow {
  return (
    !!sso &&
    !!workspace.joinDomain &&
    sso.verifiedDomain === workspace.joinDomain &&
    domainJoinAllowed(deps.config.auth.signup) &&
    isCompanyMailDomain(workspace.joinDomain) &&
    ssoAvailable(deps.config, workspace.plan)
  );
}

function toWorkspaceSso(
  deps: Pick<AppDeps, 'config'>,
  workspace: WorkspaceRow,
  sso: WorkspaceSsoRow | null,
): WorkspaceSso {
  const domain = workspace.joinDomain;
  return {
    configured: !!sso,
    issuer: sso?.issuer ?? null,
    clientId: sso?.clientId ?? null,
    hasSecret: !!sso,
    redirectUri: ssoRedirectUri(deps.config),
    domain,
    dnsRecord:
      sso && domain ? { name: ssoDnsName(domain), value: ssoTxtValue(sso.verifyToken) } : null,
    verified: !!sso && !!domain && sso.verifiedDomain === domain,
    available: ssoAvailable(deps.config, workspace.plan),
    active: isActive(deps, workspace, sso),
  };
}

/** `GET /workspaces/:id/sso` (admins). */
export async function getWorkspaceSso(
  deps: SsoDeps,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceSso> {
  await requireRole(deps.db, workspaceId, userId, 'admin', ADMIN_ONLY);
  return toWorkspaceSso(
    deps,
    await workspaceRow(deps, workspaceId),
    await ssoRow(deps, workspaceId),
  );
}

/**
 * `PUT /workspaces/:id/sso` (admins): saves the provider after its discovery document answered.
 * A domain proven before stays proven – the provider may change, the domain's owner did not.
 */
export async function saveWorkspaceSso(
  deps: SsoDeps,
  userId: string,
  workspaceId: string,
  input: UpdateWorkspaceSsoInput,
): Promise<WorkspaceSso> {
  await requireRole(deps.db, workspaceId, userId, 'admin', ADMIN_ONLY);
  const workspace = await workspaceRow(deps, workspaceId);
  if (!ssoAvailable(deps.config, workspace.plan)) {
    throw planLimit('Den Firmen-Login gibt es im Paid-Plan.');
  }
  if (!workspace.joinDomain) {
    throw badRequest(
      'Öffne die Organisation zuerst für eure Firmen-Domain – der Firmen-Login gilt für die Adressen dort.',
    );
  }
  const existing = await ssoRow(deps, workspaceId);
  const clientSecret = input.clientSecret ?? existing?.clientSecret;
  if (!clientSecret) throw badRequest('Bitte das Client Secret angeben.');
  const issuer = input.issuer.replace(/\/+$/, '');
  const row = { issuer, clientId: input.clientId, clientSecret };
  try {
    // Discovery only: the issuer answers and names itself the same.
    await workspaceSsoClient(deps.config, row, deps.clock, deps.ssoNetwork).authorizeUrl({
      state: 'check',
      challenge: 'check',
      nonce: 'check',
    });
  } catch (error) {
    deps.log.info(`SSO discovery of ${issuer} failed`, error);
    throw badRequest(
      `Unter ${issuer}/.well-known/openid-configuration antwortet kein passender OpenID-Connect-Anbieter. Prüfe die Issuer-URL.`,
    );
  }
  const now = deps.clock.now();
  await deps.db
    .insert(workspaceSso)
    .values({
      workspaceId,
      ...row,
      verifyToken: randomBytes(18).toString('base64url'),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({ target: workspaceSso.workspaceId, set: { ...row, updatedAt: now } });
  return getWorkspaceSso(deps, userId, workspaceId);
}

/** `POST /workspaces/:id/sso/verify` (admins): looks for the TXT record of the current domain. */
export async function verifyWorkspaceSso(
  deps: SsoDeps,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceSso> {
  await requireRole(deps.db, workspaceId, userId, 'admin', ADMIN_ONLY);
  const workspace = await workspaceRow(deps, workspaceId);
  const sso = await ssoRow(deps, workspaceId);
  const domain = workspace.joinDomain;
  if (!sso || !domain) throw badRequest('Richte den Firmen-Login zuerst ein.');
  if (!(await hasSsoTxtRecord(deps.ssoNetwork ?? {}, domain, sso.verifyToken))) {
    throw badRequest(
      `Der TXT-Eintrag ${ssoDnsName(domain)} mit dem Wert ${ssoTxtValue(sso.verifyToken)} wurde (noch) nicht gefunden. Neue DNS-Einträge brauchen manchmal ein paar Minuten.`,
    );
  }
  const now = deps.clock.now();
  await deps.db
    .update(workspaceSso)
    .set({ verifiedDomain: domain, verifiedAt: now, updatedAt: now })
    .where(eq(workspaceSso.workspaceId, workspaceId));
  return getWorkspaceSso(deps, userId, workspaceId);
}

/** `DELETE /workspaces/:id/sso` (admins). Logins made through it stay, but no longer work. */
export async function deleteWorkspaceSso(
  deps: SsoDeps,
  userId: string,
  workspaceId: string,
): Promise<void> {
  await requireRole(deps.db, workspaceId, userId, 'admin', ADMIN_ONLY);
  await deps.db.delete(workspaceSso).where(eq(workspaceSso.workspaceId, workspaceId));
}

export interface ActiveSso {
  workspace: WorkspaceRow;
  sso: WorkspaceSsoRow;
}

/** The company login for an address: its domain's organisation, if that one has one active. */
export async function findSsoForEmail(deps: SsoDeps, email: string): Promise<ActiveSso | null> {
  const workspace = await findDomainWorkspace(deps, emailDomain(email.trim().toLowerCase()));
  if (!workspace) return null;
  const sso = await ssoRow(deps, workspace.id);
  return isActive(deps, workspace, sso) ? { workspace, sso } : null;
}

/** The organisation's company login, if active. */
export async function findSsoForWorkspace(
  deps: SsoDeps,
  workspaceId: string,
): Promise<ActiveSso | null> {
  // A blocked organisation (BER-167) has no company login, like it has no domain (`findDomainWorkspace`).
  const [workspace] = await deps.db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.blockedAt)));
  if (!workspace) return null;
  const sso = await ssoRow(deps, workspaceId);
  return isActive(deps, workspace, sso) ? { workspace, sso } : null;
}

/** Whether the login page offers "Mit Firmen-Login": some organisation proved its domain. */
export async function anyWorkspaceSso(deps: Pick<AppDeps, 'db' | 'config'>): Promise<boolean> {
  if (!domainJoinAllowed(deps.config.auth.signup)) return false;
  const [row] = await deps.db
    .select({ workspaceId: workspaceSso.workspaceId })
    .from(workspaceSso)
    .innerJoin(
      workspaces,
      and(
        eq(workspaces.id, workspaceSso.workspaceId),
        eq(workspaces.joinDomain, workspaceSso.verifiedDomain),
      ),
    )
    .where(isNotNull(workspaceSso.verifiedDomain))
    .limit(1);
  return !!row;
}
