import type { AuthProviders, LoginError } from '@slider/shared';
import { useLegalTexts } from '@/lib/api';
import { routes } from '@/lib/routes';
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
    <div className="flex animate-fade-in flex-col items-center gap-1 px-2 text-center text-xs leading-4.5 text-balance text-fg-subtle">
      <p>{signupHintCopy(signup)}</p>
      {mode === 'register' && (
        <p>
          Schon ein Konto?{' '}
          <TextLink to={loginPath(returnTo)} tone="muted" weight="medium">
            Anmelden
          </TextLink>
        </p>
      )}
      <PrivacyNote />
      <p className="mt-3">
        <TextLink to={routes.dataRequestForm()}>
          Kein Zugang mehr? Daten anfragen oder löschen
        </TextLink>
      </p>
    </div>
  );
}

/** Signing in creates the account (BER-130), so the privacy policy applies from here (BER-141). */
function PrivacyNote() {
  const privacy = useLegalTexts().data?.privacy;
  if (!privacy) return null;
  return (
    <p className="mt-2">
      Mit der Anmeldung gilt die{' '}
      <TextLink to={routes.privacy()} tone="muted">
        Datenschutzerklärung
      </TextLink>
      .
    </p>
  );
}
