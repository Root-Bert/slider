import { MAX_UPLOAD_BYTES } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { formatBytes } from '@/lib/format';
import { validateUploadFile } from './upload-validation';

describe('validateUploadFile', () => {
  it('lets any kind of file through – the server tells what it cannot read', () => {
    for (const name of ['Deck.PPTX', 'Export.pdf', 'Foto.jpg', 'Bericht.docx', 'a.key']) {
      expect(validateUploadFile({ size: 1024 }), name).toBeNull();
    }
  });

  it('rejects empty files', () => {
    expect(validateUploadFile({ size: 0 })).toBe('Die Datei ist leer.');
  });

  it('accepts exactly the maximum size and names both sizes when over it', () => {
    expect(validateUploadFile({ size: MAX_UPLOAD_BYTES })).toBeNull();
    expect(validateUploadFile({ size: MAX_UPLOAD_BYTES + 1 })).toBe(
      `Die Datei ist zu groß (${formatBytes(MAX_UPLOAD_BYTES + 1)}). Maximal ${formatBytes(MAX_UPLOAD_BYTES)} sind möglich.`,
    );
  });
});
