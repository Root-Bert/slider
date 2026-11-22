import { useMemo, type ReactNode } from 'react';
import { MENTION_NOT_AFTER, type AccountAuthor } from '@slider/shared';
import { cn } from '@/ui';
import { LinkedText } from './LinkedText';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The pattern of @ with someone's name; addresses, mails and phones are `LinkedText`'s. */
function patternFor(people: readonly AccountAuthor[]): RegExp | null {
  const names = [
    ...new Set(people.flatMap((person) => [person.name, person.name.split(/\s+/)[0] ?? ''])),
  ]
    .filter((name) => name.length > 1)
    .sort((a, b) => b.length - a.length)
    .map(escape);
  if (names.length === 0) return null;
  // Not in a mail address („info@anna.de“): the same rule as `mentionsIn`.
  return new RegExp(`(?<![${MENTION_NOT_AFTER}])@(?:${names.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

/** Whether `@name` means the person: their full name or first name. */
const means = (token: string, person: AccountAuthor) => {
  const name = token.slice(1).toLocaleLowerCase('de');
  const full = person.name.toLocaleLowerCase('de');
  return name === full || name === full.split(/\s+/)[0];
};

/**
 * A message's text as written – lines kept, web addresses, mails and phone numbers as links
 * (`LinkedText`), @-names marked (one's own more strongly).
 */
export function MessageText({
  text,
  people,
  me,
}: {
  text: string;
  people: readonly AccountAuthor[];
  me: AccountAuthor;
}) {
  const pattern = useMemo(() => patternFor(people), [people]);
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of pattern ? text.matchAll(pattern) : []) {
    const token = match[0];
    const index = match.index;
    if (index > at) parts.push(<LinkedText key={`t${at}`} text={text.slice(at, index)} />);
    const mine = means(token, me);
    parts.push(
      <span
        key={index}
        className={cn(
          'rounded-mark font-medium',
          mine ? 'bg-warning/15 px-0.5 text-warning' : 'text-info',
        )}
      >
        {token}
      </span>,
    );
    at = index + token.length;
  }
  if (at < text.length) parts.push(<LinkedText key={`t${at}`} text={text.slice(at)} />);
  return <>{parts}</>;
}
