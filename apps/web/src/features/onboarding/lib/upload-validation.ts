import { MAX_UPLOAD_BYTES } from '@slider/shared';
import { formatBytes } from '@/lib/format';

/**
 * Client-side pre-check before uploading (BER-91). Any file goes – the server keeps PowerPoints
 * and PDFs and turns pictures, Word, Excel and text into PDFs, and tells what it cannot read.
 * This only spares users an empty or 200 MB upload that is bound to fail.
 * Returns a German error message, or `null` when the file looks fine.
 */
export function validateUploadFile(file: Pick<File, 'size'>): string | null {
  if (file.size === 0) return 'Die Datei ist leer.';
  if (file.size > MAX_UPLOAD_BYTES) {
    return `Die Datei ist zu groß (${formatBytes(file.size)}). Maximal ${formatBytes(MAX_UPLOAD_BYTES)} sind möglich.`;
  }
  return null;
}
