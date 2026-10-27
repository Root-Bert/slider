import { useEffect } from 'react';
import type { WorkspaceFont } from '@slider/shared';

/*
 * A workspace's own fonts in the browser: each face loaded once through the FontFace API (the
 * page allows no stylesheets of its own making), under a family name of Slider's – so a font of
 * the same name installed on the computer is never used – with the vertical metrics LibreOffice
 * lays it out with, like the office fonts (`officeFontFaces`).
 */

const loaded = new Map<string, FontFace>();

/** The CSS family a workspace font family is drawn in (for `font-family`, quoted). */
export const workspaceCssFamily = (family: string) => `"Slider own ${family.replace(/"/g, '')}"`;

const percent = (share: number) => `${Number((share * 100).toFixed(4))}%`;

/** Loads the faces not loaded yet; a face that fails is left to the next fallback. */
export function loadWorkspaceFonts(fonts: readonly WorkspaceFont[]): void {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
  for (const font of fonts) {
    if (loaded.has(font.id)) continue;
    const face = new FontFace(workspaceCssFamily(font.family).slice(1, -1), `url(${font.url})`, {
      weight: String(font.weight),
      style: font.italic ? 'italic' : 'normal',
      display: 'block',
      ascentOverride: percent(font.ascent / font.upm),
      descentOverride: percent(font.descent / font.upm),
      lineGapOverride: '0%',
    });
    loaded.set(font.id, face);
    document.fonts.add(face);
    face.load().catch(() => {
      document.fonts.delete(face);
    });
  }
}

/** {@link loadWorkspaceFonts} while a component shows them. */
export function useWorkspaceFontFaces(fonts: readonly WorkspaceFont[] | undefined): void {
  useEffect(() => {
    if (fonts) loadWorkspaceFonts(fonts);
  }, [fonts]);
}
