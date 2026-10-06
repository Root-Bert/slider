import type { ErrorCode } from '@slider/shared';
import { ApiError } from '@/lib/api-client';
import { Button, Icon } from '@/ui';

const LINK_ERRORS: Partial<
  Record<ErrorCode, { title: string; icon: 'error' | 'schedule' | 'lock' }>
> = {
  not_found: { title: 'Dieser Link existiert nicht.', icon: 'error' },
  link_revoked: { title: 'Dieser Link wurde widerrufen.', icon: 'lock' },
  link_expired: { title: 'Dieser Link ist abgelaufen.', icon: 'schedule' },
};

export function InviteError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const known = error instanceof ApiError ? LINK_ERRORS[error.code] : undefined;

  return (
    <div role="alert" className="flex flex-col items-center gap-4 py-2 text-center">
      <title>Link ungültig · Slider</title>
      <span className="flex size-12 items-center justify-center rounded-full bg-white/10 text-fg-muted">
        <Icon name={known?.icon ?? 'error'} size={22} />
      </span>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold text-fg">
          {known?.title ?? 'Die Einladung konnte nicht geladen werden.'}
        </h1>
        <p className="text-[13px] text-fg-subtle">
          {known
            ? 'Bitte die Person, die dich eingeladen hat, um einen neuen Link.'
            : error.message}
        </p>
      </div>
      {!known && (
        <Button variant="secondary" icon="refresh" onClick={onRetry}>
          Erneut versuchen
        </Button>
      )}
    </div>
  );
}

export function InviteSkeleton() {
  return (
    <div className="flex flex-col items-center gap-5" aria-busy aria-label="Einladung wird geladen">
      <div className="skeleton aspect-video w-40 rounded-[8px]" />
      <div className="skeleton h-5 w-4/5 rounded" />
      <div className="skeleton h-3 w-3/5 rounded" />
      <div className="skeleton h-10 w-full rounded-control" />
      <div className="skeleton h-11 w-full rounded-control" />
    </div>
  );
}
