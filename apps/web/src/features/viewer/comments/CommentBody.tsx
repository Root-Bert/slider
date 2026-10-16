import { useMemo } from 'react';
import { cn, TextLink } from '@/ui';
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
    <p className={cn('text-body leading-4.5 break-words whitespace-pre-wrap text-fg', className)}>
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
                  token.text === ownMention && 'rounded-thumb bg-mention/20 px-0.5 text-fg',
                )}
              >
                {token.text}
              </span>
            );
          case 'link':
            return (
              <TextLink
                key={index}
                variant="mention"
                href={token.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="relative z-(--z-raised)"
              >
                {token.text}
              </TextLink>
            );
        }
      })}
    </p>
  );
}
