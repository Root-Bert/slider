import { Fragment, type ReactNode } from 'react';
import { cn, TextLink } from '@/ui';

/**
 * The Markdown the instance admin writes for privacy policy and imprint (BER-141), as React
 * nodes – never HTML, so nothing in it can run. Enough for legal texts: `#`–`###` headings,
 * paragraphs (single line breaks kept, as in addresses), `- ` lists, `**bold**`, `` `code` ``,
 * `[text](https://…)` and bare links.
 */
export function LegalText({ markdown, className }: { markdown: string; className?: string }) {
  const blocks = markdown
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n{2,}/);
  return (
    <div className={cn('flex flex-col gap-3 text-sm leading-6 text-fg-muted', className)}>
      {blocks.map((block, index) => (
        <Block key={index} text={block} />
      ))}
    </div>
  );
}

function Block({ text }: { text: string }) {
  const heading = /^(#{1,3})\s+(.*)$/.exec(text);
  if (heading && !text.includes('\n')) {
    const level = heading[1]?.length ?? 1;
    const content = inline(heading[2] ?? '');
    if (level === 1) return <h1 className="text-2xl leading-8 font-semibold text-fg">{content}</h1>;
    if (level === 2) return <h2 className="mt-3 text-base font-semibold text-fg">{content}</h2>;
    return <h3 className="mt-1 text-sm font-semibold text-fg">{content}</h3>;
  }
  const lines = text.split('\n');
  if (lines.every((line) => /^\s*-\s+/.test(line))) {
    return (
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {lines.map((line, index) => (
          <li key={index}>{inline(line.replace(/^\s*-\s+/, ''))}</li>
        ))}
      </ul>
    );
  }
  return (
    <p>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 && <br />}
          {inline(line)}
        </Fragment>
      ))}
    </p>
  );
}

const INLINE =
  /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|\/[^\s)]*)\)|(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)])/g;

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(INLINE)) {
    const [whole, bold, code, label, href, bare] = match;
    nodes.push(text.slice(cursor, match.index));
    cursor = match.index + whole.length;
    const key = match.index;
    if (bold)
      nodes.push(
        <strong key={key} className="font-semibold text-fg">
          {bold}
        </strong>,
      );
    else if (code)
      nodes.push(
        <code key={key} className="font-mono text-fg">
          {code}
        </code>,
      );
    else {
      const target = href ?? bare ?? '';
      nodes.push(
        <TextLink key={key} href={target} variant="underline" tone="muted">
          {label ?? target}
        </TextLink>,
      );
    }
  }
  nodes.push(text.slice(cursor));
  return nodes;
}
