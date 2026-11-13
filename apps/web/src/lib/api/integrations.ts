import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddIntegrationKeyInput,
  AiModelList,
  IntegrationKind,
  IntegrationRule,
  Integrations,
  SetInheritedModelInput,
  UpdateIntegrationKeyInput,
  UpdateWorkspaceAiInput,
} from '@slider/shared';
import { api, apiRequest } from '../api-client';
import { queryKeys, workspaceKeys } from './keys';

// ── Integrations (AI models, speech to text, photos) ─────────────────────

/** A workspace's integrations, or the instance's (`null`). */
const base = (workspaceId: string | null) =>
  workspaceId ? `/workspaces/${workspaceId}/integrations` : '/instance/integrations';

export const useIntegrations = (workspaceId: string | null, enabled = true) =>
  useQuery({
    queryKey: workspaceKeys.integrations(workspaceId),
    queryFn: () => api.get<Integrations>(base(workspaceId)),
    enabled,
  });

/** The models a stored key may run on – asked of its service when the picker opens. */
export const useIntegrationModels = (workspaceId: string | null, keyId: string, enabled: boolean) =>
  useQuery({
    queryKey: [...workspaceKeys.integrations(workspaceId), 'models', keyId],
    queryFn: () => api.get<AiModelList>(`${base(workspaceId)}/keys/${keyId}/models`),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

/** The models the instance's key offers – for a workspace the instance lets pick one. */
export const useInheritedModels = (
  workspaceId: string | null,
  kind: IntegrationKind,
  enabled: boolean,
) =>
  useQuery({
    queryKey: [...workspaceKeys.integrations(workspaceId), 'instance-models', kind],
    queryFn: () =>
      api.get<AiModelList>(`/workspaces/${workspaceId}/integrations/instance/${kind}/models`),
    enabled: enabled && workspaceId !== null,
    staleTime: 5 * 60_000,
    retry: false,
  });

/**
 * After a change: the answer is the place's new state; the instance's change what every
 * workspace inherits, and whether decks show the AI.
 */
function useSettle(workspaceId: string | null) {
  const queryClient = useQueryClient();
  return (integrations: Integrations) => {
    queryClient.setQueryData(workspaceKeys.integrations(workspaceId), integrations);
    if (!workspaceId) {
      void queryClient.invalidateQueries({
        queryKey: ['integrations'],
        predicate: (query) => query.queryKey[1] !== 'instance',
      });
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.decks });
  };
}

/** Names the workspace's AI; open decks show the new name once they load again. */
export function useUpdateWorkspaceAi(workspaceId: string) {
  const settle = useSettle(workspaceId);
  return useMutation({
    mutationFn: (input: UpdateWorkspaceAiInput) =>
      api.patch<Integrations>(`/workspaces/${workspaceId}/ai`, input),
    onSuccess: settle,
  });
}

export function useAddIntegrationKey(workspaceId: string | null) {
  const settle = useSettle(workspaceId);
  return useMutation({
    mutationFn: (input: AddIntegrationKeyInput) =>
      api.post<Integrations>(`${base(workspaceId)}/keys`, input),
    onSuccess: settle,
  });
}

export function useUpdateIntegrationKey(workspaceId: string | null) {
  const settle = useSettle(workspaceId);
  return useMutation({
    mutationFn: ({ keyId, ...input }: UpdateIntegrationKeyInput & { keyId: string }) =>
      api.patch<Integrations>(`${base(workspaceId)}/keys/${keyId}`, input),
    onSuccess: settle,
  });
}

export function useRemoveIntegrationKey(workspaceId: string | null) {
  const settle = useSettle(workspaceId);
  return useMutation({
    mutationFn: (keyId: string) =>
      apiRequest<Integrations>(`${base(workspaceId)}/keys/${keyId}`, { method: 'DELETE' }),
    onSuccess: settle,
  });
}

/**
 * The model a workspace runs the instance's key on, or (AI) creates decks on; `null`: the
 * instance's.
 */
export function useSetInheritedModel(workspaceId: string | null) {
  const settle = useSettle(workspaceId);
  return useMutation({
    mutationFn: ({ kind, ...input }: SetInheritedModelInput & { kind: IntegrationKind }) =>
      api.put<Integrations>(
        `/workspaces/${workspaceId}/integrations/instance/${kind}/model`,
        input,
      ),
    onSuccess: settle,
  });
}

/**
 * The instance admin's rule of a kind – for all workspaces (`workspaceId` `null`), or for one
 * apart; `rule` `null` gives that one back to the rule for all.
 */
export function useSetIntegrationPolicy() {
  const settle = useSettle(null);
  return useMutation({
    mutationFn: ({
      kind,
      ...input
    }: {
      kind: IntegrationKind;
      workspaceId: string | null;
      rule: IntegrationRule | null;
      /** A workspace apart: the model of the instance's active key there; `null` its own. */
      model?: string | null;
      /** A workspace apart (AI): the model it creates decks on there; `null` the key's own. */
      createModel?: string | null;
      /** A workspace apart (AI): the model of quick requests there; `null` the key's own. */
      quickModel?: string | null;
    }) => api.patch<Integrations>(`/instance/integrations/${kind}`, input),
    onSuccess: settle,
  });
}
