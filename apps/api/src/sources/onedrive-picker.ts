import type { FilePickerSession } from '@slider/shared';
import { MicrosoftAuthError } from '../auth/microsoft';
import { ApiError, badRequest } from '../http/errors';
import { silentLogger, type Logger } from '../logger';
import { microsoftLoginRequiredAt, sourceUnreachable } from './errors';
import type { GraphClient } from './microsoft-graph';
import type { SourceContext } from './source-adapter';

/**
 * Microsoft's OneDrive File Picker v8: a page Microsoft hosts, opened by the web app in a popup.
 * It shows the person's OneDrive with "Geteilt" (files others shared with them) – the supported
 * way now that Graph's `/me/drive/sharedWithMe` stops returning data (November 2026).
 *
 * The picker asks the host for tokens: SharePoint tokens (`https://{host}/.default`) for work
 * and school accounts, `OneDrive.ReadOnly` for personal ones – never the Graph tokens Slider
 * imports with. They are traded for the stored refresh token here, so the browser never needs
 * MSAL. Picked files come back as drive item ids and are imported through Graph as usual.
 */

const CONSUMER_PICKER_URL = 'https://onedrive.live.com/picker';
const CONSUMER_SCOPE = 'OneDrive.ReadOnly';
/**
 * `OneDrive.ReadOnly` exists only for personal accounts: asked at `common`, Microsoft resolves
 * it against Graph and answers AADSTS70011 ("not configured for this tenant").
 */
const CONSUMER_TENANT = 'consumers';
const GRAPH_RESOURCE = 'https://graph.microsoft.com';
const SHAREPOINT_SUFFIX = '.sharepoint.com';

/** Where the picker sends the person when Microsoft wants a new sign-in. */
const PICKER_RETURN_TO = '/neu';

export const PICKER_CONSENT_MESSAGE =
  'Für die OneDrive-Auswahl braucht Slider zusätzlich die SharePoint-Berechtigungen „MyFiles.Read“ und „AllSites.Read“. Eine Administratorin oder ein Administrator muss sie in der App-Registrierung ergänzen und freigeben. Bis dahin kannst du den Link der Datei einfügen.';

interface PickerTokens {
  getScopedToken(
    userId: string,
    scope: string,
    options?: { tenant?: string },
  ): Promise<string | null>;
}

function parseUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** The tenant part of `contoso-my.sharepoint.com` / `contoso.sharepoint.com`. */
function sharePointTenant(host: string): string | null {
  if (!host.endsWith(SHAREPOINT_SUFFIX)) return null;
  const name = host.slice(0, -SHAREPOINT_SUFFIX.length);
  if (!name || name.includes('.')) return null;
  return name.endsWith('-my') ? name.slice(0, -'-my'.length) : name;
}

export class OneDriveFilePicker {
  constructor(
    private readonly graph: GraphClient,
    private readonly tokens: PickerTokens,
    private readonly log: Logger = silentLogger,
  ) {}

  /** Which picker fits the signed-in Microsoft account, and where it lives. */
  async session(context: SourceContext): Promise<FilePickerSession> {
    const drive = await withPickerLogin(() =>
      this.graph.get<{ driveType?: string; webUrl?: string }>(
        'me/drive?$select=driveType,webUrl',
        context,
        '',
      ),
    );
    if (drive.driveType === 'personal') {
      return { account: 'personal', baseUrl: CONSUMER_PICKER_URL, pickerUrl: CONSUMER_PICKER_URL };
    }
    const origin = parseUrl(drive.webUrl);
    if (!origin || origin.protocol !== 'https:' || !sharePointTenant(origin.hostname)) {
      throw sourceUnreachable('Microsoft nennt für dein Konto keinen OneDrive-Speicherort.');
    }
    const baseUrl = origin.origin;
    return { account: 'business', baseUrl, pickerUrl: `${baseUrl}/_layouts/15/FilePicker.aspx` };
  }

  /**
   * A token for the resource the picker asks for. Only the account's own SharePoint tenant and
   * Graph are served – the endpoint never mints tokens for arbitrary hosts.
   */
  async token(context: SourceContext, resource: string): Promise<string> {
    const session = await this.session(context);
    if (session.account === 'personal') {
      return this.scoped(context, CONSUMER_SCOPE, CONSUMER_TENANT);
    }

    const url = parseUrl(resource);
    if (url?.origin === GRAPH_RESOURCE) {
      return withPickerLogin(() => this.graph.requireToken(context, ''));
    }
    const ownTenant = sharePointTenant(new URL(session.baseUrl).hostname);
    if (!url || url.protocol !== 'https:' || sharePointTenant(url.hostname) !== ownTenant) {
      throw badRequest('Unbekannte Ressource für die OneDrive-Auswahl.');
    }
    return this.scoped(context, `${url.origin}/.default`);
  }

  private async scoped(context: SourceContext, scope: string, tenant?: string): Promise<string> {
    let token: string | null;
    try {
      token = await this.tokens.getScopedToken(context.userId, scope, { tenant });
    } catch (error) {
      if (!(error instanceof MicrosoftAuthError)) throw error;
      this.log.warn(
        `OneDrive picker: Microsoft refused scope "${scope}" for user ${context.userId}: ${error.message}`,
      );
      if (error.kind === 'admin_consent') {
        throw new ApiError(403, 'microsoft_consent_required', PICKER_CONSENT_MESSAGE);
      }
      throw sourceUnreachable(
        `Microsoft gibt Slider keinen Zugriff für die OneDrive-Auswahl (${error.error}).`,
      );
    }
    if (!token) throw microsoftLoginRequiredAt(PICKER_RETURN_TO);
    return token;
  }
}

/**
 * Graph's login errors point back to a pasted link (`/neu?link=…`); for the picker there is
 * none, so the login returns to the start page instead.
 */
export async function withPickerLogin<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError && error.code === 'microsoft_login_required') {
      throw microsoftLoginRequiredAt(PICKER_RETURN_TO);
    }
    throw error;
  }
}
