import {
  API_PREFIX,
  type CloudBatchResult,
  type CloudNode,
  type CreateWriterAiProposalInput,
  type CreateWriterCommentInput,
  type CreateWriterDocumentInput,
  type UpdateWriterCommentInput,
  type WriterAiProposal,
  type WriterComment,
  type WriterDocument,
  type WriterEditInput,
  type WriterEditResult,
  type WriterOpened,
  type WriterTools,
  type CommentReactionKind,
  type ImageCredit,
  type StockSearch,
  type WriterPresence,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountHeader, api, apiErrorFromText, unreachableError } from '../api-client';
import { cloudKeys } from './cloud';

/**
 * Writer – text documents. A document is a file in Cloud: its list, its text and its comments
 * are read here; renaming, deleting and restoring it are Cloud's own calls with its id, and
 * both apps' lists follow.
 */

export type DocumentScope = 'all' | 'trash';

export const writerKeys = {
  all: (workspaceId: string) => ['writer', workspaceId] as const,
  list: (workspaceId: string, scope: DocumentScope) => ['writer', workspaceId, scope] as const,
  document: (documentId: string) => ['writer-document', documentId] as const,
  comments: (documentId: string) => ['writer-comments', documentId] as const,
  aiProposals: (documentId: string) => ['writer-ai', documentId] as const,
};

