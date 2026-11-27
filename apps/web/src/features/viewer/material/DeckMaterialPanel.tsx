import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { deckBoard } from '@/lib/api';
import { MATERIAL_PARAM } from '@/lib/routes';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { useViewerToast } from '../state/viewer-toast';
import { MaterialPanel } from './MaterialList';

/**
 * The presentation's „Material“ as one of its right side panels (⌘K „Material“, or `?material`
 * on its address – the ⋯ menu of a presentation in the lists leads there).
 */
export function DeckMaterialPanel() {
  const { materialPanelOpen } = useViewerState();
  const dispatch = useViewerDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const asked = searchParams.has(MATERIAL_PARAM);
  useEffect(() => {
    if (!asked) return;
    dispatch({ type: 'materialPanelSet', open: true });
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete(MATERIAL_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [asked, dispatch, setSearchParams]);
  if (!materialPanelOpen) return null;
  return <OpenDeckMaterial />;
}

function OpenDeckMaterial() {
  const { deck, canComment, canManage } = useViewerData();
  const dispatch = useViewerDispatch();
  const owner = useMemo(() => deckBoard(deck.id), [deck.id]);
  const toast = useViewerToast();
  return (
    <MaterialPanel
      owner={owner}
      canComment={canComment}
      canManage={canManage}
      onClose={() => dispatch({ type: 'materialPanelSet', open: false })}
      onRefused={(message) => toast(message, 'danger')}
    />
  );
}
