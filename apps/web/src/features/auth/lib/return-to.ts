import { LOGIN_ERRORS, type LoginError, type SignupMode } from '@slider/shared';

/** The URL half (safe `returnTo`, login links) is app-wide: `lib/routes` builds on it too. */
export { DEFAULT_RETURN_TO, loginPath, providerLoginUrl, safeReturnTo } from '@/lib/return-to';

export const isLoginError = (value: string | null): value is LoginError =>
  value !== null && (LOGIN_ERRORS as readonly string[]).includes(value);

/** Friendly explanations for `/login?error=<code>`. */
/** One Microsoft account connects to at most two Slider accounts (API: `MAX_ACCOUNTS_PER_MICROSOFT`). */
export const ACCOUNT_LIMIT_MESSAGE =
  'Dieses Microsoft-Konto ist schon mit zwei Slider-Konten verbunden. Trenne es dort oder nimm ein anderes Microsoft-Konto.';

const LOGIN_ERROR_COPY: Record<LoginError, { title: string; message: string }> = {
  signup_closed: {
    title: 'Kein Konto gefunden',
    message:
      'Für diese Adresse gibt es noch kein Slider-Konto, und auf diesem Server entstehen neue Konten nur über eine Einladung oder mit einer freigegebenen Firmenadresse. Bitte jemanden aus deiner Organisation, dich einzuladen.',
  },
  account_exists: {
    title: 'Konto meldet sich anders an',
    message:
      'Zu dieser E-Mail-Adresse gibt es schon ein Konto, das eine andere Anmeldung nutzt. Melde dich so an wie beim ersten Mal.',
  },
  no_email: {
    title: 'Keine E-Mail-Adresse erhalten',
    message:
      'Dein Anmeldedienst hat uns keine E-Mail-Adresse geschickt. Ohne sie können wir dich nicht anmelden – frag deinen Admin.',
  },
  email_unverified: {
    title: 'E-Mail-Adresse nicht bestätigt',
    message:
      'Dein Anmeldedienst meldet die E-Mail-Adresse als nicht bestätigt. Bestätige sie dort und versuche es erneut.',
  },
  admin_consent: {
    title: 'Freigabe durch Admin nötig',
    message:
      'Deine Organisation erlaubt die Anmeldung bei Slider noch nicht. Ein Microsoft-365-Admin muss die App einmal freigeben.',
  },
  denied: {
    title: 'Anmeldung abgebrochen',
    message: 'Die Anmeldung wurde abgebrochen oder nicht erlaubt. Versuche es erneut.',
  },
  account_limit: {
    title: 'Microsoft-Konto schon vergeben',
    message: ACCOUNT_LIMIT_MESSAGE,
  },
  failed: {
    title: 'Anmeldung fehlgeschlagen',
    message: 'Bei der Anmeldung ist etwas schiefgelaufen. Bitte versuche es erneut.',
  },
};

export const loginErrorCopy = (code: LoginError) => LOGIN_ERROR_COPY[code];

/** Under the login card: how an account comes about with this instance's `SIGNUP` (BER-130). */
export function signupHintCopy(signup: SignupMode): string {
  switch (signup) {
    case 'open':
      return 'Noch kein Konto? Es wird beim ersten Anmelden automatisch erstellt.';
    case 'domains':
      return 'Noch kein Konto? Es wird beim ersten Anmelden mit deiner Firmenadresse automatisch erstellt.';
    case 'invite':
      return 'Noch kein Konto? Du brauchst eine Einladung – das Konto wird beim ersten Anmelden über den Einladungslink erstellt.';
  }
}
