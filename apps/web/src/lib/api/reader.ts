import {
  API_PREFIX,
  type CloudBatchResult,
  type CloudNode,
  type CreateReaderAiProposalInput,
  type CreateReaderCommentInput,
  type CreateReaderSignatureInput,
  type ReaderAiProposal,
  type ReaderComment,
  type ReaderMark,
  type ReaderMarkBody,
  type ReaderOpened,
  type ReaderPdf,
  type ReaderSignature,
  type UpdateReaderCommentInput,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountHeader, api, apiErrorFromText, unreachableError } from '../api-client';
import { cloudKeys } from './cloud';

/**
 * Reader – PDFs. A PDF is a file in Cloud: its list, what is filled in on it and its comments
 * are read here; renaming, deleting and restoring it are Cloud's own calls with its id.
 */

export type PdfScope = 'all' | 'trash';

export const readerKeys = {
  all: (workspaceId: string) => ['reader', workspaceId] as const,
  list: (workspaceId: string, scope: PdfScope) => ['reader', workspaceId, scope] as const,
  pdf: (pdfId: string) => ['reader-pdf', pdfId] as const,
  signatures: () => ['reader-signatures'] as const,
};

const listPath = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/pdfs`;
const pdfPath = (pdfId: string) => `/pdfs/${encodeURIComponent(pdfId)}`;

export const usePdfs = (workspaceId: string, scope: PdfScope = 'all', enabled = true) =>
  useQuery({
    queryKey: readerKeys.list(workspaceId, scope),
    queryFn: () =>
      api.get<ReaderPdf[]>(`${listPath(workspaceId)}${scope === 'trash' ? '?scope=trash' : ''}`),
    enabled,
  });

export const fetchPdf = (pdfId: string) => api.get<ReaderOpened>(pdfPath(pdfId));

export const usePdf = (pdfId: string) =>
  useQuery({
    queryKey: readerKeys.pdf(pdfId),
    queryFn: () => fetchPdf(pdfId),
    // What is filled in lives in the page; the server's answer is the start, not a rival.
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

async function send(path: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: { Accept: 'application/json', ...accountHeader(), ...init.headers },
    });
  } catch {
    throw unreachableError();
  }
  if (!response.ok) throw apiErrorFromText(response.status, await response.text());
  return response;
}

function useLists(workspaceId: string) {
  const queryClient = useQueryClient();
  return {
    refresh: () => {
      void queryClient.invalidateQueries({ queryKey: cloudKeys.all(workspaceId) });
      return queryClient.invalidateQueries({ queryKey: readerKeys.all(workspaceId) });
    },
    patch: (change: (pdf: ReaderPdf) => ReaderPdf | null) =>
      queryClient.setQueriesData<ReaderPdf[]>({ queryKey: readerKeys.all(workspaceId) }, (list) =>
        list?.flatMap((pdf) => change(pdf) ?? []),
      ),
  };
}

/** A PDF brought along lies in one's own files („Meine Dateien“). */
export function useImportPdf(workspaceId: string) {
  const { refresh } = useLists(workspaceId);
  return useMutation({
    mutationFn: async (file: File) =>
      (await (
        await send(`${listPath(workspaceId)}/import?name=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/pdf' },
          body: file,
        })
      ).json()) as ReaderPdf,
    onSuccess: refresh,
  });
}

export function useRenamePdf(workspaceId: string) {
  const { patch, refresh } = useLists(workspaceId);
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.patch<CloudNode>(`/cloud/nodes/${id}`, { name: `${title}.pdf` }),
    onMutate: ({ id, title }) =>
      patch((pdf) => (pdf.id === id ? { ...pdf, title, fileName: `${title}.pdf` } : pdf)),
    onSettled: refresh,
  });
}

export function useTrashPdfs(workspaceId: string) {
  const { patch, refresh } = useLists(workspaceId);
  return useMutation({
    mutationFn: (ids: string[]) => api.post<CloudBatchResult>('/cloud/nodes/trash', { ids }),
    onMutate: (ids) => patch((pdf) => (ids.includes(pdf.id) ? null : pdf)),
    onSettled: refresh,
  });
}

