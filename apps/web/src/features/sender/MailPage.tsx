import { useState } from 'react';
import { Outlet } from 'react-router';
import { Button, ButtonLink, cn } from '@/ui';
import {
  MailBody,
  MailboxTabs,
  MailToolbar,
  showsOverview,
  UnreadFilter,
} from './components/mail/MailView';
import { useMailView } from './hooks/useMailView';
import { MenuButton } from './components/MenuButton';
import { useSender } from './hooks/useSender';
import { PAGE_HEADER, PAGE_TITLE } from './lib/title';

/**
 * Sender's „Post“: one's mailboxes as the title, „Neue Mail“ and the open one's folders under it,
 * its mail conversations without a colleague on them below – wide, an opened one beside the list;
 * narrow, it takes the page.
 */
export function Component() {
  const ui = useSender();
  const view = useMailView();
  // The overview's widgets arranged, as on Cloud's „Zuletzt“.
  const [editing, setEditing] = useState(false);
  // Gone to a folder, a search or another mailbox, the arranging ends – it does not come back with
  // „Übersicht“ (another mailbox's board is drawn anew, measured as the page is, not arranged).
  const mailbox = view.all ? 'alle' : (view.account?.id ?? null);
  const [arrangedIn, setArrangedIn] = useState(mailbox);
  if (arrangedIn !== mailbox) {
    setArrangedIn(mailbox);
    if (editing) setEditing(false);
  }
  if (editing && !showsOverview(view)) setEditing(false);
  const arranging = editing && showsOverview(view);
  if (view.threadId && !view.wide) return <Outlet />;
  return (
    <section aria-label="Post" className="flex min-h-0 flex-1 flex-col gap-3">
      <header className={PAGE_HEADER}>
        <MenuButton />
        <h1 className={cn(PAGE_TITLE, 'flex')}>
          <MailboxTabs view={view} />
        </h1>
        {/* „Ungelesen“ beside „Postfächer“: on or off, for every mailbox. */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {showsOverview(view) && !arranging && (
            <Button variant="ghost" icon="dashboard" size="sm" onClick={() => setEditing(true)}>
              <span className="max-sm:sr-only">Anpassen</span>
            </Button>
          )}
          <UnreadFilter view={view} />
          <ButtonLink to={ui.mailAccountsPath} variant="ghost" icon="settings" size="sm">
            <span className="max-sm:sr-only">Postfächer</span>
          </ButtonLink>
        </div>
      </header>
      {/* Toolbar and list 20px apart as Cloud's page (`gap-5`): the list reaches up into that
          room (`MailBody`), its rows fade right under the toolbar, as a chat's messages do. */}
      <div
        className={cn('flex min-h-0 flex-1 flex-col gap-5', !view.account && !view.all && 'pt-2')}
      >
        {(view.account || view.all) && <MailToolbar view={view} />}
        <MailBody view={view} editing={arranging} onEdit={setEditing} />
      </div>
    </section>
  );
}
