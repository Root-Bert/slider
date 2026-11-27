import {
  API_PREFIX,
  type AskDiagramInput,
  type CreateDiagramInput,
  type DiagramAnswer,
  type DiagramFile,
  type DiagramOpened,
  type DiagramSaved,
  type SaveDiagramInput,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { cloudKeys } from './cloud';

/**
 * Diagrams – a Cloud file of their own (`.diagram`). Opened and saved whole here; renaming,
 * moving, deleting and versions are Cloud's own calls with its id.
 */

export const diagramKeys = {
  diagram: (diagramId: string) => ['diagram', diagramId] as const,
};

const diagramPath = (diagramId: string) => `/diagrams/${encodeURIComponent(diagramId)}`;

export const fetchDiagram = (diagramId: string) => api.get<DiagramOpened>(diagramPath(diagramId));

/**
 * The diagram as the file holds it. Read again each time it is shown (`refetchOnMount`); the
 * editor keeps it current with each save (`setQueryData`), so a preview shows it at once.
 */
export const useDiagram = (diagramId: string, enabled = true) =>
  useQuery({
    queryKey: diagramKeys.diagram(diagramId),
    queryFn: () => fetchDiagram(diagramId),
    staleTime: 0,
    refetchOnMount: 'always',
    // Open in the editor, what is drawn there is the truth; the server's answer was its start.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    enabled,
  });

export const saveDiagram = (diagramId: string, input: SaveDiagramInput) =>
  api.put<DiagramSaved>(diagramPath(diagramId), input);

export const askDiagram = (diagramId: string, input: AskDiagramInput) =>
  api.post<DiagramAnswer>(`${diagramPath(diagramId)}/ask`, input);

/** Each save and who has it open (an event stream), as a document's. */
export const diagramLiveUrl = (diagramId: string) => `${API_PREFIX}${diagramPath(diagramId)}/live`;

/** The file itself, to keep or send. */
export const diagramFilePath = (diagramId: string) =>
  `/cloud/nodes/${encodeURIComponent(diagramId)}/content?download=1`;

export function useCreateDiagram(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateDiagramInput, 'workspaceId'>) =>
      api.post<DiagramFile>('/diagrams', { ...input, workspaceId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cloudKeys.all(workspaceId) }),
  });
}
