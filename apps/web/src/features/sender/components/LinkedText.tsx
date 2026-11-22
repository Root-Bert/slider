import { useMemo, type MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import { useMailAccounts } from '@/lib/api';
import { draftFor, draftKeys, setDraft } from '@/lib/drafts';
import { linkify, shortUrl } from '@/lib/linkify';
import { useSender } from '../hooks/useSender';
import { NEW_MAIL } from '../lib/mail';

/** A link in written words: Slider's link colour, underlined softly, firmer on hover. */
const TEXT_LINK_CLASS =
  'text-info underline decoration-info/40 underline-offset-2 hover:decoration-info focus-visible:rounded-mark focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none';

/** A plain click – not one that asks for a new tab or a copy of the link. */
const plain = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * Written text with what can be opened in it as links (`linkify`): web addresses in a new tab
 * (a long one shortened to its host and the start of its path, the whole in its tooltip), phone
 * numbers to call (`tel:`), mail addresses to write to – here, in „Neue Mail“ with the address
 * in „An“, where the workspace has a mailbox (else, and with ⌘ or a middle click, `mailto:`).
 */
export function LinkedText({ text }: { text: string }) {
  const ui = useSender();
  const navigate = useNavigate();
  const mailboxes = useMailAccounts(ui.workspace.id).data ?? [];
  const parts = useMemo(() => linkify(text), [text]);
  const writeTo = (event: MouseEvent, address: string) => {
    if (mailboxes.length === 0 || !plain(event)) return;
    event.preventDefault();
    const key = draftKeys.newMail(ui.workspace.id);
    const kept = draftFor(key);
    const target = kept?.target?.kind === 'mail-new' ? kept.target : null;
    const others = (target?.to ?? '').split(/[\s,;]+/).filter(Boolean);
    const to = others.includes(address) ? others : [...others, address];
    setDraft(key, kept?.text ?? '', {
      kind: 'mail-new',
      workspaceId: ui.workspace.id,
      accountId: target?.accountId ?? '',
      to: to.join(', '),
      subject: target?.subject ?? '',
    });
    void navigate(ui.mailThreadPath(NEW_MAIL));
  };
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === 'text') return part.text;
        const shown = part.kind === 'url' ? shortUrl(part.text) : part.text;
        return (
          <a
            key={index}
            href={part.href}
            title={shown === part.text ? undefined : part.href}
            // A number reads whole: never broken between its groups.
            className={
              part.kind === 'phone' ? `${TEXT_LINK_CLASS} whitespace-nowrap` : TEXT_LINK_CLASS
            }
            {...(part.kind === 'url' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            onClick={
              part.kind === 'email'
                ? (event) => writeTo(event, part.href.replace(/^mailto:/i, ''))
                : undefined
            }
          >
            {shown}
          </a>
        );
      })}
    </>
  );
}
