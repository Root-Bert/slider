import type {
  Deck,
  UpdateDeckTemplateInput,
  Author,
  CreatedWorkspaceInvite,
  CreateWorkspaceInviteInput,
  JoinPreview,
  JoinResult,
  MemberDeparture,
  UpdateWorkspaceSsoInput,
  Workspace,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceFont,
  WorkspaceFontUpload,
  WorkspaceMaster,
  WorkspaceSso,
} from '@slider/shared';
import { WORKSPACE_PRESENCE_POLL_MS } from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiRequest } from '../api-client';
import { queryKeys, workspaceKeys } from './keys';

// ── Workspaces ──────────────────────────────────────────────────────────────

function useReloadMe() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.me });
}

/** Joining or leaving a workspace changes the workspaces and the decks one can see ("Geteilt"). */
function useReloadMembership() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.me }),
      queryClient.invalidateQueries({ queryKey: queryKeys.deckLists }),
    ]);
}

export function useCreateWorkspace() {
  const reloadMe = useReloadMe();
  return useMutation({
    mutationFn: (name: string) => api.post<Workspace>('/workspaces', { name }),
    onSuccess: () => reloadMe(),
  });
}

export function useRenameWorkspace(workspaceId: string) {
  const reloadMe = useReloadMe();
  return useMutation({
    mutationFn: (name: string) => api.patch<Workspace>(`/workspaces/${workspaceId}`, { name }),
    onSuccess: () => reloadMe(),
  });
}

/** Admins only. `null` removes the logo (back to the landscape drawn from its name). */
export function useWorkspaceLogo(workspaceId: string) {
  const reloadMe = useReloadMe();
  return useMutation({
    mutationFn: (file: File | null) => {
      if (!file)
        return apiRequest<Workspace>(`/workspaces/${workspaceId}/logo`, { method: 'DELETE' });
      const body = new FormData();
      body.append('file', file);
      return apiRequest<Workspace>(`/workspaces/${workspaceId}/logo`, { method: 'PUT', body });
    },
    onSuccess: () => reloadMe(),
  });
}

// ── Fonts ──────────────────────────────────────────────────────────────────

/** Any deck's editor state (`queryKeys.edit`): it carries the workspace's fonts. */
const isEditState = ({ queryKey }: { queryKey: readonly unknown[] }) =>
  queryKey[0] === 'decks' && queryKey[2] === 'edit';

/** The workspace's own fonts: its decks are drawn in them. */
export const useWorkspaceFonts = (workspaceId: string) =>
  useQuery({
    queryKey: workspaceKeys.fonts(workspaceId),
    queryFn: () => api.get<WorkspaceFont[]>(`/workspaces/${workspaceId}/fonts`),
  });

/** Members and admins: TTF or OTF files, or zips of them; a face uploaded again is replaced. */
export function useUploadWorkspaceFonts(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (files: readonly File[]) => {
      const body = new FormData();
      for (const file of files) body.append('files', file);
      return apiRequest<WorkspaceFontUpload>(`/workspaces/${workspaceId}/fonts`, {
        method: 'POST',
        body,
      });
    },
    onSuccess: (upload) => {
      queryClient.setQueryData(workspaceKeys.fonts(workspaceId), upload.fonts);
      // The editor offers them and draws in them.
      void queryClient.invalidateQueries({ predicate: isEditState });
    },
  });
}

/** Members and admins: every face of a family. */
export function useRemoveWorkspaceFontFamily(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (family: string) =>
      apiRequest<WorkspaceFont[]>(
        `/workspaces/${workspaceId}/fonts?family=${encodeURIComponent(family)}`,
        { method: 'DELETE' },
      ),
    onSuccess: (fonts) => {
      queryClient.setQueryData(workspaceKeys.fonts(workspaceId), fonts);
      void queryClient.invalidateQueries({ predicate: isEditState });
    },
  });
}

// ── Slide masters ──────────────────────────────────────────────────────────

/** The workspace's slide masters: company designs with a picture of each layout. */
export const useWorkspaceMasters = (workspaceId: string, enabled = true) =>
  useQuery({
    queryKey: workspaceKeys.masters(workspaceId),
    queryFn: () => api.get<WorkspaceMaster[]>(`/workspaces/${workspaceId}/masters`),
    enabled,
  });

/** Members and admins: one design, a template (`.otp`, `.potx`); its layouts are drawn. */
export function useUploadWorkspaceMaster(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return apiRequest<WorkspaceMaster[]>(`/workspaces/${workspaceId}/masters`, {
        method: 'POST',
        body,
      });
    },
    onSuccess: (masters) => queryClient.setQueryData(workspaceKeys.masters(workspaceId), masters),
  });
}

