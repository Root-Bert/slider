import { useParams } from 'react-router';
import { MailCompose } from './components/mail/MailCompose';
import { MailThreadView } from './components/mail/MailThreadView';
import { NEW_MAIL } from './lib/mail';

/** A mail conversation in Sender – or a new mail being written. */
export function Component() {
  const { threadId = '' } = useParams();
  if (threadId === NEW_MAIL) return <MailCompose />;
  return <MailThreadView key={threadId} threadId={threadId} />;
}
