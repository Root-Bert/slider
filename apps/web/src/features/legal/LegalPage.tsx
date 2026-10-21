import { useLegalTexts } from '@/lib/api';
import { routes } from '@/lib/routes';
import { CenteredLayout } from '@/shell/layouts/CenteredLayout';
import { Button, ErrorText, LoadingState } from '@/ui';
import { LegalText } from './LegalText';

/** `/datenschutz` and `/impressum` (BER-141): the instance admin's text, readable without login. */
export function LegalPage({ kind }: { kind: 'privacy' | 'imprint' }) {
  const texts = useLegalTexts();
  const title = kind === 'privacy' ? 'Datenschutzerklärung' : 'Impressum';
  const text = texts.data?.[kind];
  return (
    <CenteredLayout
      docTitle={`${title} | Slider`}
      logoLink={{ to: routes.reviews(), label: 'Slider' }}
      wide
    >
      <article className="glass rounded-panel px-6 py-8 sm:px-10">
        {texts.isPending ? (
          <LoadingState padding="lg" size={28} />
        ) : texts.isLoadingError ? (
          // Not loaded is not "nothing there": an imprint must not look missing over a hiccup.
          <div className="flex flex-col items-start gap-3">
            <ErrorText role="alert">{texts.error.message}</ErrorText>
            <Button
              variant="secondary"
              size="sm"
              loading={texts.isFetching}
              onClick={() => void texts.refetch()}
            >
              Erneut versuchen
            </Button>
          </div>
        ) : text ? (
          <LegalText markdown={text} />
        ) : (
          <LegalText
            markdown={`# ${title}\n\nDer Betreiber dieser Slider-Instanz hat hier noch nichts hinterlegt.`}
          />
        )}
      </article>
    </CenteredLayout>
  );
}