/** Members and admins: a design's name in Slider. */
export function useRenameWorkspaceMaster(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ masterId, name }: { masterId: string; name: string }) =>
      api.patch<WorkspaceMaster[]>(`/workspaces/${workspaceId}/masters/${masterId}`, { name }),
    onSuccess: (masters) => queryClient.setQueryData(workspaceKeys.masters(workspaceId), masters),
  });
}

/** Members and admins: a template to design in the editor – a deck marked as one. */
export function useCreateTemplateDraft(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Deck>(`/workspaces/${workspaceId}/masters/draft`, {}),
    onSuccess: (deck) => {
      queryClient.setQueryData(queryKeys.deck(deck.id), deck);
      // In the library as it is made (the server saves it by itself from then on).
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.masters(workspaceId) });
    },
  });
}

/** Changes to a template being designed go one after another. */
export const templateScope = (deckId: string) => `deck-template:${deckId}`;

/** A template being designed: its layouts' names, placeholders and guides. */
export function useUpdateDeckTemplate(deckId: string) {
  const queryClient = useQueryClient();
  const mutationKey = ['deck-template', deckId];
  return useMutation({
    mutationKey,
    // One change after another, in the order made: typing „12“ never ends as 1.
    scope: { id: templateScope(deckId) },
    mutationFn: (input: UpdateDeckTemplateInput) =>
      api.patch<Deck>(`/decks/${deckId}/template`, input),
    onSuccess: (deck) => {
      // A change still to come is shown already – the server's answer would take it back.
      if (queryClient.isMutating({ mutationKey }) > 1) return;
      queryClient.setQueryData(queryKeys.deck(deckId), deck);
    },
  });
}

/** Admins only: a design with its file and pictures. */
export function useRemoveWorkspaceMaster(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (masterId: string) =>
      apiRequest<WorkspaceMaster[]>(`/workspaces/${workspaceId}/masters/${masterId}`, {
        method: 'DELETE',
      }),
    onSuccess: (masters) => queryClient.setQueryData(workspaceKeys.masters(workspaceId), masters),
  });
}

/**
 * Admins only (BER-148): `true` opens the workspace to the admin's e-mail domain, `false` makes
 * it private. Either answers the question after sign-up.
 */
export function useSetWorkspaceDomain(workspaceId: string) {
  const reloadMe = useReloadMe();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      api.put<Workspace>(`/workspaces/${workspaceId}/domain`, { enabled }),
    onSuccess: () => reloadMe(),
  });
}

/** Joins `me.domainWorkspace`, the company workspace of the viewer's domain. */
export function useJoinByDomain() {
  const reloadMembership = useReloadMembership();
  return useMutation({
    mutationFn: (workspaceId: string) =>
      api.post<JoinResult>(`/workspaces/${workspaceId}/domain-join`),
    onSuccess: () => reloadMembership(),
  });
}

// ── Company login (BER-162) ─────────────────────────────────────────────────

export const useWorkspaceSso = (workspaceId: string, enabled = true) =>
  useQuery({
    queryKey: workspaceKeys.sso(workspaceId),
    queryFn: () => api.get<WorkspaceSso>(`/workspaces/${workspaceId}/sso`),
    enabled,
  });

/** Saves the provider (`verify`: looks for the DNS record instead); answers the new state. */
export function useSaveWorkspaceSso(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateWorkspaceSsoInput | 'verify') =>
      input === 'verify'
        ? api.post<WorkspaceSso>(`/workspaces/${workspaceId}/sso/verify`)
        : api.put<WorkspaceSso>(`/workspaces/${workspaceId}/sso`, input),
    onSuccess: (sso) => queryClient.setQueryData(workspaceKeys.sso(workspaceId), sso),
  });
}

export function useDeleteWorkspaceSso(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/workspaces/${workspaceId}/sso`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.sso(workspaceId) }),
  });
}

export function useDeleteWorkspace(workspaceId: string) {
  const reloadMe = useReloadMembership();
  return useMutation({
    mutationFn: () => api.delete(`/workspaces/${workspaceId}`),
    onSuccess: () => reloadMe(),
  });
}

// ── Members ─────────────────────────────────────────────────────────────────

export const useMembers = (workspaceId: string) =>
  useQuery({
    queryKey: workspaceKeys.members(workspaceId),
    queryFn: () => api.get<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`),
  });

