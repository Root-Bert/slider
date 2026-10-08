import type { AuthProviders, LoginError } from '@slider/shared';
import { Icon } from '@/ui';
import { loginErrorCopy } from '../lib/return-to';

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

export function SignupHint({ signup }: { signup: AuthProviders['signup'] }) {
  if (signup === 'open') return null;
  return (
    <p className="text-center text-[13px] text-fg-subtle">
      {signup === 'invite'
        ? 'Neu hier? Du brauchst eine Einladung.'
        : 'Neu hier? Melde dich mit deiner Firmenadresse an.'}
    </p>
  );
}
