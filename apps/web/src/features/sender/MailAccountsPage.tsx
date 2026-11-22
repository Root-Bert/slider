import { ButtonLink } from '@/ui';
import { MailAccounts, NewMailboxButton } from './components/mail/MailAccounts';
import { MenuButton } from './components/MenuButton';
import { useSender } from './hooks/useSender';
import { PAGE_HEADER, PAGE_TITLE } from './lib/title';

/** Sender's „Postfächer“: one's mailboxes in this workspace. */
export function Component() {
  const ui = useSender();
  return (
    <section aria-label="Postfächer" className="flex min-h-0 flex-1 flex-col gap-3">
      <header className={PAGE_HEADER}>
        <MenuButton />
        <h1 className={PAGE_TITLE}>Postfächer</h1>
        <ButtonLink to={ui.mailPath} variant="ghost" icon="mail" size="sm">
          Zur Mail
        </ButtonLink>
        <span className="ml-auto shrink-0">
          <NewMailboxButton />
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto pt-2 pb-6">
        <MailAccounts />
      </div>
    </section>
  );
}
