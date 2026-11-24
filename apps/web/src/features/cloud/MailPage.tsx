import { Outlet } from 'react-router';
import {
  MailBody,
  MailboxTabs,
  MailSyncButton,
  MailToolbar,
  UnreadFilter,
  useMailView,
} from '@/features/sender';
import { routes } from '@/lib/routes';
import { ButtonLink } from '@/ui';
import { CloudPage } from './components/CloudPage';
import { useCloud } from './hooks/useCloud';

/**
 * Cloud's „Post“, as in Sender: the mailboxes as the title, the open one's folders, its mail
 * conversations without a colleague on them – wide, an opened one beside the list.
 */
export function Component() {
  const ui = useCloud();
  const view = useMailView();
  if (view.threadId && !view.wide) return <Outlet />;
  return (
    <CloudPage
      docTitle="Post"
      title={<MailboxTabs view={view} />}
      crumbs={[{ label: 'Post' }]}
      // „Ungelesen“ beside „Postfächer“, as in Sender: on or off, for every mailbox.
      actions={
        <div className="flex items-center gap-2">
          <UnreadFilter view={view} />
          <MailSyncButton view={view} />
          <ButtonLink
            to={routes.cloudMailAccounts(ui.workspace.id)}
            variant="ghost"
            icon="settings"
            size="sm"
          >
            Postfächer
          </ButtonLink>
        </div>
      }
      toolbar={view.account ? <MailToolbar view={view} /> : undefined}
      nodes={[]}
      // The list scrolls in itself, as in Sender – its rows roll away under the folders.
      fill
    >
      {() => <MailBody view={view} />}
    </CloudPage>
  );
}
