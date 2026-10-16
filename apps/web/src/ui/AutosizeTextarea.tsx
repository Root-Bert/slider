import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/ui';

interface AutosizeTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  maxHeight?: number;
  ref?: Ref<HTMLTextAreaElement>;
}

/**
 * Textarea that grows with its content up to `maxHeight`, then scrolls.
 * Generic primitive – candidate for `src/ui` once another feature needs it.
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
    element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
    element.style.overflowY = element.scrollHeight > maxHeight ? 'auto' : 'hidden';
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