const listPath = (workspaceId: string) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/documents`;
const documentPath = (documentId: string) => `/documents/${encodeURIComponent(documentId)}`;

export const useDocuments = (workspaceId: string, scope: DocumentScope = 'all', enabled = true) =>
  useQuery({
    queryKey: writerKeys.list(workspaceId, scope),
    queryFn: () =>
      api.get<WriterDocument[]>(
        `${listPath(workspaceId)}${scope === 'trash' ? '?scope=trash' : ''}`,
      ),
    enabled,
  });

/** The document with its text, read anew each time it is opened. */
export const fetchDocument = (documentId: string) =>
  api.get<WriterOpened>(documentPath(documentId));

export const useDocument = (documentId: string) =>
  useQuery({
    queryKey: writerKeys.document(documentId),
    queryFn: () => fetchDocument(documentId),
    // What is typed lives in the editor; the server's answer is the start, not a rival.
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

/** The bytes as the body – what `api.post` cannot send. */
async function postBytes<T>(path: string, body: Blob, contentType: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': contentType, ...accountHeader() },
      body,
    });
  } catch {
    throw unreachableError();
  }
  if (!response.ok) throw apiErrorFromText(response.status, await response.text());
  return (await response.json()) as T;
}

function useLists(workspaceId: string) {
  const queryClient = useQueryClient();
  return {
    queryClient,
    refresh: () => {
      void queryClient.invalidateQueries({ queryKey: cloudKeys.all(workspaceId) });
      return queryClient.invalidateQueries({ queryKey: writerKeys.all(workspaceId) });
    },
    /** `change` answers the row as it is now, or `null` to take it out of the list. */
    patch: (change: (document: WriterDocument) => WriterDocument | null) =>
      queryClient.setQueriesData<WriterDocument[]>(
        { queryKey: writerKeys.all(workspaceId) },
        (list) => list?.flatMap((document) => change(document) ?? []),
      ),
  };
}

export function useCreateDocument(workspaceId: string) {
  const { refresh } = useLists(workspaceId);
  return useMutation({
    mutationFn: (input: Omit<CreateWriterDocumentInput, 'workspaceId'>) =>
      api.post<WriterDocument>('/documents', { ...input, workspaceId }),
    onSuccess: refresh,
  });
}

/** A file brought along becomes a document. */
export function useImportDocument(workspaceId: string) {
  const { refresh } = useLists(workspaceId);
  return useMutation({
    mutationFn: (file: File) =>
      postBytes<WriterDocument>(
        `${listPath(workspaceId)}/import?name=${encodeURIComponent(file.name)}`,
        file,
        'application/octet-stream',
      ),
    onSuccess: refresh,
  });
}

/** A new name: the title, kept as the file's name – with the file's own ending (`.odt`, `.md`). */
export function useRenameDocument(workspaceId: string) {
  const { patch, refresh } = useLists(workspaceId);
  const named = (title: string, fileName: string) =>
    `${title}.${/\.([^.]+)$/.exec(fileName)?.[1] ?? 'odt'}`;
  return useMutation({
    mutationFn: ({ id, title, fileName }: { id: string; title: string; fileName: string }) =>
      api.patch<CloudNode>(`/cloud/nodes/${id}`, { name: named(title, fileName) }),
    onMutate: ({ id, title, fileName }) =>
      patch((document) =>
        document.id === id ? { ...document, title, fileName: named(title, fileName) } : document,
      ),
    onSettled: refresh,
  });
}

/** Into „Gelöscht“ – the rows leave their list at once. */
export function useTrashDocuments(workspaceId: string) {
  const { patch, refresh } = useLists(workspaceId);
  return useMutation({
    mutationFn: (ids: string[]) => api.post<CloudBatchResult>('/cloud/nodes/trash', { ids }),
    onMutate: (ids) => patch((document) => (ids.includes(document.id) ? null : document)),
    onSettled: refresh,
  });
}

export function useRestoreDocuments(workspaceId: string) {
  const { patch, refresh } = useLists(workspaceId);
  return useMutation({
    mutationFn: (ids: string[]) => api.post<CloudBatchResult>('/cloud/nodes/restore', { ids }),
    onMutate: (ids) =>
      patch((document) => (ids.includes(document.id) && document.deletedAt ? null : document)),
    onSettled: refresh,
  });
}

/** Gone for good. */
export function usePurgeDocuments(workspaceId: string) {
  const { patch, refresh } = useLists(workspaceId);
  return useMutation({
    mutationFn: (ids: string[]) => api.post<CloudBatchResult>('/cloud/nodes/purge', { ids }),
    onMutate: (ids) =>
      patch((document) => (ids.includes(document.id) && document.deletedAt ? null : document)),
    onSettled: refresh,
  });
}

// ── In the open document ────────────────────────────────────────────────────

export const sendDocumentEdit = (documentId: string, input: WriterEditInput) =>
  api.post<WriterEditResult>(`${documentPath(documentId)}/edits`, input);

export const uploadDocumentPicture = (documentId: string, file: Blob) =>
  postBytes<{ path: string }>(`${documentPath(documentId)}/pictures`, file, file.type);

/** Photos of the workspace's photo service for a search, as for a slide; empty: at random. */
export const useDocumentPhotos = (documentId: string, query: string) =>
  useQuery({
    queryKey: ['documents', documentId, 'stock', query.trim().toLowerCase()],
    queryFn: () =>
      api.get<StockSearch>(
        `${documentPath(documentId)}/stock/photos?${new URLSearchParams({ q: query.trim() })}`,
      ),
    // One letter is no search yet.
    enabled: query.trim().length !== 1,
    staleTime: 10 * 60_000,
  });

/** The workspace's services the picture panel offers, as on a slide. */
export const useDocumentTools = (documentId: string, enabled: boolean) =>
  useQuery({
    queryKey: ['documents', documentId, 'tools'],
    queryFn: () => api.get<WriterTools>(`${documentPath(documentId)}/tools`),
    enabled,
    staleTime: 5 * 60_000,
  });

/** A picture made by the AI from a description: put into the file, its path and size. */
export const generateDocumentPicture = (documentId: string, prompt: string) =>
  api.post<{ path: string; width: number; height: number }>(
    `${documentPath(documentId)}/pictures/generate`,
    { prompt, aspect: null },
  );

/** A photo picked: put into the file, its path and size for `insertPicture`. */
export const pickDocumentPhoto = (documentId: string, photoId: string) =>
  api.post<{ path: string; width: number; height: number; credit: ImageCredit }>(
    `${documentPath(documentId)}/stock/photos/${encodeURIComponent(photoId)}`,
    {},
  );

export const documentPictureUrl = (documentId: string, path: string) =>
  `${API_PREFIX}${documentPath(documentId)}/pictures?path=${encodeURIComponent(path)}`;

/** The file itself, as any office program opens it. */
export const documentFilePath = (documentId: string) =>
  `/cloud/nodes/${documentId}/content?download=1`;
/** Its small picture in a list; a new version is a new address. */
export const documentThumbnailUrl = (document: Pick<WriterDocument, 'id' | 'versionId'>) =>
  `${API_PREFIX}/cloud/nodes/${document.id}/thumbnail?v=${document.versionId ?? ''}`;
/** What happens in it while it is open (an event stream): steps, comments, who else is there. */
export const documentLiveUrl = (documentId: string) =>
  `${API_PREFIX}${documentPath(documentId)}/live`;

export const fetchDocumentComments = (documentId: string) =>
  api.get<WriterComment[]>(`${documentPath(documentId)}/comments`);
export const createDocumentComment = (documentId: string, input: CreateWriterCommentInput) =>
  api.post<WriterComment>(`${documentPath(documentId)}/comments`, input);
export const updateDocumentComment = (commentId: string, input: UpdateWriterCommentInput) =>
  api.patch<WriterComment>(`/document-comments/${commentId}`, input);
export const setDocumentCommentReaction = (commentId: string, kind: CommentReactionKind | null) =>
  api.put<WriterComment>(`/document-comments/${commentId}/reaction`, { kind });
export const deleteDocumentComment = (commentId: string) =>
  api.delete(`/document-comments/${commentId}`);

// A comment handed to the AI, and what came of it under that comment.
export const fetchDocumentAiProposals = (documentId: string) =>
  api.get<WriterAiProposal[]>(`${documentPath(documentId)}/ai-proposals`);
export const createDocumentAiProposal = (documentId: string, input: CreateWriterAiProposalInput) =>
  api.post<WriterAiProposal>(`${documentPath(documentId)}/ai-proposals`, input);
export const stopDocumentAiProposal = (proposalId: string) =>
  api.post<WriterAiProposal>(`/document-ai-proposals/${proposalId}/stop`, {});
export const moveDocumentAiProposal = (proposalId: string, action: 'revert' | 'reapply') =>
  api.post<WriterAiProposal>(`/document-ai-proposals/${proposalId}/${action}`, {});

/** Where my caret stands in the document, for the others who have it open. */
export const sendDocumentPresence = (documentId: string, sel: WriterPresence['sel']) =>
  api.post<void>(`${documentPath(documentId)}/presence`, { sel });
