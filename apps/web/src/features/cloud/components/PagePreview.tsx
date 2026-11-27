import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_PREFIX, cloudPaths, type CloudNode } from '@slider/shared';
import { api } from '@/lib/api-client';
import { PageStrip } from '@/ui';

const pagePath = (nodeId: string, page: number | null, versionId: string | null) =>
  `/cloud/nodes/${encodeURIComponent(nodeId)}/pages${page ? `/${page}` : ''}${
    versionId ? `?v=${encodeURIComponent(versionId)}` : ''
  }`;

/** Whether the file has pages to show: a PDF, or an office file already drawn (its small picture). */
export const hasPagePreview = (node: CloudNode) =>
  node.kind === 'file' && !node.deleted && (node.fileType === 'pdf' || node.thumbnail);

/**
 * The file's pages at the top of its details (`PageStrip`). The first page is the small picture
 * the list already shows, the sharp one drawn over it; the box takes that picture's shape.
 */
export function PagePreview({ node }: { node: CloudNode }) {
  const pages = useQuery({
    queryKey: ['cloud', 'pages', node.id, node.versionId],
    queryFn: () => api.get<{ pages: number }>(pagePath(node.id, null, node.versionId)),
    staleTime: Infinity,
    retry: false,
  });
  // Until the small picture says otherwise: a slide's shape, else an upright page's.
  const [ratio, setRatio] = useState(node.fileType === 'presentation' ? 16 / 9 : 210 / 297);
  return (
    <PageStrip
      count={pages.data?.pages ?? 1}
      ratio={ratio}
      pageSrc={(index) =>
        pages.data ? `${API_PREFIX}${pagePath(node.id, index + 1, node.versionId)}` : null
      }
      small={`${API_PREFIX}${cloudPaths.thumbnail(node.id, node.versionId)}`}
      onShape={setRatio}
    />
  );
}
