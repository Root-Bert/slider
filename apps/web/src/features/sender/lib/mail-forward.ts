import type { MailMessage, MailPerson } from '@slider/shared';
import { formatDateTime } from '@/lib/format';

const person = (one: MailPerson) => (one.name ? `${one.name} <${one.address}>` : one.address);

/** „WG: …“ – once, as mail apps do (not „WG: WG: …“, nor over a „Fwd:“). */
export function forwardSubject(subject: string) {
  const bare = subject.trim();
  return /^(wg|fwd?|fw)\s*:/i.test(bare) ? bare : `WG: ${bare}`;
}

/**
 * A mail passed on, as its words in a new one: room to write on top, then who wrote it, when,
 * about what, to whom – and what it said.
 */
export function forwardedText(message: MailMessage, from: string) {
  const head = [
    '---------- Weitergeleitete Nachricht ----------',
    `Von: ${from}`,
    `Datum: ${formatDateTime(message.sentAt)}`,
    `Betreff: ${message.subject}`,
    message.to.length > 0 ? `An: ${message.to.map(person).join(', ')}` : null,
    message.cc.length > 0 ? `Cc: ${message.cc.map(person).join(', ')}` : null,
  ].filter((line) => line !== null);
  return `\n\n${head.join('\n')}\n\n${message.text}`;
}

export { person as mailPersonLine };
