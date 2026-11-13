import { useEffect, useEffectEvent } from 'react';
import { DESKTOP_BAR_EVENT, desktopBridge, type DesktopBarAction } from '@/lib/desktop-bridge';
import { useEditing } from '../editing/editing-context';
import { useCloseDeck } from '../hooks/useCloseDeck';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

/**
 * In the desktop app: the presentation's buttons in the tab bar, top right (Präsentieren,
 * Referentenansicht, Exportieren, ✕), in place of the deck pill's – reports what it offers (nothing while presenting or on the material page) and does what
 * is clicked there, as the pill's buttons and P / ⌥P / S do.
 */
export function DesktopBar({
  active,
  onPresent,
  onPresenterView,
}: {
  active: boolean;
  onPresent: () => void;
  onPresenterView: () => void;
}) {
  const bridge = desktopBridge();
  const share = useEditing().available;
  const { sharePanelOpen } = useViewerState();
  const dispatch = useViewerDispatch();
  const { template, close } = useCloseDeck();
  const offered = active && !!bridge?.deckBar;

  useEffect(() => {
    bridge?.deckBar?.(offered ? { share, shareOpen: share && sharePanelOpen, template } : null);
  }, [bridge, offered, share, sharePanelOpen, template]);
  useEffect(() => () => bridge?.deckBar?.(null), [bridge]);

  const onAction = useEffectEvent((action: DesktopBarAction) => {
    if (!offered) return;
    if (action === 'present') onPresent();
    else if (action === 'presenter') onPresenterView();
    else if (action === 'share' && share)
      dispatch({ type: 'sharePanelSet', open: !sharePanelOpen });
    else if (action === 'close') close();
  });
  useEffect(() => {
    const listener = (event: Event) => onAction((event as CustomEvent<DesktopBarAction>).detail);
    window.addEventListener(DESKTOP_BAR_EVENT, listener);
    return () => window.removeEventListener(DESKTOP_BAR_EVENT, listener);
  }, []);

  return null;
}
