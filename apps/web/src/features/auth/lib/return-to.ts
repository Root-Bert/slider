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
      'Zu dieser E-Mail-Adresse gibt es schon ein Konto, das eine andere Anmeldung nutzt. Melde dich so an wie beim ersten Mal. Unter „Konto & Anmeldung“ kannst du danach weitere Wege verbinden, auch deine Nextcloud.',
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
  sso_unavailable: {
    title: 'Firmen-Login nicht verfügbar',
    message:
      'Der Firmen-Login dieser Organisation ist gerade nicht eingerichtet. Melde dich anders an oder frag die Admins deiner Organisation.',
  },
  sso_domain: {
    title: 'Adresse passt nicht',
    message:
      'Über diesen Firmen-Login kommen nur Adressen der Firmen-Domain der Organisation. Melde dich mit deiner Firmen-Adresse an.',
  },
  mail_unavailable: {
    title: 'Neues Konto gerade nicht möglich',
    message:
      'Für ein neues Konto über Nextcloud bestätigst du deine Adresse per Mail, und diese Slider-Instanz kann keine Mails senden. Melde dich anders an oder frag, wer Slider betreibt.',
  },
  rate_limited: {
    title: 'Zu viele Anmeldeversuche',
    message:
      'Zu viele Anmeldeversuche von hier – bitte versuch es in ein paar Minuten noch einmal.',
  },
  account_blocked: {
    title: 'Konto gesperrt',
    message:
      'Dieses Konto wurde von der Person gesperrt, die Slider hier betreibt. Wende dich an sie, wenn du glaubst, dass das ein Irrtum ist.',
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
    case 'company':
      return 'Noch kein Konto? Du brauchst eine Einladung – oder deine Firma nutzt Slider schon, dann meldest du dich einfach mit deiner Firmenadresse an.';
    case 'invite':
      return 'Noch kein Konto? Du brauchst eine Einladung – das Konto wird beim ersten Anmelden über den Einladungslink erstellt.';
  }
}
