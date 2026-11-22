import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { handCodeToDesktop, useMe } from '@/lib/api';
import { CenteredCard, CenteredLayout } from '@/shell/layouts/CenteredLayout';
import { routes } from '@/lib/routes';
import { APP_NAMES } from '@/lib/apps';
import { Button, ErrorText, Icon, TextLink } from '@/ui';

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
  // „Weiteres Konto hinzufügen“ in the app: the account goes to its pages, beside the others.
  const add = params.get('add') === '1';
  // `app=cloud` / `app=writer` / `app=reader` / `app=sender`: that app asked (`desktop/cloud`,
  // `desktop/writer`, `desktop/reader`, `desktop/sender`), the code goes to its scheme.
  const asked = params.get('app');
  const app =
    asked === 'cloud' || asked === 'writer' || asked === 'reader' || asked === 'sender'
      ? asked
      : 'slider';
  const name = APP_NAMES[app];
  const docTitle = `${name} Desktop | ${name}`;
  const { data: me } = useMe();
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!challenge || !state) {
    return (
      <CenteredLayout app={app} docTitle={docTitle}>
        <CenteredCard
          icon={<Icon name="desktopWindows" size={28} />}
          title="Dieser Link ist unvollständig"
          message={`Starte die Anmeldung in der ${name}-App noch einmal über „Anmelden“.`}
        />
      </CenteredLayout>
    );
  }

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const target = await handCodeToDesktop(challenge, state, app);
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
      <CenteredLayout app={app} docTitle={docTitle}>
        <CenteredCard
          icon={<Icon name="checkCircle" size={28} />}
          title="Zurück zur App"
          message={
            add
              ? `Das Konto ist jetzt in der ${name}-App. Du kannst dieses Fenster schließen.`
              : `Die ${name}-App ist jetzt angemeldet. Du kannst dieses Fenster schließen.`
          }
        >
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => window.location.assign(link)}
          >
            {name}-App öffnen
          </Button>
        </CenteredCard>
      </CenteredLayout>
    );
  }

  return (
    <CenteredLayout app={app} docTitle={docTitle}>
      <CenteredCard
        icon={<Icon name="desktopWindows" size={28} />}
        title={add ? `Konto zur ${name}-App hinzufügen` : `In der ${name}-App anmelden`}
        message={
          me?.user
            ? add
              ? `Das Konto ${me.user.name} (${me.user.email}) kommt in der App zu deinen anderen dazu.`
              : `Die App auf deinem Computer bekommt Zugriff auf das Konto ${me.user.name}.`
            : 'Die App auf deinem Computer bekommt Zugriff auf dein Konto.'
        }
      >
        <div className="flex w-full flex-col gap-3">
          <Button size="lg" glow loading={busy} className="w-full" onClick={() => void confirm()}>
            {add ? 'Dieses Konto hinzufügen' : 'In der App anmelden'}
          </Button>
          {/* Another account than the browser is on: signed in here first, then back. */}
          <TextLink
            to={routes.addAccount(`${window.location.pathname}${window.location.search}`)}
            reloadDocument
            variant="inline"
            className="self-center text-sm"
          >
            Anderes Konto verwenden
          </TextLink>
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
