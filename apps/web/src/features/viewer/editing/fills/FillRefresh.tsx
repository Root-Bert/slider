import { useEditing } from '../editing-context';
import { useFillRefresh } from './useFills';

/** Draws the picked element's fill layers anew once it was resized (`useFillRefresh`). */
export function FillRefresh() {
  const editing = useEditing();
  useFillRefresh(editing.active ? editing.selectedElement : null);
  return null;
}
