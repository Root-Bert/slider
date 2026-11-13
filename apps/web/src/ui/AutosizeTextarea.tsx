import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from './cn';

interface AutosizeTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  maxHeight?: number;
  ref?: Ref<HTMLTextAreaElement>;
}

/**
 * Textarea that grows with its content up to `maxHeight`, then scrolls. Transparent and
 * borderless: the surrounding field (`field-well`, `focus-field`) draws the box.
 */
export function AutosizeTextarea({
  value,
  maxHeight = 200,
  className,
  rows = 1,
  ref: forwardedRef,
  ...props
}: AutosizeTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(forwardedRef, () => ref.current!, []);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    const contentHeight = element.scrollHeight;
    // A fitting border box cannot overflow after shrinking to its content height. Reuse that
    // read; capped or content-box fields still need their final scroll height (padding/rows).
    const fits = contentHeight <= maxHeight && getComputedStyle(element).boxSizing === 'border-box';
    element.style.height = `${Math.min(contentHeight, maxHeight)}px`;
    element.style.overflowY = fits
      ? 'hidden'
      : element.scrollHeight > maxHeight
        ? 'auto'
        : 'hidden';
  }, [value, maxHeight]);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={rows}
      className={cn(
        'block w-full resize-none bg-transparent outline-none placeholder:text-fg-subtle',
        className,
      )}
      {...props}
    />
  );
}
