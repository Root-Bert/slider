import { Fragment, type ReactNode } from 'react';
import { cn } from '@/ui';
import { RICH_THEME as THEME } from './rich-theme';

/*
 * A sticker's rich text shown on the board, without its editor (`RichSticker.tsx`, loaded only
 * when one is typed in): Lexical's serialised state walked into elements – safe by construction,
 * links only http(s).
 */

type Serialized = {
  type?: string;
  children?: Serialized[];
  text?: string;
  format?: number;
  tag?: string;
  listType?: string;
  url?: string;
};

/** Lexical's format bits. */
const BOLD = 1;
const ITALIC = 2;
const STRIKE = 4;
const UNDERLINE = 8;

/** A sticker's rich text shown (no editor): its state walked into elements, safe by construction. */
export function RichText({
  rich,
  className,
  renderText = plain,
}: {
  rich: Record<string, unknown>;
  className?: string;
  /** A text run's content – the material answers turn their sources into chips. */
  renderText?: (text: string) => ReactNode;
}) {
  const root = (rich as { root?: Serialized }).root;
  return <div className={className}>{render(root?.children ?? [], renderText)}</div>;
}

const plain = (text: string) => text;

function render(nodes: Serialized[], text: (text: string) => ReactNode): ReactNode {
  return nodes.map((node, index) => <Fragment key={index}>{renderNode(node, text)}</Fragment>);
}

function renderNode(node: Serialized, text: (text: string) => ReactNode): ReactNode {
  const children = render(node.children ?? [], text);
  switch (node.type) {
    case 'text': {
      const bits = node.format ?? 0;
      return (
        <span
          className={cn(
            bits & BOLD && THEME.text.bold,
            bits & ITALIC && THEME.text.italic,
            bits & UNDERLINE && !(bits & STRIKE) && THEME.text.underline,
            bits & STRIKE && !(bits & UNDERLINE) && THEME.text.strikethrough,
            bits & UNDERLINE && bits & STRIKE && THEME.text.underlineStrikethrough,
          )}
        >
          {text(node.text ?? '')}
        </span>
      );
    }
    case 'linebreak':
      return <br />;
    case 'link':
    case 'autolink':
      return /^https?:\/\//i.test(node.url ?? '') ? (
        <a
          href={node.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(THEME.link, 'nodrag')}
        >
          {children}
        </a>
      ) : (
        children
      );
    case 'heading':
      return node.tag === 'h1' ? (
        <p className={THEME.heading.h1}>{children}</p>
      ) : (
        <p className={THEME.heading.h2}>{children}</p>
      );
    case 'list':
      return node.listType === 'number' ? (
        <ol className={THEME.list.ol}>{children}</ol>
      ) : (
        <ul className={THEME.list.ul}>{children}</ul>
      );
    case 'listitem':
      return <li className={THEME.list.listitem}>{children}</li>;
    default:
      return <p className={THEME.paragraph}>{node.children?.length ? children : <br />}</p>;
  }
}
