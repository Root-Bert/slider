import { useMemo } from 'react';
import { cn } from '@/ui';
import { tokenizeBody } from './lib/comment-body';
import { useViewerData } from '../state/viewer-data';

interface CommentBodyProps {
  body: string;
  className?: string;
}

/** Renders a comment body with @mentions, **bold** and links as React nodes (no HTML injection). */
export function CommentBody({ body, className }: CommentBodyProps) {
  const { participantNames, viewer } = useViewerData();
  const ownMention = `@${viewer.author.name}`;
  const tokens = useMemo(() => tokenizeBody(body, participantNames), [body, participantNames]);

  return (
    <p
      className={cn(
        'text-[13px] leading-[18px] break-words whitespace-pre-wrap text-fg',
        className,
      )}
    >
      {tokens.map((token, index) => {
        switch (token.type) {
          case 'text':
            return token.text;
          case 'bold':
            return (
              <strong key={index} className="font-semibold text-fg">
                {token.text}
              </strong>
            );
          case 'mention':
            // The viewer's own name stands out (BER-105).
            return (
              <span
                key={index}
                className={cn(
                  'font-medium text-mention',
                  token.text === ownMention && 'rounded-[4px] bg-mention/20 px-0.5 text-fg',
                )}
              >
                {token.text}
              </span>
            );
          case 'link':
            return (
              <a
                key={index}
                href={token.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="relative z-10 text-mention underline underline-offset-2 hover:text-fg"
              >
                {token.text}
              </a>
            );
        }
      })}
    </p>
  );
}
