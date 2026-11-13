import { useState, type ComponentProps } from 'react';
import { cn } from '@/ui';
import { pictureShown } from './shown-pictures';

interface Source {
  src: string;
  srcSet?: string;
}

const keyOf = ({ src, srcSet }: Source) => `${src}|${srcSet ?? ''}`;

type ImgProps = Omit<ComponentProps<'img'>, 'src' | 'srcSet' | 'onError'>;

/**
 * A picture that is swapped for a new one without a blank frame – as in LibreOffice or
 * PowerPoint, a slide drawn anew after an edit just turns into the new picture. An `<img>` whose
 * `src` changes paints nothing until the new one is decoded and rastered (Chrome, Safari), so
 * none ever changes it: the new picture comes in its own `<img>` under the old one, and the old
 * one goes once the new one is decoded and has been on screen for a frame. Fills its positioned
 * parent.
 */
export function SwapImage({
  src,
  srcSet,
  initialSrc,
  className,
  onError,
  ...props
}: ImgProps &
  Source & {
    /** Already available preview, kept on the first mount until the full picture is decoded. */
    initialSrc?: string;
    onError?: (src: string) => void;
  }) {
  // Oldest first; the first is on screen, those after it are coming in under it.
  const [stack, setStack] = useState<Source[]>(() => [
    ...(initialSrc && initialSrc !== src ? [{ src: initialSrc }] : []),
    { src, srcSet },
  ]);
  const latest = stack[stack.length - 1]!;
  if (keyOf(latest) !== keyOf({ src, srcSet })) {
    // Back to one still there (A → B → A before B came in): those after it go, it stays.
    const at = stack.findIndex((item) => keyOf(item) === keyOf({ src, srcSet }));
    setStack(at >= 0 ? stack.slice(0, at + 1) : [...stack, { src, srcSet }]);
  }

  /** `source` is on screen: whatever came before it goes. */
  const settle = (source: Source) =>
    setStack((current) => {
      const at = current.findIndex((item) => keyOf(item) === keyOf(source));
      return at > 0 ? current.slice(at) : current;
    });

  // Painted in reverse: the one shown last, on top; one coming in goes in before it, under it –
  // no `<img>` moves, and none needs a z-index that would lift it over the layers beside it.
  return stack
    .map((item, index) => (
      <img
        key={keyOf(item)}
        {...props}
        src={item.src}
        srcSet={item.srcSet}
        className={cn('absolute inset-0 size-full', className)}
        onLoad={(event) => {
          props.onLoad?.(event);
          const image = event.currentTarget;
          // Decoded and on screen for a frame – loaded alone, a big picture may not paint for a
          // frame (`decoding="async"`): the old one and what was drawn live over the slide go
          // together, in one frame (the first one has nothing under it to go).
          const shown = () =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                if (index > 0) settle(item);
                pictureShown(item.src);
              }),
            );
          if (typeof image.decode === 'function') image.decode().then(shown, shown);
          else shown();
        }}
        onError={() => {
          // A failed optional preview must neither cover the full picture nor fail the slide.
          if (item.src === initialSrc && item.src !== src) {
            setStack((current) => current.filter((source) => source !== item));
            return;
          }
          // A new one that fails takes over too: the error shows as it did.
          if (index > 0) settle(item);
          pictureShown(item.src);
          onError?.(item.src);
        }}
      />
    ))
    .reverse();
}
