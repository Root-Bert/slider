import { Navigate, useSearchParams } from 'react-router';
import { useMe } from '@/lib/queries';
import { useAuthProviders } from '@/lib/workspace-queries';
import { Logo, Spinner } from '@/ui';
import { LoginErrorBanner, SignupHint } from './components/LoginBits';
import { LoginOptions } from './components/LoginOptions';
import { isLoginError, safeReturnTo } from './lib/return-to';

/**
 * `/login?returnTo=…&error=…` – sign in with Microsoft, the configured SSO provider or a
 * magic link by e-mail (BER-129). Card layout after Figma A3 (92:2472).
 */
export function Component() {
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const errorCode = searchParams.get('error');
  const me = useMe();
  const providers = useAuthProviders();

  // Already signed in (or the dev login is on): straight on.
  if (me.data?.user) return <Navigate to={returnTo} replace />;

  const joining = returnTo.startsWith('/join/');

  return (
    <div className="dot-grid flex min-h-full flex-col">
      <title>Anmelden · Slider</title>
      <header className="flex h-[88px] shrink-0 items-center px-6 md:px-14">
        <Logo />
      </header>
      <main className="flex flex-1 justify-center px-4 pt-[clamp(8px,12vh,140px)] pb-16">
        <div className="flex w-full max-w-[440px] flex-col gap-4">
          {isLoginError(errorCode) && <LoginErrorBanner code={errorCode} />}
          <section
            aria-labelledby="login-title"
            className="glass flex animate-fade-in flex-col items-center gap-6 rounded-panel px-6 pt-10 pb-8 text-center sm:px-10"
          >
            <span className="flex size-14 items-center justify-center rounded-panel bg-white/6 text-fg">
              <Logo withText={false} />
            </span>
            <div className="flex flex-col gap-2">
              <h1 id="login-title" className="text-2xl leading-8 font-semibold text-fg">
                Bei Slider anmelden
              </h1>
              <p className="text-sm leading-5 text-fg-subtle">
                {joining
                  ? 'Melde dich an, um der Einladung zu folgen.'
                  : 'Folien teilen. Feedback direkt auf der Folie sammeln.'}
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
          {providers.data && <SignupHint signup={providers.data.signup} />}
        </div>
      </main>
    </div>
  );
}
