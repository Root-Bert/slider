import { cn } from '@/ui';
import { nameParts, useShowExtensions } from '../hooks/useShowExtensions';

/**
 * A file's or folder's name in a line: without the file's ending unless „Dateiendungen“ asks for
 * it, and cut in the middle where there is too little room – „eigen-pitch-sch…zuerst-10-folien“,
 * its end (and ending) always seen, as Finder does. The whole name is the caller's `title`.
 */
export function FileName({
  node,
  className,
}: {
  node: { name: string; kind: string };
  className?: string;
}) {
  const extensions = useShowExtensions();
  const { head, tail } = nameParts(node, extensions);
  if (!tail) return <span className={cn('min-w-0 truncate', className)}>{head}</span>;
  // Read out once, whole: the two parts side by side would be read with a space between.
  return (
    <span className={cn('flex min-w-0', className)}>
      <span className="sr-only">{head + tail}</span>
      <span aria-hidden className="min-w-0 truncate">
        {head}
      </span>
      <span aria-hidden className="shrink-0 whitespace-pre">
        {tail}
      </span>
    </span>
  );
}