export function useRestorePdfs(workspaceId: string) {
  const { patch, refresh } = useLists(workspaceId);
  return useMutation({
    mutationFn: (ids: string[]) => api.post<CloudBatchResult>('/cloud/nodes/restore', { ids }),
    onMutate: (ids) => patch((pdf) => (ids.includes(pdf.id) && pdf.deletedAt ? null : pdf)),
    onSettled: refresh,
  });
}

export function usePurgePdfs(workspaceId: string) {
  const { patch, refresh } = useLists(workspaceId);
  return useMutation({
    mutationFn: (ids: string[]) => api.post<CloudBatchResult>('/cloud/nodes/purge', { ids }),
    onMutate: (ids) => patch((pdf) => (ids.includes(pdf.id) && pdf.deletedAt ? null : pdf)),
    onSettled: refresh,
  });
}

// ── In the open PDF ─────────────────────────────────────────────────────────

/** The file as it lies in Cloud, for pdf.js. */
export const pdfFileUrl = (pdfId: string) => `${API_PREFIX}${pdfPath(pdfId)}/file`;
/** With everything filled in baked in – printed and exported. */
export const pdfExportPath = (pdfId: string) => `${pdfPath(pdfId)}/export`;
export const fetchPdfExport = async (pdfId: string): Promise<ArrayBuffer> =>
  (await send(pdfExportPath(pdfId), { headers: { Accept: 'application/pdf' } })).arrayBuffer();
export const pdfThumbnailUrl = (pdf: Pick<ReaderPdf, 'id' | 'versionId'>) =>
  `${API_PREFIX}/cloud/nodes/${pdf.id}/thumbnail?v=${pdf.versionId ?? ''}`;
export const pdfLiveUrl = (pdfId: string) => `${API_PREFIX}${pdfPath(pdfId)}/live`;

export const putPdfMark = (pdfId: string, id: string, body: ReaderMarkBody) =>
  api.put<ReaderMark>(`${pdfPath(pdfId)}/marks/${encodeURIComponent(id)}`, body);
export const deletePdfMark = (pdfId: string, id: string) =>
  api.delete(`${pdfPath(pdfId)}/marks/${encodeURIComponent(id)}`);

export const useSignatures = () =>
  useQuery({
    queryKey: readerKeys.signatures(),
    queryFn: () => api.get<ReaderSignature[]>('/reader/signatures'),
  });
export function useSaveSignature() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReaderSignatureInput) =>
      api.post<ReaderSignature>('/reader/signatures', input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: readerKeys.signatures() }),
  });
}
export function useDeleteSignature() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/reader/signatures/${id}`),
    onMutate: (id) =>
      queryClient.setQueryData<ReaderSignature[]>(readerKeys.signatures(), (list) =>
        list?.filter((each) => each.id !== id),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: readerKeys.signatures() }),
  });
}

export const fetchPdfComments = (pdfId: string) =>
  api.get<ReaderComment[]>(`${pdfPath(pdfId)}/comments`);
export const createPdfComment = (pdfId: string, input: CreateReaderCommentInput) =>
  api.post<ReaderComment>(`${pdfPath(pdfId)}/comments`, input);
export const updatePdfComment = (commentId: string, input: UpdateReaderCommentInput) =>
  api.patch<ReaderComment>(`/pdf-comments/${commentId}`, input);
export const deletePdfComment = (commentId: string) => api.delete(`/pdf-comments/${commentId}`);

export const fetchPdfAiProposals = (pdfId: string) =>
  api.get<ReaderAiProposal[]>(`${pdfPath(pdfId)}/ai-proposals`);
export const createPdfAiProposal = (pdfId: string, input: CreateReaderAiProposalInput) =>
  api.post<ReaderAiProposal>(`${pdfPath(pdfId)}/ai-proposals`, input);
export const stopPdfAiProposal = (proposalId: string) =>
  api.post<ReaderAiProposal>(`/pdf-ai-proposals/${proposalId}/stop`, {});
export const movePdfAiProposal = (proposalId: string, action: 'revert' | 'reapply') =>
  api.post<ReaderAiProposal>(`/pdf-ai-proposals/${proposalId}/${action}`, {});
