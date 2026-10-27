import type { BackgroundPriority } from '@/lib/api';
import { useSlideLayers } from '@/lib/api';
import type { SlideLayers } from '@slider/shared';
import { useViewerData } from '../../state/viewer-data';
import { useEditing } from '../editing-context';

export type LayerPicture = SlideLayers['layers'][number];

const NO_PICTURES: ReadonlyMap<string, LayerPicture> = new Map();

/**
 * A slide's layers as drawn (`SlideLayers`) at the current edit step: the slide without its
 * elements and each element alone. `background`: a slide beside the active one, drawn after it.
 */
export function useLayerPictures(slideId: string | null, priority: BackgroundPriority) {
  const editing = useEditing();
  const { deck } = useViewerData();
  const query = useSlideLayers(deck.id, slideId, editing.state?.seq, {
    enabled: editing.layers,
    priority,
  });
  return {
    pictures: query.data
      ? new Map(query.data.layers.map((layer) => [layer.elementId, layer]))
      : NO_PICTURES,
    /** The slide without its elements; `null` until drawn. */
    background: query.data?.background ?? null,
    drawing: query.isFetching,
    failed: query.isError,
    retry: () => void query.refetch(),
  };
}
