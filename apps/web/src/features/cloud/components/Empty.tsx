import type { ReactNode } from 'react';
import { EmptyState, IconTile, type IconName } from '@/ui';
import { EmptyScene } from './EmptyScene';

/**
 * „Nothing here“ in a list of Cloud: a symbol (a little at work where it has a scene, see
 * `EmptyScene`), what it means, what to do about it.
 */
export function Empty({
  icon,
  title,
  message,
  action,
}: {
  icon: IconName;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <EmptyState
      illustration={
        <IconTile size={56}>
          <EmptyScene icon={icon} />
        </IconTile>
      }
      title={title}
      message={message}
      action={action}
    />
  );
}

/** A list that could not be loaded – only shown when there is nothing to show instead. */
export function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <EmptyState
      title="Das konnte nicht geladen werden"
      message={message}
      action={
        <button type="button" className="text-body text-fg underline" onClick={onRetry}>
          Erneut versuchen
        </button>
      }
    />
  );
}
