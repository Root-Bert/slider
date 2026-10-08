import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { InviteState, JoinPreview } from '@slider/shared';
import { routes } from '@/app/routes';
import { ApiError } from '@/lib/api-client';
import { useAuthProviders, useJoinWorkspace, useLogout } from '@/lib/workspace-queries';
import { Badge, Button, Icon, Spinner } from '@/ui';
import { LoginOptions } from '../../auth/components/LoginOptions';
import { ROLE_HINTS, ROLE_LABELS } from '../lib/roles';
import { WorkspaceMark } from './WorkspaceMark';

const CLOSED_COPY: Record<Exclude<InviteState, 'valid'>, { title: string; message: string }> = {
  expired: {
    title: 'Einladung abgelaufen',
    message:
      'Dieser Einladungslink gilt nicht mehr. Bitte die Person, die dich eingeladen hat, um einen neuen.',
  },
  revoked: {
    title: 'Einladung zurückgezogen',
    message:
      'Diese Einladung wurde zurückgezogen. Bitte um eine neue, falls du beitreten möchtest.',
  },
  used: {
    title: 'Einladung schon angenommen',
    message:
      'Diese Einladung wurde bereits verwendet. Bist du schon Mitglied, findest du die Organisation in deinen Reviews.',
  },
};

export function Invitation({
  token,
  preview,
  signedIn,
}: {
  token: string;
  preview: JoinPreview;
  signedIn: boolean;
}) {
  const role = <span className="font-medium text-fg">{ROLE_LABELS[preview.role]}</span>;
  const roleLine = preview.inviterName ? (
    <>
      {preview.inviterName} lädt dich als {role} ein.
    </>
  ) : (
    <>Du wirst als {role} eingeladen.</>
  );

  if (preview.state !== 'valid') {
    const copy = CLOSED_COPY[preview.state];
    return (
      <JoinCard
        icon={<WorkspaceMark name={preview.workspaceName} size={40} />}
        eyebrow={preview.workspaceName}
        title={copy.title}
        message={copy.message}
      >
        {signedIn && <BackLink />}
      </JoinCard>
    );
  }

  return (
    <JoinCard
      icon={<WorkspaceMark name={preview.workspaceName} size={40} />}
      eyebrow="Einladung"
      title={preview.workspaceName}
      message={roleLine}
    >
      <div className="flex w-full flex-col gap-2 rounded-control bg-white/5 px-4 py-3 text-left">
        <p className="flex items-center gap-2 text-[13px] text-fg">
          <Badge>{ROLE_LABELS[preview.role]}</Badge>
          {ROLE_HINTS[preview.role]}
        </p>
        {preview.email && (
          <p className="flex items-center gap-2 text-xs text-fg-subtle">
            <Icon name="at" size={16} className="shrink-0" />
            Gilt nur für {preview.email}
          </p>
        )}
      </div>
      {signedIn ? <JoinButton token={token} /> : <SignInToJoin token={token} />}
    </JoinCard>
  );
}

export function JoinButton({ token }: { token: string }) {
  const join = useJoinWorkspace(token);
  const logout = useLogout();
  const navigate = useNavigate();
  const full = join.error instanceof ApiError && join.error.code === 'plan_limit';
  const wrongAccount = join.error instanceof ApiError && join.error.status === 403 && !full;

  const switchAccount = () =>
    logout.mutate(undefined, {
      onSuccess: () => window.location.assign(routes.login(routes.join(token))),
    });

  return (
    <div className="flex w-full flex-col items-center gap-3">
      {full ? (
        // The plan's member limit (BER-130): nothing the joiner can fix themselves.
        <div
          role="alert"
          className="flex w-full items-start gap-2.5 rounded-control bg-warning/10 px-3 py-2.5 text-left"
        >
          <Icon name="warning" size={18} className="mt-px shrink-0 text-warning" />
          <span className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-fg">Organisation voll</span>
            <span className="text-[13px] leading-5 text-fg-muted">{join.error?.message}</span>
          </span>
        </div>
      ) : (
        join.error && (
          <p
            role="alert"
            className="flex w-full items-start gap-2 rounded-control bg-danger/10 px-3 py-2.5 text-left text-[13px] leading-5 text-fg"
          >
            <Icon name="error" size={18} className="mt-px shrink-0 text-danger" />
            {join.error.message}
          </p>
        )
      )}
      {wrongAccount ? (
        <Button size="lg" className="w-full" loading={logout.isPending} onClick={switchAccount}>
          Mit anderem Konto anmelden
        </Button>
      ) : (
        <Button
          size="lg"
          className="w-full"
          loading={join.isPending}
          onClick={() =>
            join.mutate(undefined, {
              onSuccess: ({ workspace }) => void navigate(routes.workspace(workspace.id)),
            })
          }
        >
          {full ? 'Erneut versuchen' : 'Beitreten'}
        </Button>
      )}
      {full && <BackLink />}
    </div>
  );
}

export function SignInToJoin({ token }: { token: string }) {
  const providers = useAuthProviders();
  return (
    <div className="flex w-full flex-col gap-3">
      <p className="text-[13px] text-fg-subtle">Melde dich an, um beizutreten.</p>
      {providers.isPending ? (
        <Spinner size={24} className="mx-auto text-fg-subtle" />
      ) : providers.isError ? (
        <p className="text-sm text-danger">{providers.error.message}</p>
      ) : (
        <LoginOptions config={providers.data} returnTo={routes.join(token)} />
      )}
    </div>
  );
}

export function JoinCard({
  icon,
  eyebrow,
  title,
  message,
  children,
}: {
  icon: ReactNode;
  eyebrow?: string;
  title: string;
  message: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section
      aria-labelledby="join-title"
      className="glass flex animate-fade-in flex-col items-center gap-6 rounded-panel px-6 pt-10 pb-8 text-center sm:px-10"
    >
      <span className="flex size-14 items-center justify-center rounded-panel bg-white/6 text-fg">
        {icon}
      </span>
      <div className="flex flex-col gap-2">
        {eyebrow && <p className="text-xs text-fg-subtle">{eyebrow}</p>}
        <h1 id="join-title" className="text-2xl leading-8 font-semibold break-words text-fg">
          {title}
        </h1>
        <p className="text-sm leading-5 text-fg-subtle">{message}</p>
      </div>
      {children}
    </section>
  );
}

export function BackLink() {
  return (
    <Link
      to={routes.reviews()}
      className="text-sm text-fg-muted underline underline-offset-4 hover:text-fg"
    >
      Zu meinen Reviews
    </Link>
  );
}