/**
 * The other members online right now. Polling is the heartbeat that keeps the viewer online for
 * the others too – only while the tab is visible (React Query pauses it in the background), so a
 * forgotten tab goes offline after a while. `null`: nobody to ask about (no workspace).
 */
export const useOnlineMembers = (workspaceId: string | null) =>
  useQuery({
    queryKey: workspaceKeys.online(workspaceId ?? ''),
    queryFn: () => api.post<Author[]>(`/workspaces/${workspaceId}/presence`),
    enabled: workspaceId !== null,
    refetchInterval: WORKSPACE_PRESENCE_POLL_MS,
    // A failed heartbeat is retried by the next one.
    retry: false,
  });

export function useUpdateMemberRole(workspaceId: string) {
  const queryClient = useQueryClient();
  const reloadMe = useReloadMe();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: WorkspaceRole }) =>
      api.patch<WorkspaceMember>(`/workspaces/${workspaceId}/members/${userId}`, { role }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) });
      // The caller's own role may have changed.
      void reloadMe();
    },
  });
}

/** Removes a member – or, with the caller's own id, leaves the workspace. */
export function useRemoveMember(workspaceId: string) {
  const queryClient = useQueryClient();
  const reloadMembership = useReloadMembership();
  return useMutation({
    /** `successor`: the last owner leaves and hands the workspace to this member. */
    mutationFn: ({ userId, successor }: { userId: string; successor?: string }) =>
      api.delete(
        `/workspaces/${workspaceId}/members/${userId}${successor ? `?successor=${encodeURIComponent(successor)}` : ''}`,
      ),
    // Awaited: after leaving, the start page must not pick the workspace just left.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) });
      // `me` and the deck lists: their linked reviews are gone, their uploads have a new owner
      // (BER-165).
      return reloadMembership();
    },
  });
}

/**
 * What happens to someone's reviews if they went now (BER-165): linked ones are deleted,
 * uploads pass to the workspace owner. For the warning before; `null` while nobody is asked.
 */
export const useMemberDeparture = (
  workspaceId: string,
  userId: string | null,
  successor?: string,
) =>
  useQuery({
    queryKey: workspaceKeys.departure(workspaceId, userId ?? '', successor ?? null),
    queryFn: () =>
      api.get<MemberDeparture>(
        `/workspaces/${workspaceId}/members/${userId ?? ''}/departure${successor ? `?successor=${encodeURIComponent(successor)}` : ''}`,
      ),
    enabled: userId !== null,
    // Asked fresh each time the dialog opens: reviews come and go.
    staleTime: 0,
    gcTime: 0,
  });

// ── Invitations ─────────────────────────────────────────────────────────────

export const useWorkspaceInvites = (workspaceId: string, enabled = true) =>
  useQuery({
    queryKey: workspaceKeys.invites(workspaceId),
    queryFn: () => api.get<WorkspaceInvite[]>(`/workspaces/${workspaceId}/invites`),
    enabled,
  });

export function useCreateWorkspaceInvite(workspaceId: string) {
  const queryClient = useQueryClient();
  const reloadMe = useReloadMe();
  return useMutation({
    mutationFn: (input: CreateWorkspaceInviteInput) =>
      api.post<CreatedWorkspaceInvite>(`/workspaces/${workspaceId}/invites`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.invites(workspaceId) });
      // E-mail invites hold a seat (`Workspace.usage`, BER-130).
      void reloadMe();
    },
  });
}

export function useRevokeWorkspaceInvite(workspaceId: string) {
  const queryClient = useQueryClient();
  const reloadMe = useReloadMe();
  return useMutation({
    mutationFn: (inviteId: string) => api.delete(`/workspace-invites/${inviteId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.invites(workspaceId) });
      // E-mail invites hold a seat (`Workspace.usage`, BER-130).
      void reloadMe();
    },
  });
}

/** Accepts an e-mail invitation listed in `me.pendingInvites`. */
export function useAcceptInvite() {
  const reloadMe = useReloadMembership();
  return useMutation({
    mutationFn: (inviteId: string) => api.post<JoinResult>(`/workspace-invites/${inviteId}/accept`),
    onSuccess: () => reloadMe(),
  });
}

export const useJoinPreview = (token: string) =>
  useQuery({
    queryKey: workspaceKeys.join(token),
    queryFn: () => api.get<JoinPreview>(`/join/${encodeURIComponent(token)}`),
    retry: false,
  });

export function useJoinWorkspace(token: string) {
  const reloadMe = useReloadMembership();
  return useMutation({
    mutationFn: () => api.post<JoinResult>(`/join/${encodeURIComponent(token)}`),
    onSuccess: () => reloadMe(),
  });
}
