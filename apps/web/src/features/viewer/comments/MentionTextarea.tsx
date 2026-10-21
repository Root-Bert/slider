import { useMemo, useRef, type ComponentProps } from 'react';
import { AutosizeTextarea, cn } from '@/ui';
import { tokenizeBody } from './lib/comment-body';
import { useViewerData } from '../state/viewer-data';

/**
 * A comment field whose @mentions of people in the deck stand out while typing (BER-105). A
 * textarea can't style parts of its text, so a copy of the text sits behind it – invisible but
 * for a tint behind each mention. The field's own text stays on top: caret and selection as usual.
 */
export function MentionTextarea({
  className,
  onScroll,
  ...props
}: ComponentProps<typeof AutosizeTextarea>) {
  const { participantNames } = useViewerData();
  const backdropRef = useRef<HTMLDivElement>(null);
  const tokens = useMemo(() => {
    const known = new Set(participantNames.map((name) => `@${name}`));
    return tokenizeBody(props.value, participantNames).map((token) =>
      token.type === 'mention' && known.has(token.text)
        ? { mention: true, text: token.text }
        : // The backdrop shows the raw text, `**` included, so it lines up with the field.
          { mention: false, text: token.type === 'bold' ? `**${token.text}**` : token.text },
    );
  }, [props.value, participantNames]);

  return (
    <div className="relative">
      {tokens.some((token) => token.mention) && (
        <div
          ref={backdropRef}
          aria-hidden
          className={cn(
            className,
            'pointer-events-none absolute inset-0 overflow-hidden break-words whitespace-pre-wrap text-transparent!',
          )}
        >
          {tokens.map((token, index) =>
            token.mention ? (
              // A shadow, not padding: the backdrop's text must keep the field's widths.
              <span
                key={index}
                data-mention
                className="rounded-thumb bg-mention/25 shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-mention)_25%,transparent)]"
              >
                {token.text}
              </span>
            ) : (
              token.text
            ),
          )}
        </div>
      )}
      <AutosizeTextarea
        {...props}
        onScroll={(event) => {
          if (backdropRef.current) backdropRef.current.scrollTop = event.currentTarget.scrollTop;
          onScroll?.(event);
        }}
        className={cn('relative', className)}
      />
    </div>
  );
}
