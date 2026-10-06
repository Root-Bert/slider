import { cn, Icon } from '@/ui';

/** Trust line from the design: Slider never writes back to the source file. */
export function OriginalUntouchedNote({ className }: { className?: string }) {
  return (
    <p className={cn('flex items-center gap-1.5 text-xs text-fg-subtle', className)}>
      <Icon name="lock" size={14} className="shrink-0" />
      Die Original-PowerPoint wird nie verändert.
    </p>
  );
}
