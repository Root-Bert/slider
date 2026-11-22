import { useParams } from 'react-router';
import { MailCompose, MailThreadView, NEW_MAIL, useMailSplit } from '@/features/sender';

/**
 * A mail conversation in Cloud – or a new mail being written –, beside the list, or as high as
 * the window leaves under the app's header.
 */
export function Component() {
  const { threadId = '' } = useParams();
  const split = useMailSplit();
  const view =
    threadId === NEW_MAIL ? <MailCompose /> : <MailThreadView key={threadId} threadId={threadId} />;
  if (split) return view;
  return <div className="flex h-[calc(100dvh-104px)] flex-col pb-6">{view}</div>;
}
