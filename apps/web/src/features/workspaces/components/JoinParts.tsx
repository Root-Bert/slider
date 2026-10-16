import { useNavigate } from 'react-router';
import type { InviteState, JoinPreview } from '@slider/shared';
import { routes } from '@/lib/routes';
import { ApiError } from '@/lib/api-client';
import { useAuthProviders, useJoinWorkspace, useLogout } from '@/lib/api';
import { CenteredCard } from '@/shell/layouts/CenteredLayout';
import { Badge, Button, Icon, Notice, Spinner, TextLink } from '@/ui';
import { LoginOptions } from '@/features/auth';
import { ROLE_HINTS, ROLE_LABELS } from '../lib/roles';
import { WorkspaceMark } from './WorkspaceMark';

/** Id of the join card's heading (`CenteredCard`), kept stable. */
const JOIN_TITLE_ID = 'join-title';

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
  const roleLine = preview.deck ? (
    <>
      {preview.inviterName ?? 'Jemand'} teilt „{preview.deck.title}“ mit dir. Du trittst der
      Organisation als {role} bei.
    </>
  ) : preview.inviterName ? (
    <>
      {preview.inviterName} lädt dich als {role} ein.
    </>
  ) : (
    <>Du wirst als {role} eingeladen.</>
  );

  if (preview.state !== 'valid') {
    const copy = CLOSED_COPY[preview.state];
    return (
      <CenteredCard
        titleId={JOIN_TITLE_ID}
        icon={
          <WorkspaceMark
            name={preview.workspaceName}
            logoUrl={preview.workspaceLogoUrl}
            size={40}
          />
        }
        eyebrow={preview.workspaceName}
        title={copy.title}
        message={copy.message}
      >
        {signedIn && <ReviewsLink />}
      </CenteredCard>
    );
  }

  return (
    <CenteredCard
      titleId={JOIN_TITLE_ID}
      icon={
        <WorkspaceMark name={preview.workspaceName} logoUrl={preview.workspaceLogoUrl} size={40} />
      }
      eyebrow="Einladung"
      title={preview.workspaceName}
      message={roleLine}
    >
      <div className="flex w-full flex-col gap-2 rounded-control bg-surface-1 px-4 py-3 text-left">
        <p className="flex items-center gap-2 text-body text-fg">
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
    </CenteredCard>
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
        <Notice
          tone="warning"
          variant="tinted"
          size="sm"
          role="alert"
          title="Organisation voll"
          className="w-full"
        >
          {join.error?.message}
        </Notice>
      ) : (
        join.error && (
          <Notice tone="danger" variant="tinted" size="sm" role="alert" className="w-full">
            {join.error.message}
          </Notice>
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
              onSuccess: ({ workspace, deckId }) =>
                void navigate(deckId ? routes.deck(deckId) : routes.workspace(workspace.id)),
            })
          }
        >
          {full ? 'Erneut versuchen' : 'Beitreten'}
        </Button>
      )}
      {full && <ReviewsLink />}
    </div>
  );
}

export function SignInToJoin({ token }: { token: string }) {
  const providers = useAuthProviders();
  return (
    <div className="flex w-full flex-col gap-3">
      <p className="text-body text-fg-subtle">Melde dich an, um beizutreten.</p>
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

/** "Zu meinen Reviews" below a join card. */
export function ReviewsLink() {
  return (
    <TextLink to={routes.reviews()} variant="underline" size="sm">
      Zu meinen Reviews
    </TextLink>
  );
}
