import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { routes } from '@/lib/routes';
import { queryKeys, useWorkspaceUsage } from '@/lib/api';
import { SettingsLayout } from '@/shell/layouts/SettingsLayout';
import { useAccount } from '@/features/auth';
import { pickWorkspace, readLastWorkspaceId, UsageOverview } from '@/features/workspaces';
import { ErrorText, Icon, LoadingState, Section, Select, useToast } from '@/ui';

/** After paying, Stripe's webhook may land a moment after the browser: ask again this often… */
const CHECKOUT_POLL_MS = 2000;
/** …for this long at most. */
const CHECKOUT_POLL_FOR_MS = 10_000;

/**
 * `/nutzung` – "Nutzung" (BER-151..155): plan, limits, storage and billing of one workspace.
 * `?workspace=<id>` picks it (else the last used one, else the first); Stripe's checkout and
 * customer portal come back here, with `&checkout=success` after paying. Older links (mails,
 * Stripe) still say `?organisation=<id>`.
 */
export function Component() {
  const { user, workspaces } = useAccount();
  const [toast, showToast] = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  // Asked for by name, a workspace shows even when blocked (BER-167): whoever pays for it
  // can still manage or cancel the payment. Otherwise the last used open one.
  const requested = searchParams.get('workspace') ?? searchParams.get('organisation');
  const workspace =
    workspaces.find((candidate) => candidate.id === requested) ??
    pickWorkspace(workspaces, readLastWorkspaceId());
  const [paidJustNow] = useState(() => searchParams.get('checkout') === 'success');
  const [polling, setPolling] = useState(paidJustNow);
  const [upgraded, setUpgraded] = useState(false);
  // Asks again until the plan arrived or waiting is over.
  const waiting = polling && !upgraded;
  const usage = useWorkspaceUsage(workspace?.id ?? null, {
    refetchInterval: waiting ? CHECKOUT_POLL_MS : false,
  });
  const queryClient = useQueryClient();
  if (!upgraded && usage.data?.plan === 'paid') setUpgraded(true);

  // Back from Stripe: thank once and drop the flag, so a reload doesn't thank again.
  const thanked = useRef(false);
  useEffect(() => {
    if (!paidJustNow || thanked.current) return;
    thanked.current = true;
    showToast('Danke! Die Zahlung ist eingegangen.');
    setSearchParams(
      (params) => {
        params.delete('checkout');
        return params;
      },
      { replace: true },
    );
  }, [paidJustNow, showToast, setSearchParams]);
  useEffect(() => {
    if (!paidJustNow) return;
    const timer = window.setTimeout(() => setPolling(false), CHECKOUT_POLL_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [paidJustNow]);

  // Done waiting: the header banner and the buttons elsewhere read the plan from `me`.
  useEffect(() => {
    if (paidJustNow && !waiting) void queryClient.invalidateQueries({ queryKey: queryKeys.me });
  }, [paidJustNow, waiting, queryClient]);

  return (
    <SettingsLayout
      docTitle="Nutzung | Slider"
      title="Nutzung"
      leading={<Icon name="cloud" size={32} className="text-fg-muted" />}
      back={{ to: workspace ? routes.workspace(workspace.id) : routes.reviews() }}
      toast={toast}
    >
      {!workspace ? (
        <Section title="Kein Workspace" description="Du bist in keinem Workspace." />
      ) : (
        <>
          {workspaces.length > 1 && (
            <Select<string>
              aria-label="Workspace"
              value={workspace.id}
              onChange={(id) => setSearchParams({ workspace: id })}
              options={workspaces.map((each) => ({ value: each.id, label: each.name }))}
              className="self-start sm:min-w-[280px]"
            />
          )}
          {usage.isPending ? (
            <LoadingState padding="lg" />
          ) : usage.isError ? (
            <ErrorText role="alert">{usage.error.message}</ErrorText>
          ) : (
            <UsageOverview
              key={workspace.id}
              workspace={workspace}
              details={usage.data}
              userId={user.id}
              onNotify={showToast}
            />
          )}
        </>
      )}
    </SettingsLayout>
  );
}
