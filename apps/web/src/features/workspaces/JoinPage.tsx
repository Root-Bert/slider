import { Link, useParams } from 'react-router';
import { routes } from '@/app/routes';
import { ApiError } from '@/lib/api-client';
import { useMe } from '@/lib/queries';
import { useJoinPreview } from '@/lib/workspace-queries';
import { Icon, Logo, Spinner } from '@/ui';
import { AccountMenu } from './components/AccountMenu';
import { BackLink, Invitation, JoinCard } from './components/JoinParts';

/** `/join/:token` – preview of a workspace invitation; sign in, then join (BER-129). */
export function Component() {
  const { token = '' } = useParams();
  const preview = useJoinPreview(token);
  const me = useMe();
  const signedIn = Boolean(me.data?.user);

  return (
    <div className="dot-grid flex min-h-full flex-col">
      <title>Einladung · Slider</title>
      <header className="flex h-[88px] shrink-0 items-center justify-between px-6 md:px-14">
        <Link to={routes.reviews()} aria-label="Slider">
          <Logo />
        </Link>
        {signedIn && <AccountMenu />}
      </header>
      <main className="flex flex-1 justify-center px-4 pt-[clamp(8px,12vh,140px)] pb-16">
        <div className="flex w-full max-w-[440px] flex-col gap-4">
          {preview.isPending || me.isPending ? (
            <div className="flex justify-center py-16" aria-busy>
              <Spinner size={28} className="text-fg-subtle" />
            </div>
          ) : preview.isError ? (
            <JoinCard
              icon={<Icon name="link" size={24} />}
              title={
                preview.error instanceof ApiError && preview.error.status === 404
                  ? 'Einladung nicht gefunden'
                  : 'Das hat nicht geklappt'
              }
              message={
                preview.error instanceof ApiError && preview.error.status === 404
                  ? 'Dieser Link ist ungültig. Prüfe, ob er vollständig kopiert wurde.'
                  : preview.error.message
              }
            >
              {signedIn && <BackLink />}
            </JoinCard>
          ) : (
            <Invitation token={token} preview={preview.data} signedIn={signedIn} />
          )}
        </div>
      </main>
    </div>
  );
}
