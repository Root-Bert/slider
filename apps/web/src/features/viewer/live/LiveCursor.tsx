import type { Author } from '@slider/shared';
import type { Ref } from 'react';
import { accentColor, onAccentClass } from '@/lib/accent';
import { generatedAvatar } from '@/lib/generated-avatar';
import { cn } from '@/ui';

/** Avatar cursor size (px); its pointed top-left corner is the hotspot. */
const SIZE = 30;
/** Rounded just enough at the tip to read as a pointer, not a speech bubble. */
const TEAR = '3px 50% 50% 50%';

interface LiveCursorProps {
  author: Author;
  ref: Ref<HTMLDivElement>;
}

/** The name tag tucks this far under the avatar, so the two read as one piece. */
const TUCK = 12;
const TAG_H = 20;

/** First name only – the cursor is small. */
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * Someone's pointer on a slide: their avatar *is* the cursor – a drop whose top-left corner is the
 * pointer tip, in their colour – with a tag for their first name growing out from under it. The
 * cursor layer moves it via `transform` and sets `data-idle` once it rests a while: the tag slides
 * back under the avatar.
 */
export function LiveCursor({ author, ref }: LiveCursorProps) {
  const color = accentColor(author.color);

  return (
    <div
      ref={ref}
      aria-hidden
      className="group pointer-events-none absolute top-0 left-0 opacity-0 transition-opacity duration-200 will-change-transform data-[visible]:opacity-100"
    >
      {/* Behind the avatar, vertically centred on it. */}
      <div
        className={cn(
          'absolute w-max rounded-r-full shadow-lift',
          'transition-[opacity,translate] duration-300 ease-out',
          'group-data-[idle]:-translate-x-2 group-data-[idle]:opacity-0',
        )}
        style={{
          left: SIZE - TUCK,
          top: (SIZE - TAG_H) / 2,
          height: TAG_H,
          paddingLeft: TUCK,
          background: color,
        }}
      >
        <span
          className={cn(
            'block max-w-32 overflow-hidden pr-2 pl-1 text-xs leading-5 font-medium text-ellipsis whitespace-nowrap',
            'transition-[max-width,padding] duration-300 ease-out group-data-[idle]:max-w-0 group-data-[idle]:px-0',
            onAccentClass(author.color),
          )}
        >
          {firstName(author.name)}
        </span>
      </div>
      <div
        className="relative shadow-lift transition-transform duration-200 ease-out group-data-[idle]:scale-90"
        style={{
          width: SIZE,
          height: SIZE,
          borderRadius: TEAR,
          background: color,
          padding: 2.5,
          transformOrigin: '0 0',
        }}
      >
        <img
          src={generatedAvatar(author.name)}
          alt=""
          draggable={false}
          className="size-full bg-placeholder object-cover"
          style={{ borderRadius: TEAR }}
        />
      </div>
    </div>
  );
}
