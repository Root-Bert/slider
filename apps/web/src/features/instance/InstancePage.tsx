import { useState } from 'react';
import { INSTANCE_INTERVALS } from '@slider/shared';
import { accentColor } from '@/lib/accent';
import { routes } from '@/lib/routes';
import {
  timelineQuery,
  useInstanceHistory,
  useInstanceOverview,
  useInstanceTimeline,
} from '@/lib/api';
import { SettingsLayout } from '@/shell/layouts/SettingsLayout';
import { useAccount } from '@/features/auth';
import { ButtonLink, ErrorText, LoadingState, Notice, SegmentedControl, useToast } from '@/ui';
import { DirectoryCard } from './components/DirectoryCard';
import { GrowthChart } from './components/GrowthChart';
import { HistoryStrip } from './components/HistoryStrip';
import { ActivityCard, LargestCard, StatusCard, StorageCard } from './components/InsightCards';
import { KpiTile } from './components/KpiTile';
import { useSidewaysWheel } from './hooks/useSidewaysWheel';
import { useThrottled } from './hooks/useThrottled';
import { useTimeWindow } from './hooks/useTimeWindow';
import {
  formatCount,
  INTERVAL_SEGMENTS,
  intervalPhrase,
  stretchHoursOf,
  type Metric,
} from './lib/period';

/** While the window moves, its numbers are fetched at most this often – they follow it live. */
const WINDOW_THROTTLE_MS = 120;
/** How often the numbers refresh by themselves while the window follows the time. */
const LIVE_REFRESH_MS = 30_000;

/**
 * `/instanz` – the instance admin's dashboard (BER-167). Headline tiles, what was created over
 * time – in a window whose width is chosen above and whose place is moved on the history strip
 * under the chart – storage, activity, plans and the largest workspaces; then the directory
 * of workspaces and accounts, to block one or to grant a workspace Paid without Stripe.
 * Workspaces never show what is in them. Logins, mail and legal texts stay on `/einrichtung`.
 */
export function Component() {
  const { user } = useAccount();
  const [toast, showToast] = useToast();
  const [metric, setMetric] = useState<Metric>('users');
  const history = useInstanceHistory();
  const view = useTimeWindow(history.data ? Date.parse(history.data.from) : undefined);
  // Following the time, the numbers keep up by themselves: a new account shows within moments.
  const refresh = { refetchInterval: view.live ? LIVE_REFRESH_MS : (false as const) };
  const overview = useInstanceOverview(refresh);
  const timeline = useInstanceTimeline(
    useThrottled(timelineQuery(view.interval, view.end), WINDOW_THROTTLE_MS),
    refresh,
  );
  // Over the chart, the line goes along with the fingers.
  const chartRef = useSidewaysWheel<HTMLDivElement>((px, width) =>
    view.pan((px / width) * view.windowMs),
  );
  const data = overview.data;
  const buckets = timeline.data?.buckets;
  const trend = (key: Metric) => buckets?.map((bucket) => bucket[key]);
  const added = (key: Metric) =>
    buckets &&
    `+${formatCount(buckets.reduce((sum, bucket) => sum + bucket[key], 0))} ${
      view.live ? intervalPhrase(view.interval) : 'im Zeitraum'
    }`;
  const share = (part: number, whole: number) =>
    `${whole > 0 ? Math.round((part / whole) * 100) : 0} %`;
  const error = overview.error ?? timeline.error;

  return (
    <SettingsLayout
      docTitle="Instanz | Slider"
      title="Instanz"
      subtitle={window.location.host}
      back={{ to: routes.reviews() }}
      logoLink={{ to: routes.instance(), label: 'Instanz-Dashboard' }}
      width="wide"
      toast={toast}
      actions={
        user.isInstanceAdmin && (
          <ButtonLink
            to={routes.setup()}
            variant="secondary"
            size="sm"
            icon="settings"
            iconSize={16}
          >
            Instanz-Einstellungen
          </ButtonLink>
        )
      }
    >
      {!user.isInstanceAdmin ? (
        <Notice tone="warning" variant="tinted" title="Nur für den Instanz-Admin">
          Diese Seite sieht nur die Person, die Slider hier betreibt.
        </Notice>
      ) : (
        <>
          {/* The window's width scopes everything created over time; one row, above the charts. */}
          <SegmentedControl
            label="Zeitraum"
            size="md"
            track="soft"
            segments={INTERVAL_SEGMENTS}
            value={view.interval}
            onChange={view.chooseInterval}
            className="self-start"
          />
          {error ? (
            <ErrorText role="alert">{error.message}</ErrorText>
          ) : !data || !timeline.data ? (
            <LoadingState padding="lg" />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <KpiTile
                  label="Personen"
                  value={formatCount(data.users.total)}
                  delta={added('users')}
                  trend={trend('users')}
                />
                <KpiTile
                  label="Aktiv in 30 Tagen"
                  value={formatCount(data.users.active)}
                  delta={`${share(data.users.active, data.users.total)} aller Personen`}
                />
                <KpiTile
                  label="Workspaces"
                  value={formatCount(data.workspaces.total)}
                  delta={added('workspaces')}
                  trend={trend('workspaces')}
                />
                <KpiTile
                  label="Reviews"
                  value={formatCount(data.decks)}
                  delta={added('decks')}
                  trend={trend('decks')}
                />
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <div ref={chartRef} className="lg:col-span-2">
                  <GrowthChart
                    timeline={timeline.data.buckets}
                    // From the answer itself: while the next width loads, the last one still shows.
                    stretchHours={stretchHoursOf(
                      timeline.data.buckets,
                      INSTANCE_INTERVALS[view.interval].stretchHours,
                    )}
                    view={{
                      from: Date.parse(timeline.data.from),
                      to: Date.parse(timeline.data.to),
                      live: view.live,
                      phrase: intervalPhrase(view.interval),
                    }}
                    metric={metric}
                    onMetricChange={setMetric}
                    accent={accentColor(user.color)}
                  >
                    {history.data && (
                      <HistoryStrip history={history.data} metric={metric} view={view} />
                    )}
                  </GrowthChart>
                </div>
                <StorageCard overview={data} />
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <ActivityCard overview={data} />
                <StatusCard overview={data} />
                <LargestCard overview={data} />
              </div>
            </div>
          )}
          <DirectoryCard plans={data?.plans ?? false} userId={user.id} onNotify={showToast} />
        </>
      )}
    </SettingsLayout>
  );
}
