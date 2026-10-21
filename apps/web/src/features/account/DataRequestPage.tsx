import { useState } from 'react';
import { useParams } from 'react-router';
import { formatDateTime } from '@/lib/format';
import {
  dataRequestExportUrl,
  useConfirmDataRequest,
  useDataRequest,
  useDataRequestSuccessors,
} from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { routes } from '@/lib/routes';
import { CenteredCard, CenteredLayout } from '@/shell/layouts/CenteredLayout';
import { Button, buttonClasses, ErrorText, Icon, TextLink, LoadingState } from '@/ui';
import { SuccessorPicker } from './components/SuccessorPicker';
import { successorsComplete } from './successors';
import { DELETION_RULES } from './deletion-rules';

/**
 * `/daten/:token` – the link of a data request mail (BER-146) or of a reminder for an unused
 * account (BER-147). It went to the address itself: opening it there downloads the copy, or –
 * by button, never on opening (mail scanners open links) – confirms the deletion or keeps the
 * account. No login.
 */
export function Component() {
  const { token = '' } = useParams();
  const request = useDataRequest(token);
  const confirm = useConfirmDataRequest();
  const [successors, setSuccessors] = useState<Record<string, string>>({});
  const choices = useDataRequestSuccessors(
    token,
    request.data?.purpose === 'delete' && request.data.hasAccount,
  );
  const deletionReady =
    !request.data?.hasAccount ||
    (choices.isSuccess && successorsComplete(choices.data, successors));

  return (
    <CenteredLayout
      docTitle="Deine Daten | Slider"
      logoLink={{ to: routes.reviews(), label: 'Slider' }}
    >
      {request.isPending ? (
        <LoadingState padding="lg" size={28} />
      ) : confirm.isSuccess && request.data ? (
        request.data.purpose === 'keep' ? (
          <CenteredCard
            icon={<Icon name="checkCircle" size={24} />}
            title="Dein Konto bleibt"
            message="Danke! Die Frist beginnt neu – du bekommst keine weiteren Erinnerungen, solange du Slider ab und zu nutzt."
          >
            <TextLink to={routes.login()}>Zu Slider</TextLink>
          </CenteredCard>
        ) : (
          <CenteredCard
            icon={<Icon name="checkCircle" size={24} />}
            title="Gelöscht"
            message={
              request.data.hasAccount
                ? `Das Slider-Konto von ${request.data.email} ist gelöscht.`
                : `Die Einladungen an ${request.data.email} sind gelöscht.`
            }
          />
        )
      ) : request.isError ? (
        <CenteredCard
          icon={<Icon name="link" size={24} />}
          title="Link nicht gültig"
          message={request.error.message}
        >
          <TextLink to={routes.dataRequestForm()}>Neuen Link anfordern</TextLink>
        </CenteredCard>
      ) : request.data.purpose === 'export' ? (
        <CenteredCard
          icon={<Icon name="description" size={24} />}
          eyebrow={request.data.email}
          title="Deine Daten herunterladen"
          message={`${
            request.data.hasAccount
              ? 'Alles, was Slider über dich speichert, als ZIP.'
              : 'Zu dieser Adresse gibt es kein Konto – gespeichert sind nur Einladungen. Du bekommst sie als ZIP.'
          } Der Link gilt bis ${formatDateTime(request.data.expiresAt)}.`}
        >
          <a href={dataRequestExportUrl(token)} download className={buttonClasses({ size: 'lg' })}>
            Daten herunterladen
          </a>
        </CenteredCard>
      ) : request.data.purpose === 'keep' ? (
        <CenteredCard
          icon={<Icon name="person" size={24} />}
          eyebrow={request.data.email}
          title="Konto behalten?"
          message="Dein Konto wurde länger nicht genutzt und soll deshalb gelöscht werden. Willst du es behalten, bestätige hier – die Frist beginnt dann neu."
        >
          <Button
            size="lg"
            loading={confirm.isPending}
            onClick={() => confirm.mutate({ token, action: 'keep' })}
          >
            Konto behalten
          </Button>
          {confirm.error && <ErrorText>{confirm.error.message}</ErrorText>}
        </CenteredCard>
      ) : (
        <CenteredCard
          icon={<Icon name="delete" size={24} />}
          eyebrow={request.data.email}
          title={request.data.hasAccount ? 'Konto endgültig löschen?' : 'Einladungen löschen?'}
          message={
            request.data.hasAccount
              ? `${DELETION_RULES} Das lässt sich nicht rückgängig machen.`
              : 'Zu dieser Adresse gibt es kein Konto, nur Einladungen in Organisationen. Sie werden gelöscht; wer dich eingeladen hat, sieht sie dann nicht mehr.'
          }
        >
          {choices.data && (
            <SuccessorPicker choices={choices.data} value={successors} onChange={setSuccessors} />
          )}
          {choices.isError && (
            <ErrorText>
              {choices.error.message}{' '}
              <button type="button" className="underline" onClick={() => void choices.refetch()}>
                Erneut versuchen
              </button>
            </ErrorText>
          )}
          <Button
            variant="danger"
            size="lg"
            loading={confirm.isPending}
            disabled={!deletionReady}
            onClick={() =>
              confirm.mutate(
                { token, action: 'delete', successors },
                {
                  // Another admin left meanwhile: that organisation now needs one chosen too.
                  onError: (error) => {
                    if (error instanceof ApiError && error.code === 'bad_request') {
                      void choices.refetch();
                    }
                  },
                },
              )
            }
          >
            Endgültig löschen
          </Button>
          {confirm.error && <ErrorText>{confirm.error.message}</ErrorText>}
        </CenteredCard>
      )}
    </CenteredLayout>
  );
}
