import { Navigate, useSearchParams } from 'react-router';
import { useAuthProviders, useMe } from '@/lib/api';
import { CenteredCard, CenteredLayout } from '@/shell/layouts/CenteredLayout';
import { Logo, Spinner } from '@/ui';
import { LoginErrorBanner, SignupHint } from './components/LoginBits';
import { LoginOptions } from './components/LoginOptions';
import { isLoginError, safeReturnTo } from './lib/return-to';

/**
 * `/login?returnTo=…&error=…` – sign in with Microsoft, Google, the configured SSO provider, a
 * passkey or e-mail (link or code) (BER-129). Card layout after Figma A3 (92:2472).
 * The first login creates the account (BER-130), so `/registrieren` is the same page.
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
      docTitle={mode === 'register' ? 'Konto erstellen · Slider' : 'Anmelden · Slider'}
    >
      {isLoginError(errorCode) && <LoginErrorBanner code={errorCode} />}
      <CenteredCard
        titleId="login-title"
        icon={<Logo withText={false} />}
        title={mode === 'register' ? 'Konto erstellen' : 'Anmelden oder Konto erstellen'}
        message={
          joining
            ? 'Melde dich an, um der Einladung zu folgen.'
            : 'Folien teilen. Feedback direkt auf der Folie sammeln.'
        }
      >
        {providers.isPending ? (
          <Spinner size={24} className="text-fg-subtle" />
        ) : providers.isError ? (
          <p className="text-sm text-danger">{providers.error.message}</p>
        ) : (
          <LoginOptions config={providers.data} returnTo={returnTo} />
        )}
      </CenteredCard>
      {providers.data && (
        <SignupHint signup={providers.data.signup} mode={mode} returnTo={returnTo} />
      )}
    </CenteredLayout>
  );
}
