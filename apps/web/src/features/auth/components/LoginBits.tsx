import type { AuthProviders, LoginError } from '@slider/shared';
import { Notice, TextLink } from '@/ui';
import { loginErrorCopy, loginPath, signupHintCopy } from '../lib/return-to';

export function LoginErrorBanner({ code }: { code: LoginError }) {
  const copy = loginErrorCopy(code);
  return (
    <Notice tone="danger" variant="tinted" role="alert" animated title={copy.title}>
      {copy.message}
    </Notice>
  );
}

/** Below the login card: how accounts come about in this instance's `SIGNUP` mode (BER-130). */
export function SignupHint({
  signup,
  mode,
  returnTo,
}: {
  signup: AuthProviders['signup'];
  mode: 'login' | 'register';
  returnTo: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 text-center text-body leading-5 text-fg-subtle">
      <p>{signupHintCopy(signup)}</p>
      {mode === 'register' && (
        <p>
          Schon ein Konto?{' '}
          <TextLink to={loginPath(returnTo)} tone="muted" weight="medium">
            Anmelden
          </TextLink>
        </p>
      )}
    </div>
  );
}
