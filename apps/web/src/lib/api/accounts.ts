import {
  API_PREFIX,
  type CreateDataRequestInput,
  type DataRequestInfo,
  type DeleteAccountInput,
  type SuccessorChoice,
} from '@slider/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, apiRequest } from '../api-client';
import { routes } from '../routes';

/**
 * Data rights: the own account's ZIP export and deletion on `/konto` (BER-145); without login,
 * a request on `/datenanfrage` mails a link to the address (BER-146).
 */

/** Download link of the own data (a plain GET: the browser saves the ZIP). */
export const ACCOUNT_EXPORT_URL = `${API_PREFIX}/me/export`;

/** Before deleting the own account: workspaces that need a new admin. */
export const useDeletionChoices = (enabled: boolean) =>
  useQuery({
    queryKey: ['me', 'deletion'],
    queryFn: () => api.get<SuccessorChoice[]>('/me/deletion'),
    enabled,
    staleTime: 0,
  });

/** Deletes the own account; afterwards the session is gone, so the caller leaves the app. */
export const useDeleteAccount = () =>
  useMutation({
    mutationFn: (input: DeleteAccountInput) =>
      apiRequest<void>('/me', { method: 'DELETE', body: input }),
    // The session is gone with the account: leave the app for the login page.
    onSuccess: () => window.location.assign(routes.login()),
  });

/** `/datenanfrage`: asks for the link to the given address (answer is the same either way). */
export const useCreateDataRequest = () =>
  useMutation({
    mutationFn: (input: CreateDataRequestInput) => api.post<{ ok: true }>('/data-requests', input),
  });

/** What a data request link (`/daten/:token`) leads to; no login needed. */
export const useDataRequest = (token: string) =>
  useQuery({
    queryKey: ['data-request', token],
    queryFn: () => api.get<DataRequestInfo>(`/data-requests/${encodeURIComponent(token)}`),
    retry: false,
    // Once confirmed the link is used up (a deleted account answers 404): a refetch on focus
    // would turn the confirmation into "Link nicht gültig".
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

export const dataRequestExportUrl = (token: string) =>
  `${API_PREFIX}/data-requests/${encodeURIComponent(token)}/export`;

/** Before confirming a deletion link: workspaces that need a new admin. */
export const useDataRequestSuccessors = (token: string, enabled: boolean) =>
  useQuery({
    queryKey: ['data-request', token, 'successors'],
    queryFn: () =>
      api.get<SuccessorChoice[]>(`/data-requests/${encodeURIComponent(token)}/successors`),
    enabled,
  });

/** Confirms a deletion (with the chosen new admins) or keeps an unused account. */
export const useConfirmDataRequest = () =>
  useMutation({
    mutationFn: ({
      token,
      action,
      successors = {},
    }: {
      token: string;
      action: 'delete' | 'keep';
      successors?: Record<string, string>;
    }) =>
      api.post<void>(
        `/data-requests/${encodeURIComponent(token)}/${action}`,
        action === 'delete' ? { successors } : undefined,
      ),
  });
