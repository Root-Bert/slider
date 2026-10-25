import type {
  BillingRedirect,
  BillingTransferAcceptResult,
  WorkspaceUsageDetails,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiRequest } from '../api-client';
import { queryKeys, workspaceKeys } from './keys';

/**
 * Plan, storage and billing of a workspace (BER-151..155). Checkout and the customer portal
 * are Stripe pages: their mutations answer a `url` to send the browser to.
 */

/** "Nutzung" of one workspace (any member). `refetchInterval` while a payment is landing. */
export const useWorkspaceUsage = (
  workspaceId: string | null,
  options: { refetchInterval?: number | false } = {},
) =>
  useQuery({
    queryKey: workspaceKeys.usage(workspaceId ?? ''),
    queryFn: () => api.get<WorkspaceUsageDetails>(`/workspaces/${workspaceId}/usage`),
    enabled: Boolean(workspaceId),
    refetchInterval: options.refetchInterval,
  });

/**
 * A billing change also changes `Workspace.billing`/`plan`/`locked` from `GET /me` (header
 * banner, disabled buttons): the usage answer is stored, `me` reloaded.
 */
function useStoreUsage() {
  const queryClient = useQueryClient();
  return (details: WorkspaceUsageDetails) => {
    queryClient.setQueryData(workspaceKeys.usage(details.workspaceId), details);
    return queryClient.invalidateQueries({ queryKey: queryKeys.me });
  };
}

/** Billing owner: Stripe Checkout to upgrade (or add a payment method after a handover). */
export const useStartCheckout = (workspaceId: string) =>
  useMutation({
    mutationFn: () => api.post<BillingRedirect>(`/workspaces/${workspaceId}/billing/checkout`),
  });

/** Billing owner: Stripe's customer portal (payment method, invoices, cancel). */
export const useOpenBillingPortal = (workspaceId: string) =>
  useMutation({
    mutationFn: () => api.post<BillingRedirect>(`/workspaces/${workspaceId}/billing/portal`),
  });

/** Billing owner asks another admin to pay from now on (free workspace: at once). */
export function useRequestBillingTransfer(workspaceId: string) {
  const store = useStoreUsage();
  return useMutation({
    mutationFn: (userId: string) =>
      api.post<WorkspaceUsageDetails>(`/workspaces/${workspaceId}/billing/transfer`, { userId }),
    onSuccess: store,
  });
}

/** The billing owner withdraws the request, or the asked admin declines it. */
export function useCancelBillingTransfer(workspaceId: string) {
  const store = useStoreUsage();
  return useMutation({
    mutationFn: () =>
      apiRequest<WorkspaceUsageDetails>(`/workspaces/${workspaceId}/billing/transfer`, {
        method: 'DELETE',
      }),
    onSuccess: store,
  });
}

/** The asked admin takes over: `url` is the checkout for their payment method, `null` = done. */
export function useAcceptBillingTransfer(workspaceId: string) {
  const store = useStoreUsage();
  return useMutation({
    mutationFn: () =>
      api.post<BillingTransferAcceptResult>(`/workspaces/${workspaceId}/billing/transfer/accept`),
    onSuccess: (result) => store(result.details),
  });
}
