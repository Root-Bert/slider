import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import type { InviteState, JoinPreview } from '@slider/shared';
import { appHome, appStart, useBackApp, useCurrentApp } from '@/lib/apps';
import { routes } from '@/lib/routes';
import { ApiError } from '@/lib/api-client';
import { useAuthProviders, useJoinWorkspace, useMe, useOtherAccounts } from '@/lib/api';
import { CenteredCard } from '@/shell/layouts/CenteredLayout';
import { Badge, Button, Icon, Notice, Spinner, TextLink } from '@/ui';
import { LoginOptions } from '@/features/auth';
import { useAccountSwitch } from '../hooks/useAccountSwitch';
import { ROLE_HINTS, ROLE_LABELS } from '../lib/roles';
import { OtherAccounts } from './OtherAccounts';
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
      'Diese Einladung wurde bereits verwendet. Bist du schon Mitglied, findest du den Workspace bei den Präsentationen.',
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
      {preview.inviterName ?? 'Jemand'} teilt „{preview.deck.title}“ mit dir. Du trittst dem
      Workspace als {role} bei.
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
        {signedIn && <StartLink />}
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
      {signedIn ? (
        <JoinButton token={token} email={preview.email} auto />
      ) : (
        <SignInToJoin token={token} />
      )}
    </CenteredCard>
  );
}

/**
 * "Beitreten". `auto`: joins right away (BER-148) – whoever follows an invitation signed in, or
 * comes back from signing in through it, lands in the workspace without a question; the
 * button stays for errors (wrong account, workspace full).
 */
export function JoinButton({
  token,
  email = null,
  auto = false,
}: {
  token: string;
  /** The address the invitation is for; `null`: whoever has the link. */
  email?: string | null;
  auto?: boolean;
}) {
  const join = useJoinWorkspace(token);
  const navigate = useNavigate();
  // Into the workspace in the app last open, else in Cloud; an invitation to a deck opens it.
  const app = useCurrentApp();
  const user = useMe().data?.user;
  const others = useOtherAccounts(Boolean(user));
  const accounts = useAccountSwitch();
  const joinNow = () =>
    join.mutate(undefined, {
      onSuccess: ({ workspace, deckId }) =>
        void navigate(deckId ? routes.deck(deckId) : appHome(app, workspace.id).to),
    });
  // Several accounts on this browser, and the invitation is not for the one in use: which one
  // joins is asked, never guessed.
  const several = (others.data?.length ?? 0) > 0;
  const forThisAccount = email !== null && email.toLowerCase() === user?.email.toLowerCase();
  const asks = several && !forThisAccount;
  const started = useRef(false);
  useEffect(() => {
    // Once per page: after a failed join the button is there to try again.
    if (!auto || started.current || others.isPending || asks) return;
    started.current = true;
    joinNow();
  });
  const full = join.error instanceof ApiError && join.error.code === 'plan_limit';
  const wrongAccount = join.error instanceof ApiError && join.error.status === 403 && !full;
  const here = routes.join(token);

  return (
    <div className="flex w-full flex-col items-center gap-3">
      {full ? (
        // The plan's member limit (BER-130): nothing the joiner can fix themselves.
        <Notice
          tone="warning"
          variant="tinted"
          size="sm"
          role="alert"
          title="Workspace voll"
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
      {!wrongAccount && (
        <Button size="lg" className="w-full" loading={join.isPending} onClick={joinNow}>
          {full ? 'Erneut versuchen' : asks && user ? `Als ${user.email} beitreten` : 'Beitreten'}
        </Button>
      )}
      {/* The other accounts signed in here – for an invitation by address only its own. */}
      {(asks || wrongAccount) && (
        <OtherAccounts to={here} only={email} label={(other) => `Als ${other} beitreten`} />
      )}
      {wrongAccount && (
        <Button
          size="lg"
          variant="secondary"
          className="w-full"
          disabled={accounts.busy}
          onClick={() => accounts.addAccount(here)}
        >
          Mit anderem Konto anmelden
        </Button>
      )}
      {accounts.dialog}
      {full && <StartLink />}
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

/** Below a join card: to the app one came from – opened from a mail, the start page. */
export function StartLink() {
  const start = appStart(useBackApp());
  return (
    <TextLink to={start.to} variant="underline" size="sm">
      {start.label}
    </TextLink>
  );
}
