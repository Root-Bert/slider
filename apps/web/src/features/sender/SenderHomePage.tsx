import { EmptyState } from '@/ui';
import { MenuButton } from './components/MenuButton';
import { Triage } from './components/Triage';
import { useSender } from './hooks/useSender';
import { PAGE_HEADER, PAGE_TITLE } from './lib/title';

/**
 * Sender's start („Aktuell“, `nachrichten` itself): everything unread as a to-do list – mentions,
 * direct messages, requests, groups and areas, agents, mail, notices, newsletters, spam – what the
 * workspace's AI makes of each, and what to do with a whole group at once (`Triage`).
 */
export function Component() {
  const ui = useSender();
  return (
    <section aria-label="Aktuell" className="flex min-h-0 flex-1 flex-col gap-3">
      <header className={PAGE_HEADER}>
        <MenuButton />
        <h1 className={PAGE_TITLE}>Aktuell</h1>
      </header>
      {ui.homeFailed ? (
        <div className="m-auto">
          <EmptyState
            title="Nachrichten nicht geladen"
            message="Prüfe die Verbindung und lade die Seite neu."
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pt-2 pb-6">
          <Triage />
        </div>
      )}
    </section>
  );
}
