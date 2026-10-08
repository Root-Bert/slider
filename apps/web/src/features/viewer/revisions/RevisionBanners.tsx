import type { DeckSync, SyncError } from '@slider/shared';
import { useState } from 'react';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { useSyncDeck } from '@/lib/queries';
import { Button, cn, Icon, IconButton, Spinner, type IconName } from '@/ui';
import {
  bannerSyncError,
  isLoginError,
  syncErrorTitle,
  syncResultMessage,
} from '../lib/revision-changes';
import { dismissSyncError, isSyncErrorDismissed } from '../lib/seen-revisions';
import { useRevisionData } from '../state/revision-data';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';

const relativeOrJustNow = (iso: string) => {
  const text = formatRelativeTime(iso);
  return text === 'jetzt' ? 'gerade eben' : text;
};

/**
 * Status banners at the top of the viewer, above the slide track: a change is being taken over,
 * or the automatic update failed (Figma A3). A new version that loaded fine is no banner – it is
 * a short notice next to "Neu laden" (`RevisionNotice`).
 *
 * They take their own room in the layout instead of floating over the track: the track gets
 * that much shorter while a banner shows, so no slide title or comment pin is ever hidden or
 * blocked by one. The side panel's room is the viewer's padding, so they stay centred over the
 * track.
 */
export function RevisionBanners() {
  const { sync, isLinked } = useRevisionData();
  const error = bannerSyncError(sync, isLinked);
  const pending = Boolean(sync?.pending);
  if (!error && !pending) return null;

  return (
    <div
      data-revision-banners
      className="relative z-30 flex shrink-0 flex-col items-center gap-2 px-3 pt-3 md:pt-5"
    >
      {/* Keyed by time: a newer error shows again even after the previous one was dismissed. */}
      {error && <ErrorBanner key={error.at} error={error} />}
      {pending && !error && <PendingBanner sync={sync!} />}
    </div>
  );
}

const BANNER_CLASSES =
  'glass-elevated pointer-events-auto flex w-full max-w-[600px] animate-pop-in gap-3 rounded-panel px-2.5';
const DANGER_RING = 'shadow-[inset_0_0_0_1px_rgb(255_59_48/0.35),var(--shadow-float)]!';

function PendingBanner({ sync }: { sync: DeckSync }) {
  return (
    <section
      role="status"
      className="glass-elevated pointer-events-auto flex animate-fade-in items-center gap-2 rounded-full py-1.5 pr-3.5 pl-2.5 text-xs text-fg-muted"
      title={sync.pendingSince ? `Erkannt ${formatRelativeTime(sync.pendingSince)}` : undefined}
    >
      <Spinner size={14} className="text-fg-subtle" />
      Änderung erkannt – wird übernommen …
    </section>
  );
}

function ErrorBanner({ error }: { error: SyncError }) {
  const { deck, isOwner } = useViewerData();
  const { revisionNumber, isLinked } = useRevisionData();
  const syncDeck = useSyncDeck(deck.id);
  const showToast = useViewerToast();
  const [dismissed, setDismissed] = useState(() => isSyncErrorDismissed(deck.id, error.at));
  const [expanded, setExpanded] = useState(false);
  if (dismissed) return null;

  const dismiss = () => {
    dismissSyncError(deck.id, error.at);
    setDismissed(true);
  };
  const retry = () =>
    syncDeck.mutate(undefined, {
      onSuccess: (result) => {
        const message = syncResultMessage(result);
        if (message) showToast(message.text, message.tone);
      },
      onError: (failure) => showToast(failure.message, 'danger'),
    });
  const login = isOwner && isLoginError(error.code) && error.loginUrl;
  // Only link imports can be checked again; uploads get a new version by hand.
  const canRetry = isOwner && isLinked;
  const icon: IconName =
    isLoginError(error.code) || error.code === 'access_revoked' ? 'lock' : 'warning';
  const title = syncErrorTitle(error.code);
  const signIn = () => window.location.assign(error.loginUrl!);

  const actions = (login || canRetry) && (
    <div className={cn('flex flex-wrap items-center gap-2 pt-2', !expanded && 'max-sm:hidden')}>
      {login && (
        <Button size="sm" onClick={signIn}>
          Mit Microsoft anmelden
        </Button>
      )}
      {canRetry && (
        <Button
          size="sm"
          variant={login ? 'secondary' : 'primary'}
          loading={syncDeck.isPending}
          onClick={retry}
        >
          Erneut versuchen
        </Button>
      )}
    </div>
  );

  // Figma A3 on wider screens: title, message, "you still see version n", actions below. Phones
  // get one short row – title, the main action, close – and the rest on tapping the title, so
  // the banner never hides the slide.
  return (
    <section
      role="alert"
      aria-label={title}
      className={cn(
        BANNER_CLASSES,
        DANGER_RING,
        'items-start',
        !expanded && 'max-sm:items-center max-sm:gap-2 max-sm:py-1.5',
      )}
    >
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-danger/12 text-danger',
          !expanded && 'max-sm:size-8',
        )}
      >
        <Icon name={icon} size={20} />
      </span>
      <div className={cn('flex min-w-0 flex-1 flex-col gap-1 py-1', !expanded && 'max-sm:py-0')}>
        <p className="text-sm font-medium text-fg max-sm:hidden sm:truncate">{title}</p>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="flex min-w-0 items-center gap-1 text-left text-[13px] leading-4 font-medium text-fg sm:hidden"
        >
          <span className={cn(!expanded && 'line-clamp-2')}>{title}</span>
          <Icon
            name="chevronRight"
            size={16}
            className={cn(
              'shrink-0 text-fg-subtle transition-transform',
              expanded ? '-rotate-90' : 'rotate-90',
            )}
          />
          <span className="sr-only">{expanded ? 'Details ausblenden' : 'Details anzeigen'}</span>
        </button>
        <div className={cn('flex flex-col gap-1', !expanded && 'max-sm:hidden')}>
          <p className="text-xs leading-4 text-fg-muted">{error.message}</p>
          <p className="truncate text-[11px] text-fg-subtle" title={formatDateTime(error.at)}>
            Du siehst weiterhin Version {revisionNumber} · {relativeOrJustNow(error.at)}
          </p>
        </div>
        {actions}
      </div>
      {/* Phones, collapsed: the one action that fixes it, next to the title. */}
      {!expanded && (login || canRetry) && (
        <div className="shrink-0 sm:hidden">
          {login ? (
            <Button size="sm" onClick={signIn}>
              Anmelden
            </Button>
          ) : (
            <IconButton
              icon="sync"
              label="Erneut versuchen"
              size="sm"
              disabled={syncDeck.isPending}
              onClick={retry}
            />
          )}
        </div>
      )}
      <IconButton icon="close" label="Hinweis schließen" size="sm" onClick={dismiss} />
    </section>
  );
}
