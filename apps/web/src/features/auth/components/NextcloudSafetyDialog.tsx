import type { ReactNode } from 'react';
import { Button, Dialog, Icon, type IconName } from '@/ui';

/**
 * "Mehr erfahren" behind the short warning of the any-Nextcloud sign-in: Login Flow v2 can't tell
 * who confirms, so a request someone forwards signs its sender in. What to check, what never to
 * confirm, and what to do if it happened – in that order, each at a glance.
 */
export function NextcloudSafetyDialog({
  open,
  onClose,
  linking = false,
}: {
  open: boolean;
  onClose: () => void;
  /** Linking from /konto: Nextcloud names the account asking instead of showing a code. */
  linking?: boolean;
}) {
  const slider = `Slider (${window.location.host})`;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Sicher mit Nextcloud anmelden"
      description="Gleich öffnet sich deine Nextcloud und fragt, ob Slider zugreifen darf. Darauf kommt es an:"
      footer={
        <Button className="w-full" onClick={onClose}>
          Verstanden
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Part icon="checkCircleOutline" tone="text-success" title="So ist es richtig">
          <li>Du hast die Anmeldung hier in Slider selbst gestartet.</li>
          <li>
            {linking
              ? `Nextcloud zeigt „${slider} für …“ mit deiner eigenen Slider-Adresse.`
              : `Nextcloud zeigt „${slider} | Code …“ mit genau dem Code, den dir Slider anzeigt.`}
          </li>
          <li>Du bestätigst innerhalb von 5 Minuten.</li>
        </Part>
        <Part icon="warning" tone="text-danger" title="Niemals bestätigen, wenn …">
          <li>
            dir jemand einen Nextcloud-Link schickt (Mail, Chat, Telefon) und um Bestätigung bittet.
            Wer ihn geschickt hat, wäre danach in deinem Slider-Konto.
          </li>
          <li>
            {linking
              ? 'dort eine andere Adresse als deine steht.'
              : 'der Code fehlt oder nicht übereinstimmt.'}
          </li>
        </Part>
        <Part icon="lock" tone="text-fg-muted" title="Was Slider damit darf">
          <li>Dich anmelden und Präsentationen aus deiner Nextcloud einfügen.</li>
          <li>Slider ändert in deiner Nextcloud nichts.</li>
          <li>
            Widerrufen kannst du den Zugriff jederzeit in Nextcloud unter Einstellungen →
            Sicherheit.
          </li>
        </Part>
        <Part icon="error" tone="text-warning" title="Versehentlich bestätigt?">
          <li>
            Widerrufe in Nextcloud unter Einstellungen → Sicherheit den Eintrag „{slider}“, trenne
            die Nextcloud in Slider unter „Konto &amp; Anmeldung“ und sag dem Betreiber dieser
            Slider-Instanz Bescheid.
          </li>
        </Part>
      </div>
    </Dialog>
  );
}

function Part({
  icon,
  tone,
  title,
  children,
}: {
  icon: IconName;
  tone: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex gap-3">
      <Icon name={icon} size={20} className={tone} />
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <ul className="flex list-disc flex-col gap-1 pl-4 text-body leading-5 text-fg-muted">
          {children}
        </ul>
      </div>
    </section>
  );
}
