import { useMemo, type ReactNode } from 'react';
import { EVERYONE_TAG, MENTION_NOT_AFTER, type AccountAuthor } from '@slider/shared';
import { cn } from '@/ui';
import { LinkedText } from './LinkedText';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The pattern of @ with someone's name; addresses, mails and phones are `LinkedText`'s. */
function patternFor(people: readonly AccountAuthor[]): RegExp | null {
  const names = [
    ...new Set([
      EVERYONE_TAG,
      ...people.flatMap((person) => [person.name, person.name.split(/\s+/)[0] ?? '']),
    ]),
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
  // „@alle“ names everyone.
  if (name === EVERYONE_TAG) return true;
  const full = person.name.toLocaleLowerCase('de');
  return name === full || name === full.split(/\s+/)[0];
};

/** @-names marked (one's own more strongly) in a run of plain words; the rest `LinkedText`'s. */
function Mentioned({
  text,
  pattern,
  me,
}: {
  text: string;
  pattern: RegExp | null;
  me: AccountAuthor;
}) {
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

/**
 * Inline marks as one types them in a chat: `Code`, **fett**, _kursiv_ (or *kursiv*),
 * ~~durchgestrichen~~ – not inside a word, never across a line.
 */
const INLINE =
  /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|~~([^~\n]+?)~~|(?<![\p{L}\p{N}_])_([^_\n]+?)_(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}*])\*([^*\s][^*\n]*?)\*(?![\p{L}\p{N}*])/gu;

function Inline({
  text,
  pattern,
  me,
}: {
  text: string;
  pattern: RegExp | null;
  me: AccountAuthor;
}) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index;
    if (index > at)
      parts.push(
        <Mentioned key={`p${at}`} text={text.slice(at, index)} pattern={pattern} me={me} />,
      );
    const [, code, bold, strike, em, star] = match;
    const inner = (words: string) => <Inline text={words} pattern={pattern} me={me} />;
    parts.push(
      code !== undefined ? (
        <code key={index} className="rounded-mark bg-surface-2 px-1 font-mono text-[0.9em]">
          {code}
        </code>
      ) : bold !== undefined ? (
        <strong key={index} className="font-semibold">
          {inner(bold)}
        </strong>
      ) : strike !== undefined ? (
        <s key={index}>{inner(strike)}</s>
      ) : (
        <em key={index}>{inner(em ?? star ?? '')}</em>
      ),
    );
    at = index + match[0].length;
  }
  if (at < text.length)
    parts.push(<Mentioned key={`p${at}`} text={text.slice(at)} pattern={pattern} me={me} />);
  return <>{parts}</>;
}

type Block =
  | { kind: 'lines'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

/** The text in blocks: ```code```, lists of „- “ or „1. “ lines, and the lines between. */
function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let plain: string[] = [];
  const flush = () => {
    if (plain.length > 0) blocks.push({ kind: 'lines', text: plain.join('\n') });
    plain = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trimStart().startsWith('```')) {
      const end = lines.findIndex((each, at) => at > i && each.trim().startsWith('```'));
      if (end !== -1) {
        flush();
        const first = line.trimStart().slice(3);
        blocks.push({
          kind: 'code',
          text: [
            ...(first.trim() && !/^\w+$/.test(first.trim()) ? [first] : []),
            ...lines.slice(i + 1, end),
          ].join('\n'),
        });
        i = end;
        continue;
      }
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      const ordered = !bullet;
      const last = blocks.at(-1);
      if (plain.length === 0 && last?.kind === 'list' && last.ordered === ordered)
        last.items.push(item[1] ?? '');
      else {
        flush();
        blocks.push({ kind: 'list', ordered, items: [item[1] ?? ''] });
      }
      continue;
    }
    plain.push(line);
  }
  flush();
  return blocks;
}

/**
 * A message's text as written – lines kept, web addresses, mails and phone numbers as links
 * (`LinkedText`), @-names marked (one's own more strongly), and the little formatting one types
 * in a chat: **fett**, _kursiv_, ~~durch~~, `Code`, ```Codeblock```, „- “ / „1. “ lists.
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
  const blocks = useMemo(() => blocksOf(text), [text]);
  // Only lines: as before, nothing around them.
  if (blocks.length === 1 && blocks[0]?.kind === 'lines')
    return <Inline text={blocks[0].text} pattern={pattern} me={me} />;
  return (
    <>
      {blocks.map((block, index) =>
        block.kind === 'code' ? (
          <pre
            key={index}
            className="my-1 overflow-x-auto rounded-control bg-surface-2 px-2.5 py-2 font-mono text-[0.9em] whitespace-pre"
          >
            <code>{block.text}</code>
          </pre>
        ) : block.kind === 'list' ? (
          (() => {
            const List = block.ordered ? 'ol' : 'ul';
            return (
              <List
                key={index}
                className={cn(
                  'my-0.5 flex flex-col gap-0.5 pl-5 whitespace-normal',
                  block.ordered ? 'list-decimal' : 'list-disc',
                )}
              >
                {block.items.map((item, at) => (
                  <li key={at}>
                    <Inline text={item} pattern={pattern} me={me} />
                  </li>
                ))}
              </List>
            );
          })()
        ) : (
          <span key={index} className="block">
            <Inline text={block.text} pattern={pattern} me={me} />
          </span>
        ),
      )}
    </>
  );
}
