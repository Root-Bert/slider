import { useState } from 'react';
import { Button, cn, EmptyState } from '@/ui';
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
  // The widgets arranged, as on Cloud's „Zuletzt“.
  const [editing, setEditing] = useState(false);
  return (
    <section aria-label="Aktuell" className="flex min-h-0 flex-1 flex-col gap-3">
      <header className={PAGE_HEADER}>
        <MenuButton />
        <h1 className={PAGE_TITLE}>Aktuell</h1>
        {!ui.homeFailed && !editing && (
          <Button
            variant="ghost"
            icon="dashboard"
            className="ml-auto"
            onClick={() => setEditing(true)}
          >
            Anpassen
          </Button>
        )}
      </header>
      {ui.homeFailed ? (
        <div className="m-auto">
          <EmptyState
            title="Nachrichten nicht geladen"
            message="Prüfe die Verbindung und lade die Seite neu."
          />
        </div>
      ) : (
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto pt-2 pb-6',
            // Arranging, the widgets' „–“ stand 16px out at their corner: room for them.
            editing && '-mx-5 -mt-3 px-5 pt-5',
          )}
        >
          <Triage place="aktuell" editing={editing} onEdit={setEditing} />
        </div>
      )}
    </section>
  );
}
