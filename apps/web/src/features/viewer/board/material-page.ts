import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A side panel of the board rendered on the material page, at the place of the presentation's
 * side panels: the same surface, backdrop and text colour – never inside the board's
 * transformed, clipped box. For `BoardPanel`, `MaterialChat` and `ConnectAppsPanel`.
 */
export const onMaterialPage = (panel: ReactNode) =>
  createPortal(panel, document.querySelector<HTMLElement>('[data-material-page]') ?? document.body);
