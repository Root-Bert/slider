import { MAX_UPLOAD_BYTES } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { formatBytes } from '@/lib/format';
import { PPTX_ACCEPT, PPTX_MIME_TYPE, validatePptxFile } from './upload-validation';

describe('validatePptxFile', () => {
  it('accepts .pptx regardless of case', () => {
    expect(validatePptxFile({ name: 'Deck.PPTX', size: 1024 })).toBeNull();
  });

  it('rejects other extensions, empty and oversized files with German messages', () => {
    expect(validatePptxFile({ name: 'deck.ppt', size: 1024 })).toMatch(/\.pptx/);
    expect(validatePptxFile({ name: 'deck.pptx', size: 0 })).toBe('Die Datei ist leer.');
    expect(validatePptxFile({ name: 'deck.pptx', size: MAX_UPLOAD_BYTES + 1 })).toMatch(/zu groß/);
  });
});

describe('upload limits', () => {
  it('accepts exactly the maximum size and names both sizes when over it', () => {
    expect(validatePptxFile({ name: 'deck.pptx', size: MAX_UPLOAD_BYTES })).toBeNull();
    expect(validatePptxFile({ name: 'deck.pptx', size: MAX_UPLOAD_BYTES + 1 })).toBe(
      `Die Datei ist zu groß (${formatBytes(MAX_UPLOAD_BYTES + 1)}). Maximal ${formatBytes(MAX_UPLOAD_BYTES)} sind möglich.`,
    );
  });

  it('rejects Keynote and legacy PowerPoint files with the .pptx hint', () => {
    const message = 'Nur PowerPoint-Dateien (.pptx) werden unterstützt.';
    expect(validatePptxFile({ name: 'a.ppt', size: 1 })).toBe(message);
    expect(validatePptxFile({ name: 'a.key', size: 1 })).toBe(message);
  });

  it('lets the file picker offer .pptx by extension and MIME type', () => {
    expect(PPTX_ACCEPT.split(',')).toEqual(['.pptx', PPTX_MIME_TYPE]);
  });
});
