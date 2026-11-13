import { Navigate, useSearchParams } from 'react-router';
import { useAuthProviders, useMe } from '@/lib/api';
import { CenteredLayout } from '@/shell/layouts/CenteredLayout';
import { Spinner } from '@/ui';
import { ConfirmMailBanner, LoginErrorBanner, SignupHint } from './components/LoginBits';
import { LoginHero } from './components/LoginHero';
import { LoginOptions } from './components/LoginOptions';
import { isLoginError, safeReturnTo } from './lib/return-to';

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

  // Already signed in (or the dev login is on): straight on.
  if (me.data?.user) return <Navigate to={returnTo} replace />;

  const joining = returnTo.startsWith('/join/');

  return (
    <CenteredLayout
      docTitle={mode === 'register' ? 'Konto erstellen | Slider' : 'Anmelden | Slider'}
    >
      <div className="mx-auto flex w-full max-w-[420px] flex-col gap-6">
        {isLoginError(errorCode) && <LoginErrorBanner code={errorCode} />}
        {searchParams.get('confirm') === 'nextcloud' && <ConfirmMailBanner />}
        <section
          aria-labelledby="login-title"
          className="flex flex-col items-center gap-8 text-center"
        >
          <LoginHero className="w-full max-w-[320px]" />
          <div className="flex animate-rise-in flex-col gap-2">
            <h1
              id="login-title"
              className="text-2xl leading-8 font-semibold tracking-tight text-fg"
            >
              Get your ideas across.
            </h1>
            <p className="text-sm leading-5 text-fg-subtle">
              {joining
                ? 'Melde dich an, um der Einladung zu folgen.'
                : 'Melde dich bei deinem Slider-Konto an.'}
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
        {providers.data && (
          <SignupHint signup={providers.data.signup} mode={mode} returnTo={returnTo} />
        )}
      </div>
    </CenteredLayout>
  );
}
