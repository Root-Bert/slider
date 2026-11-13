import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { handCodeToDesktop, useMe } from '@/lib/api';
import { CenteredCard, CenteredLayout } from '@/shell/layouts/CenteredLayout';
import { Button, ErrorText, Icon } from '@/ui';

/**
 * `/desktop-anmelden?challenge=…&state=…` – „Anmelden“ in the desktop app opens it in the
 * browser (BER-201). Signed in (the account gate sees to that), one click hands the app a
 * one-time code through `slider://auth`; never on opening, so no page can sign an app in
 * unasked.
 */
export function Component() {
  const [params] = useSearchParams();
  const challenge = params.get('challenge') ?? '';
  const state = params.get('state') ?? '';
  const { data: me } = useMe();
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!challenge || !state) {
    return (
      <CenteredLayout docTitle="Slider Desktop | Slider">
        <CenteredCard
          icon={<Icon name="desktopWindows" size={28} />}
          title="Dieser Link ist unvollständig"
          message="Starte die Anmeldung in der Slider-App noch einmal über „Anmelden“."
        />
      </CenteredLayout>
    );
  }

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const target = await handCodeToDesktop(challenge, state);
      setLink(target);
      window.location.assign(target);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };

  if (link) {
    return (
      <CenteredLayout docTitle="Slider Desktop | Slider">
        <CenteredCard
          icon={<Icon name="checkCircle" size={28} />}
          title="Zurück zur App"
          message="Die Slider-App ist jetzt angemeldet. Du kannst dieses Fenster schließen."
        >
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => window.location.assign(link)}
          >
            Slider-App öffnen
          </Button>
        </CenteredCard>
      </CenteredLayout>
    );
  }

  return (
    <CenteredLayout docTitle="Slider Desktop | Slider">
      <CenteredCard
        icon={<Icon name="desktopWindows" size={28} />}
        title="In der Slider-App anmelden"
        message={
          me?.user
            ? `Die App auf deinem Computer bekommt Zugriff auf das Konto ${me.user.name}.`
            : 'Die App auf deinem Computer bekommt Zugriff auf dein Konto.'
        }
      >
        <div className="flex w-full flex-col gap-3">
          <Button size="lg" glow loading={busy} className="w-full" onClick={() => void confirm()}>
            In der App anmelden
          </Button>
          {error && (
            <ErrorText role="alert" size="xs">
              {error}
            </ErrorText>
          )}
        </div>
      </CenteredCard>
    </CenteredLayout>
  );
}
