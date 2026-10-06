import { MAX_UPLOAD_BYTES } from '@slider/shared';
import { formatBytes } from '@/lib/format';

export const PPTX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';
/** `accept` attribute of the file picker. */
export const PPTX_ACCEPT = `.pptx,${PPTX_MIME_TYPE}`;

/**
 * Client-side pre-check before uploading (BER-91). The server validates again –
 * this only spares users a 200 MB upload that is bound to fail.
 * Returns a German error message, or `null` when the file looks fine.
 */
export function validatePptxFile(file: Pick<File, 'name' | 'size'>): string | null {
  if (!file.name.toLowerCase().endsWith('.pptx')) {
    return 'Nur PowerPoint-Dateien (.pptx) werden unterstützt.';
  }
  if (file.size === 0) return 'Die Datei ist leer.';
  if (file.size > MAX_UPLOAD_BYTES) {
    return `Die Datei ist zu groß (${formatBytes(file.size)}). Maximal ${formatBytes(MAX_UPLOAD_BYTES)} sind möglich.`;
  }
  return null;
}
