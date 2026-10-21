import { useState, type ReactNode } from 'react';
import { routes } from '@/lib/routes';
import { CenteredCard, CenteredLayout } from '@/shell/layouts/CenteredLayout';
import { Button, ErrorText, TextLink } from '@/ui';

/**
 * The page a mailed link opens (login link, Nextcloud sign-up): what happens, and a button that
 * does it – never on opening, as mail scanners open links. A failure shows with the way back to
 * the login page.
 */
export function ConfirmLinkCard({
  docTitle,
  icon,
  title,
  message,
  label,
  confirm,
}: {
  docTitle: string;
  icon: ReactNode;
  title: string;
  message: string;
  label: string;
  /** Does it; stays busy when it resolves (the page is left). */
  confirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await confirm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Das hat nicht geklappt.');
      setBusy(false);
    }
  };

  return (
    <CenteredLayout docTitle={docTitle}>
      <CenteredCard icon={icon} title={title} message={message}>
        <div className="flex w-full flex-col gap-3">
          <Button size="lg" glow loading={busy} className="w-full" onClick={() => void run()}>
            {label}
          </Button>
          {error && (
            <ErrorText role="alert" size="xs">
              {error}{' '}
              <TextLink to={routes.login()} tone="muted">
                Zur Anmeldung
              </TextLink>
            </ErrorText>
          )}
        </div>
      </CenteredCard>
    </CenteredLayout>
  );
}
