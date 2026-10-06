import { useId } from 'react';
import { Button, Icon } from '@/ui';
import type { NoAccessInfo } from '../hooks/useLinkImport';

const SHARING_HELP_URL =
  'https://support.microsoft.com/de-de/office/dateien-oder-ordner-in-microsoft-365-freigeben-1fe37332-0f9a-4719-970e-d2578da4941c';

/** A3: the link points to a file only people in the owner's organisation may open. */
export function NoAccessCard({
  info,
  onUploadInstead,
}: {
  info: NoAccessInfo;
  onUploadInstead: () => void;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="glass flex animate-fade-in flex-col items-center gap-4 rounded-panel px-6 py-8 text-center"
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-white/10 text-fg">
        <Icon name="lock" size={22} />
      </span>
      <div className="flex flex-col gap-2">
        <h2 id={titleId} className="text-lg font-semibold text-fg">
          Wir können diesen Link nicht öffnen
        </h2>
        <p className="text-[13px] text-fg-subtle">{info.message}</p>
      </div>
      <p className="glass inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-xs text-fg-muted">
        <Icon name="lock" size={14} className="shrink-0" />
        <span className="truncate">{info.host} · Nur Personen in deiner Organisation</span>
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {/* Microsoft sign-in (Graph delegated access) is not built yet. The tooltip sits on a
            wrapper because disabled buttons don't receive pointer events. */}
        <span title="Microsoft-Anmeldung folgt in Kürze">
          <Button size="sm" disabled>
            Mit Microsoft anmelden
          </Button>
        </span>
        <Button variant="secondary" size="sm" onClick={onUploadInstead}>
          Stattdessen PPTX hochladen
        </Button>
      </div>
      <a
        href={SHARING_HELP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-fg-subtle underline underline-offset-2 hover:text-fg"
      >
        Link-Freigabe ändern – so geht’s →
      </a>
    </section>
  );
}
