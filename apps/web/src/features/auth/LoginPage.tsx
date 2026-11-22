import { Navigate, useSearchParams } from 'react-router';
import { useAuthProviders, useMe } from '@/lib/api';
import { CenteredLayout } from '@/shell/layouts/CenteredLayout';
import { Spinner, TextLink } from '@/ui';
import { appOfTarget, useCurrentApp, type AppId } from '@/lib/apps';
import { ConfirmMailBanner, LoginErrorBanner, SignupHint } from './components/LoginBits';
import { LoginHero } from './components/LoginHero';
import { LoginOptions } from './components/LoginOptions';
import { isLoginError, safeReturnTo } from './lib/return-to';

/**
 * The title over the login: the slogan of the app it leads to (the website's line for it);
 * Slider's and Sender's are their own, in English.
 */
const SLOGANS: Record<AppId, string> = {
  slider: 'Get your ideas across.',
  cloud: 'Dateien, die jeder wiederfindet.',
  writer: 'Dokumente, die ihr zusammen schreibt.',
  reader: 'Formulare, die ihr zusammen ausfüllt.',
  sender: 'Conversations that matter.',
};

/**
 * `/login?returnTo=…&error=…` – sign in with Microsoft, Google, Nextcloud, the configured SSO
 * provider or a passkey (BER-129). No card: the hero picture, the title and the buttons sit
 * straight on the dot grid, in a column a little narrower than the other standalone pages.
 * The first login creates the account (BER-130), so `/registrieren` is the same page: the
 * title is the slogan, below it one neutral sign-in line (not "sign in or sign up").
 */
export function Component() {
  return <AuthPage mode="login" />;
}

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const errorCode = searchParams.get('error');
  const me = useMe();
  const providers = useAuthProviders();
  // One account for every app: the page wears the one it leads to, else the one last open.
  const current = useCurrentApp();
  const app = appOfTarget(returnTo) ?? current;

  // „Weiteres Konto hinzufügen“ (`?add=1`): signed in, one more account on this browser.
  // The server's way back after a login refused or to confirm by mail carries no `add`: signed in
  // and sent here with something to say is still adding – else the reason would never show.
  const confirming = searchParams.get('confirm') === 'nextcloud';
  const adding =
    Boolean(me.data?.user) &&
    (searchParams.get('add') === '1' || isLoginError(errorCode) || confirming);
  // Already signed in (or the dev login is on): straight on.
  if (me.data?.user && !adding) return <Navigate to={returnTo} replace />;

  const joining = returnTo.startsWith('/join/');

  return (
    <CenteredLayout
      app={app}
      docTitle={mode === 'register' ? 'Konto erstellen | Slider' : 'Anmelden | Slider'}
    >
      <div className="mx-auto flex w-full max-w-[420px] flex-col gap-6">
        {isLoginError(errorCode) && <LoginErrorBanner code={errorCode} />}
        {confirming && <ConfirmMailBanner />}
        <section
          aria-labelledby="login-title"
          className="flex flex-col items-center gap-8 text-center"
        >
          <LoginHero className="w-full max-w-[320px]" />
          <div className="flex animate-rise-in flex-col gap-2">
            <h1
              id="login-title"
              className="text-2xl leading-8 font-semibold tracking-tight text-balance text-fg"
            >
              {adding ? 'Weiteres Konto hinzufügen' : SLOGANS[app]}
            </h1>
            <p className="text-sm leading-5 text-fg-subtle">
              {adding
                ? 'Melde dich mit einem anderen Konto an. Gewechselt wird dann über dein Bild oben rechts.'
                : joining
                  ? 'Melde dich an, um der Einladung zu folgen.'
                  : 'Melde dich bei deinem Konto an.'}
            </p>
          </div>
          {providers.isPending ? (
            <Spinner size={24} className="text-fg-subtle" />
          ) : providers.isError ? (
            <p className="text-sm text-danger">{providers.error.message}</p>
          ) : (
            <LoginOptions config={providers.data} returnTo={returnTo} />
          )}
        </section>
        {adding ? (
          <TextLink to={returnTo} variant="inline" className="self-center text-sm">
            Abbrechen
          </TextLink>
        ) : (
          providers.data && (
            <SignupHint signup={providers.data.signup} mode={mode} returnTo={returnTo} />
          )
        )}
      </div>
    </CenteredLayout>
  );
}
