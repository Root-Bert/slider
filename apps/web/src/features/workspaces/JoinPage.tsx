import { useParams } from 'react-router';
import { routes } from '@/lib/routes';
import { ApiError } from '@/lib/api-client';
import { useJoinPreview, useMe } from '@/lib/api';
import { CenteredCard, CenteredLayout } from '@/shell/layouts/CenteredLayout';
import { Icon, LoadingState } from '@/ui';
import { AccountMenu } from './components/AccountMenu';
import { Invitation, ReviewsLink } from './components/JoinParts';

/** `/join/:token` – preview of a workspace invitation; sign in, then join (BER-129). */
export function Component() {
  const { token = '' } = useParams();
  const preview = useJoinPreview(token);
  const me = useMe();
  const signedIn = Boolean(me.data?.user);

  return (
    <CenteredLayout
      docTitle="Einladung | Slider"
      logoLink={{ to: routes.reviews(), label: 'Slider' }}
      headerEnd={signedIn && <AccountMenu />}
    >
      {preview.isPending || me.isPending ? (
        <LoadingState padding="lg" size={28} />
      ) : preview.isError ? (
        <CenteredCard
          titleId="join-title"
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
          {signedIn && <ReviewsLink />}
        </CenteredCard>
      ) : (
        <Invitation token={token} preview={preview.data} signedIn={signedIn} />
      )}
    </CenteredLayout>
  );
}
