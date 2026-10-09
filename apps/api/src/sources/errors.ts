import { ApiError } from '../http/errors';

// Errors every source adapter may throw; the web app reacts to the codes (A3 card).

export const LOGIN_REQUIRED_MESSAGE =
  'Die Präsentation ist nur für deine Organisation freigegeben. Melde dich mit deinem Microsoft-Konto an oder lade die Datei hoch.';

/** Where the web app sends the browser to sign in; it comes back to `/neu?link=…` and retries. */
export const microsoftLoginUrl = (link: string) =>
  `/api/auth/microsoft/login?returnTo=${encodeURIComponent(`/neu?link=${encodeURIComponent(link)}`)}`;

export const microsoftLoginRequired = (link: string) =>
  new ApiError(401, 'microsoft_login_required', LOGIN_REQUIRED_MESSAGE, {
    loginUrl: microsoftLoginUrl(link),
  });

export const MICROSOFT_LOGIN_MESSAGE =
  'Melde dich mit deinem Microsoft-Konto an, um Dateien aus OneDrive auszuwählen.';

/** Sign-in that comes back to `returnTo` (a web app path) instead of a pasted link. */
export const microsoftLoginRequiredAt = (returnTo: string) =>
  new ApiError(401, 'microsoft_login_required', MICROSOFT_LOGIN_MESSAGE, {
    loginUrl: `/api/auth/microsoft/login?returnTo=${encodeURIComponent(returnTo)}`,
  });

export const PICKER_CONSENT_REQUIRED_MESSAGE =
  'Bestätige einmal bei Microsoft, dass Slider deine OneDrive-Dateien zur Auswahl anzeigen darf.';

/** The one-time consent to the personal-account file picker; comes back to `returnTo`. */
export const microsoftPickerConsentRequired = (returnTo: string) =>
  new ApiError(401, 'microsoft_login_required', PICKER_CONSENT_REQUIRED_MESSAGE, {
    loginUrl: `/api/auth/microsoft/login?access=picker&returnTo=${encodeURIComponent(returnTo)}`,
  });

export const microsoftNotConfigured = () =>
  new ApiError(
    401,
    'microsoft_not_configured',
    'Die Microsoft-Anmeldung ist auf diesem Server nicht eingerichtet. Trage MS_CLIENT_ID und MS_CLIENT_SECRET (und optional MS_TENANT) in die .env im Projektordner ein und starte die API neu – oder lade die Datei als PPTX hoch.',
  );

export const microsoftConsentRequired = () =>
  new ApiError(
    403,
    'microsoft_consent_required',
    'Deine Organisation erlaubt Slider noch keinen Zugriff auf Dateien. Eine Administratorin oder ein Administrator muss Slider einmalig freigeben (Admin-Zustimmung). Bis dahin kannst du die Datei als PPTX hochladen.',
  );

export const sourceForbidden = (
  message = 'Dein Microsoft-Konto hat keinen Zugriff auf diese Datei.',
) => new ApiError(403, 'source_forbidden', message);

export const sourceNotFound = () =>
  new ApiError(
    404,
    'source_not_found',
    'Die Datei wurde nicht gefunden – der Link ist abgelaufen oder wurde gelöscht.',
  );

export const sourceUnreachable = (
  message = 'Der Link konnte gerade nicht geladen werden. Bitte versuche es gleich noch einmal.',
) => new ApiError(502, 'source_unreachable', message);

export const LINK_NOT_A_POWERPOINT_MESSAGE =
  'Unter diesem Link liegt keine PowerPoint-Datei (.pptx).';
