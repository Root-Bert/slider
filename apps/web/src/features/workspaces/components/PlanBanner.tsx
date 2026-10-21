import type { Workspace } from '@slider/shared';
import { routes } from '@/lib/routes';
import { Notice, TextLink } from '@/ui';
import { downgradeMessage, pendingDowngrade } from '../lib/plan';

/**
 * Above the organisation's pages (BER-155): over the plan's limits, about to fall back to free
 * (admins – they can act), or asked to take over paying. One at a time, most urgent first; each
 * leads to "Nutzung".
 */
export function PlanBanner({ workspace, userId }: { workspace: Workspace; userId: string }) {
  const { billing } = workspace;
  const downgradeAt = pendingDowngrade(billing);
  const message = workspace.locked
    ? 'Die Organisation liegt über dem Limit ihres Plans: Neue Reviews, Uploads, Einladungen und Kommentare gehen gerade nicht.'
    : downgradeAt && workspace.role === 'admin'
      ? downgradeMessage(downgradeAt)
      : billing.transfer?.to.id === userId
        ? `${billing.owner?.name ?? 'Jemand'} bittet dich, die Zahlung zu übernehmen.`
        : null;
  if (!message) return null;
  const urgent = workspace.locked || Boolean(downgradeAt);
  return (
    <div className="dot-grid px-4 pt-3 md:px-14">
      <Notice
        tone={urgent ? 'warning' : 'info'}
        variant="tinted"
        size="sm"
        role="status"
        icon={urgent ? 'warning' : false}
      >
        <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span>{message}</span>
          <TextLink to={routes.usage(workspace.id)} variant="inline" weight="medium">
            Zur Nutzung
          </TextLink>
        </span>
      </Notice>
    </div>
  );
}
