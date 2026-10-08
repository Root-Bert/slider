import { Link } from 'react-router';
import type { AuthProviders, LoginError } from '@slider/shared';
import { Icon } from '@/ui';
import { loginErrorCopy, loginPath, signupHintCopy } from '../lib/return-to';

export function LoginErrorBanner({ code }: { code: LoginError }) {
  const copy = loginErrorCopy(code);
  return (
    <div
      role="alert"
      className="flex animate-fade-in items-start gap-3 rounded-panel bg-danger/10 px-4 py-3 text-left"
    >
      <Icon name="error" size={20} className="mt-0.5 shrink-0 text-danger" />
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium text-fg">{copy.title}</p>
        <p className="text-[13px] leading-5 text-fg-muted">{copy.message}</p>
      </div>
    </div>
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
    <div className="flex flex-col items-center gap-1 text-center text-[13px] leading-5 text-fg-subtle">
      <p>{signupHintCopy(signup)}</p>
      {mode === 'register' && (
        <p>
          Schon ein Konto?{' '}
          <Link to={loginPath(returnTo)} className="font-medium text-fg-muted hover:text-fg">
            Anmelden
          </Link>
        </p>
      )}
    </div>
  );
}
