import { MAX_UPLOAD_BYTES } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { validatePptxFile } from './upload-validation';

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
