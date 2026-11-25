import { useMemo, type ReactNode } from 'react';
import { EVERYONE_TAG, MENTION_NOT_AFTER, type AccountAuthor } from '@slider/shared';
import { cn } from '@/ui';
import { LinkedText } from './LinkedText';
import { MARKUP_LOOK, markupLines, markupRuns, type MarkupRun } from '../lib/markup';

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

/** A line's runs: marks around more runs, links (http(s) only), the words between. */
function Runs({
  runs,
  pattern,
  me,
  linked = true,
}: {
  runs: MarkupRun[];
  pattern: RegExp | null;
  me: AccountAuthor;
  /** Off inside a link: no link in a link. */
  linked?: boolean;
}) {
  return (
    <>
      {runs.map((run, index) => {
        const inner = (more: MarkupRun[], inLink = !linked) => (
          <Runs runs={more} pattern={pattern} me={me} linked={!inLink} />
        );
        switch (run.kind) {
          case 'text':
            return linked ? (
              <Mentioned key={index} text={run.text} pattern={pattern} me={me} />
            ) : (
              run.text
            );
          case 'code':
            return (
              <code key={index} className={MARKUP_LOOK.code}>
                {run.text}
              </code>
            );
          case 'bold':
            return (
              <strong key={index} className="font-semibold">
                {inner(run.runs)}
              </strong>
            );
          case 'italic':
            return <em key={index}>{inner(run.runs)}</em>;
          case 'strike':
            return <s key={index}>{inner(run.runs)}</s>;
          case 'underline':
            return <u key={index}>{inner(run.runs)}</u>;
          case 'link':
            return (
              <a
                key={index}
                href={run.url}
                title={run.url}
                target="_blank"
                rel="noopener noreferrer"
                className={MARKUP_LOOK.link}
              >
                {inner(run.runs, true)}
              </a>
            );
        }
      })}
    </>
  );
}

function Inline({
  text,
  pattern,
  me,
}: {
  text: string;
  pattern: RegExp | null;
  me: AccountAuthor;
}) {
  const runs = useMemo(() => markupRuns(text), [text]);
  return <Runs runs={runs} pattern={pattern} me={me} />;
}

type Block =
  | { kind: 'lines'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] }
  | { kind: 'heading'; level: 1 | 2; text: string }
  | { kind: 'quote'; text: string };

/** The lines in blocks: a code block, a list, a heading, a quote, and the lines between. */
function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  let code: string[] | null = null;
  for (const line of markupLines(text)) {
    const last = blocks.at(-1);
    if (line.kind === 'code') {
      if (line.edge === 'open') {
        // Words after the opening ``` are code too – a language's name is not.
        const first = line.text.trimStart().slice(3);
        code = first.trim() && !/^\w+$/.test(first.trim()) ? [first] : [];
      } else if (line.edge === 'close') {
        blocks.push({ kind: 'code', text: (code ?? []).join('\n') });
        code = null;
      } else code?.push(line.text);
      continue;
    }
    if (line.kind === 'bullet' || line.kind === 'number') {
      const ordered = line.kind === 'number';
      if (last?.kind === 'list' && last.ordered === ordered) last.items.push(line.text);
      else
        blocks.push({
          kind: 'list',
          ordered,
          start: line.kind === 'number' ? line.number : 1,
          items: [line.text],
        });
    } else if (line.kind === 'heading') blocks.push(line);
    else if (line.kind === 'quote') {
      if (last?.kind === 'quote') last.text += `\n${line.text}`;
      else blocks.push({ kind: 'quote', text: line.text });
    } else if (last?.kind === 'lines') last.text += `\n${line.text}`;
    else blocks.push({ kind: 'lines', text: line.text });
  }
  return blocks;
}

/**
 * A message's text as written – lines kept, web addresses, mails and phone numbers as links
 * (`LinkedText`), @-names marked (one's own more strongly), and its formatting (`markup.ts`):
 * **fett**, _kursiv_, <u>unterstrichen</u>, ~~durch~~, `Code`, [Links](…), ```Codeblock```,
 * „- “ / „1. “ lists, „# “ / „## “ headings, „> “ quotes – as `RichField` shows it while typed.
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
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'code':
            return (
              <pre key={index} className={MARKUP_LOOK.codeBlock}>
                <code>{block.text}</code>
              </pre>
            );
          case 'list': {
            const List = block.ordered ? 'ol' : 'ul';
            return (
              <List
                key={index}
                start={block.ordered && block.start !== 1 ? block.start : undefined}
                className={cn(
                  block.ordered ? MARKUP_LOOK.ol : MARKUP_LOOK.ul,
                  'flex flex-col gap-0.5 whitespace-normal',
                )}
              >
                {block.items.map((item, at) => (
                  <li key={at}>
                    <Inline text={item} pattern={pattern} me={me} />
                  </li>
                ))}
              </List>
            );
          }
          case 'heading':
            return (
              <span key={index} className={cn('block', MARKUP_LOOK[`h${block.level}`])}>
                <Inline text={block.text} pattern={pattern} me={me} />
              </span>
            );
          case 'quote':
            return (
              <span key={index} className={cn('block', MARKUP_LOOK.quote)}>
                <Inline text={block.text} pattern={pattern} me={me} />
              </span>
            );
          case 'lines':
            return (
              <span key={index} className="block">
                <Inline text={block.text} pattern={pattern} me={me} />
              </span>
            );
        }
      })}
    </>
  );
}
