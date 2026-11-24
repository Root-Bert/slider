import { cn, Icon } from '@/ui';

/** A chat or mail pinned to the top of its list – as a presentation's („Angepinnt“). */
export function PinnedMark({ className }: { className?: string }) {
  return (
    <Icon
      name="pushPin"
      size={14}
      className={cn('shrink-0 rotate-45 text-fg-subtle', className)}
      label="Angepinnt"
    />
  );
}

/** A conversation muted („Stummschalten“): no count on the app's icon, no notification. */
export function MutedMark({ className }: { className?: string }) {
  return (
    <Icon
      name="notificationsOff"
      size={14}
      className={cn('shrink-0 text-fg-subtle', className)}
      label="Stummgeschaltet"
    />
  );
}
