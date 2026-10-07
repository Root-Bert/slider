import { createContext, useContext } from 'react';
import type { ShowToast } from '@/ui';

/**
 * The viewer's one status toast (e.g. "Antwort nicht gesendet"). Rendered by `<Viewer>` outside
 * the panels, so its fixed position isn't affected by their transforms.
 */
export const ViewerToastContext = createContext<ShowToast>(() => {});

export const useViewerToast = () => useContext(ViewerToastContext);
