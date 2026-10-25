import type { SyncError } from '@slider/shared';
import { useId } from 'react';
import { useMe } from '@/lib/api';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import {
  Button,
  ButtonLink,
  cn,
  Icon,
  iconButtonClasses,
  PopoverPanel,
  Spinner,
  Tooltip,
  usePopover,
  type IconName,
} from '@/ui';
import {
  bannerSyncError,
  isLoginError,
  sourceLoginLabel,
  syncErrorTitle,
} from './lib/revision-changes';
import { useRevisionData } from '../state/revision-data';
import { useViewerData } from '../state/viewer-data';

const relativeOrJustNow = (iso: string) => {
  const text = formatRelativeTime(iso);
  return text === 'jetzt' ? 'gerade eben' : text;
};

/**
 * How the automatic update of a linked deck is doing, as one small icon next to the comment
 * filter – nothing above the track, so no slide or pin is ever covered: a spinner while a
 * change is being taken over, a danger icon when the update failed (Figma A3). Clicking the
 * icon tells what is going on, which version is still shown and – where the viewer can fix
 * it – the one action that does. A new version that loaded fine is a notice of its own
 * (`RevisionNotice`).
 */
export function SyncStatus() {
  const { sync, isLinked } = useRevisionData();
  const error = bannerSyncError(sync, isLinked);
  if (error) return <SyncErrorStatus error={error} />;
  if (!sync?.pending) return null;

  return (
    <Tooltip
      align="start"
      maxWidth="none"
      className="shrink-0"
      label={
        <>
          <span className="block">Änderung erkannt – wird übernommen …</span>
          {sync.pendingSince && (
            <span className="block text-fg-subtle">
              Erkannt {formatRelativeTime(sync.pendingSince)}
            </span>
          )}
        </>
      }
    >
      <span
        role="status"
        tabIndex={0}
        aria-label="Änderung erkannt – wird übernommen"
        className="flex size-8 items-center justify-center rounded-control text-fg-subtle"
      >
        <Spinner size={16} />
      </span>
    </Tooltip>
  );
}

function SyncErrorStatus({ error }: { error: SyncError }) {
  const { deck, canManage } = useViewerData();
  const { revisionNumber } = useRevisionData();
  const { open, wrapperRef, triggerProps, panelRef, panelId } = usePopover({ hasPopup: 'dialog' });
  const titleId = useId();

  const login = canManage && isLoginError(error.code) && error.loginUrl;
  const icon: IconName =
    isLoginError(error.code) || error.code === 'access_revoked'
      ? 'lock'
      : error.code === 'storage_full'
        ? 'cloud'
        : 'warning';
  const title = syncErrorTitle(error.code, error.loginUrl);

  return (
    <div ref={wrapperRef} className={cn('relative shrink-0', open && 'z-(--z-raised)')}>
      <Tooltip align="start" maxWidth="none" decorative disabled={open} label={title}>
        <button
          type="button"
          aria-label={title}
          {...triggerProps}
          className={cn(
            iconButtonClasses({ size: 'sm' }),
            'text-danger hover:text-danger aria-expanded:text-danger',
          )}
        >
          <Icon name={icon} size={18} />
        </button>
      </Tooltip>

      {open && (
        <PopoverPanel
          ref={panelRef}
          id={panelId}
          as="section"
          role="dialog"
          aria-labelledby={titleId}
          side="top"
          padding="lg"
          className="w-72 max-w-[calc(100vw-32px)] gap-1"
        >
          <p id={titleId} className="text-sm font-medium text-fg">
            {title}
          </p>
          <p className="text-xs leading-4 text-fg-muted">{error.message}</p>
          <p className="text-caption text-fg-subtle" title={formatDateTime(error.at)}>
            Du siehst weiterhin Version {revisionNumber} | {relativeOrJustNow(error.at)}
          </p>
          {login ? (
            <div className="flex pt-2">
              <Button size="sm" onClick={() => window.location.assign(error.loginUrl!)}>
                {sourceLoginLabel(error.loginUrl)}
              </Button>
            </div>
          ) : (
            error.code === 'storage_full' && <StorageAction workspaceId={deck.workspaceId} />
          )}
        </PopoverPanel>
      )}
    </div>
  );
}

/**
 * The workspace's admins free up room or upgrade on "Nutzung" (BER-151); everyone else only
 * reads why. Its own component: only this error asks who the viewer is.
 */
function StorageAction({ workspaceId }: { workspaceId: string }) {
  const { data: me } = useMe();
  const admin = me?.workspaces?.some(
    (workspace) => workspace.id === workspaceId && workspace.role === 'admin',
  );
  if (!admin) return null;
  return (
    <div className="flex pt-2">
      <ButtonLink size="sm" variant="secondary" to={routes.usage(workspaceId)}>
        Speicher verwalten
      </ButtonLink>
    </div>
  );
}
