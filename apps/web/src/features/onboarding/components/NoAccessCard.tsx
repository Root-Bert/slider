import { useId } from 'react';
import { Button, Icon } from '@/ui';
import type { NoAccessInfo } from '../hooks/useLinkImport';

const SHARING_HELP_URL =
  'https://support.microsoft.com/de-de/office/dateien-oder-ordner-in-microsoft-365-freigeben-1fe37332-0f9a-4719-970e-d2578da4941c';

/** Figma A3 copy, two lines. */
const LOGIN_COPY = [
  'Die Präsentation ist nur für deine Organisation freigegeben.',
  'Melde dich mit deinem Microsoft-Konto an oder lade die Datei hoch.',
];

/** A3: the link points to a file only people in the owner's organisation may open. */
export function NoAccessCard({
  info,
  onUploadInstead,
}: {
  info: NoAccessInfo;
  onUploadInstead: () => void;
}) {
  const titleId = useId();
  const signIn = () => {
    if (info.loginUrl) window.location.assign(info.loginUrl);
  };

  return (
    <section
      aria-labelledby={titleId}
      className="glass flex animate-fade-in flex-col items-center gap-5 rounded-panel px-8 pt-10 pb-8 text-center"
    >
      <span className="flex size-14 items-center justify-center rounded-panel bg-white/6 text-fg">
        <Icon name="lock" size={24} />
      </span>
      <div className="flex flex-col gap-2">
        <h2 id={titleId} className="text-2xl leading-8 font-semibold text-fg">
          Wir können diesen Link nicht öffnen
        </h2>
        <p className="text-sm leading-5 text-fg-subtle">
          {info.kind === 'login'
            ? LOGIN_COPY.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))
            : info.message}
        </p>
      </div>
      <p className="glass inline-flex max-w-full items-center gap-1.5 rounded-chip py-1.5 pr-3 pl-2.5 text-xs text-fg-muted">
        <Icon name="lock" size={16} className="shrink-0" />
        <span className="truncate">{info.host} · Nur Personen in deiner Organisation</span>
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {info.kind === 'consent' ? (
          <Button variant="secondary" size="lg" onClick={signIn}>
            Erneut anmelden
          </Button>
        ) : info.loginUrl ? (
          <Button size="lg" onClick={signIn}>
            Mit Microsoft anmelden
          </Button>
        ) : (
          // Disabled buttons get no pointer events, so the explanation sits on a wrapper.
          <span title="Microsoft-Anmeldung ist nicht eingerichtet">
            <Button size="lg" disabled>
              Mit Microsoft anmelden
            </Button>
          </span>
        )}
        <Button variant="secondary" size="lg" onClick={onUploadInstead}>
          Stattdessen PPTX hochladen
        </Button>
      </div>
      <a
        href={SHARING_HELP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[13px] leading-[18px] font-medium text-fg-muted underline underline-offset-2 hover:text-fg"
      >
        Link-Freigabe ändern – so geht’s
        <Icon name="arrowForward" size={16} />
      </a>
    </section>
  );
}
