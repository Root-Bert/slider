/** Addresses typed into a mail's fields, and when a mail in the outbox goes. */
import type { MailPerson } from '@slider/shared';

/** An address as a mail server takes it: something @ a domain with a dot, no spaces. */
export const MAIL_ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

/** The addresses in what was typed or pasted – by comma, semicolon, space, `Name <a@b.de>`. */
export function addressesIn(typed: string): string[] {
  // Pasted from a mail („Eva Berg <eva@firma.de>, …“): the addresses in it, the names aside.
  const found = typed.match(/[^\s@,;<>"'()]+@[^\s@,;<>"'()]+/g);
  return found ?? typed.split(/[\s,;]+/).filter(Boolean);
}

const clock = new Intl.DateTimeFormat('de-DE', { timeStyle: 'short' });

/** „in 8 Sek.“ while under a minute and a half, else „um 14:32“. */
export function whenItGoes(at: string, now: number) {
  const left = Math.ceil((Date.parse(at) - now) / 1000);
  if (left <= 0) return 'gleich';
  if (left < 90) return `in ${left} Sek.`;
  return `um ${clock.format(new Date(at))}`;
}

/** Offered at most at once. */
const SHOWN = 6;

/**
 * Those of the book the typed letters fit, the best first: an address or a word of the name
 * starting so, then one holding them – none already in the field.
 */
export function addressesFitting(
  book: readonly MailPerson[],
  typed: string,
  taken: readonly string[],
): MailPerson[] {
  const wanted = typed.trim().toLowerCase();
  if (!wanted) return [];
  const have = new Set(taken.map((one) => one.toLowerCase()));
  const starts: MailPerson[] = [];
  const holds: MailPerson[] = [];
  for (const person of book) {
    const address = person.address.toLowerCase();
    if (have.has(address)) continue;
    const name = person.name.toLowerCase();
    const words = [address, ...address.split(/[@.]/), name, ...name.split(/\s+/)];
    if (words.some((word) => word.startsWith(wanted))) starts.push(person);
    else if (address.includes(wanted) || name.includes(wanted)) holds.push(person);
    if (starts.length >= SHOWN) break;
  }
  return [...starts, ...holds].slice(0, SHOWN);
}
