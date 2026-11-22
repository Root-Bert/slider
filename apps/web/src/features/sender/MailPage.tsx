import { Outlet } from 'react-router';
import { ButtonLink, cn } from '@/ui';
import {
  MailBody,
  MailboxTabs,
  MailToolbar,
  UnreadFilter,
  MailSyncButton,
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
          <UnreadFilter view={view} />
          <MailSyncButton view={view} />
          <ButtonLink to={ui.mailAccountsPath} variant="ghost" icon="settings" size="sm">
            <span className="max-sm:sr-only">Postfächer</span>
          </ButtonLink>
        </div>
      </header>
      {/* Toolbar and list 20px apart as Cloud's page (`gap-5`): the list reaches up into that
          room (`MailBody`), its rows fade right under the toolbar, as a chat's messages do. */}
      <div className={cn('flex min-h-0 flex-1 flex-col gap-5', !view.account && 'pt-2')}>
        {view.account && <MailToolbar view={view} />}
        <MailBody view={view} />
      </div>
    </section>
  );
}
