import { describe, expect, it } from 'vitest';
import { baseMimeType, isAllowedMediaMimeType, MEDIA_MIME_TYPES } from '../src/api';

describe('baseMimeType', () => {
  it('drops parameters, whitespace and case', () => {
    expect(baseMimeType('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(baseMimeType('Audio/WebM; codecs=opus')).toBe('audio/webm');
    expect(baseMimeType('  video/MP4  ')).toBe('video/mp4');
  });

  it('keeps a plain type and an empty string as they are', () => {
    expect(baseMimeType('audio/ogg')).toBe('audio/ogg');
    expect(baseMimeType('')).toBe('');
  });
});

describe('isAllowedMediaMimeType', () => {
  it('accepts every listed type for its kind, with codecs', () => {
    for (const kind of ['audio', 'video'] as const)
      for (const type of MEDIA_MIME_TYPES[kind]) {
        expect(isAllowedMediaMimeType(kind, type)).toBe(true);
        expect(isAllowedMediaMimeType(kind, `${type.toUpperCase()}; codecs=x`)).toBe(true);
      }
    expect(isAllowedMediaMimeType('video', 'video/webm;codecs=vp9')).toBe(true);
  });

  it('rejects a type of the other kind', () => {
    expect(isAllowedMediaMimeType('audio', 'video/mp4')).toBe(false);
    expect(isAllowedMediaMimeType('video', 'audio/webm')).toBe(false);
    expect(isAllowedMediaMimeType('video', 'audio/ogg')).toBe(false);
  });

  it('rejects unknown and empty types', () => {
    expect(isAllowedMediaMimeType('audio', 'audio/mpeg')).toBe(false);
    expect(isAllowedMediaMimeType('video', 'video/quicktime')).toBe(false);
    expect(isAllowedMediaMimeType('audio', '')).toBe(false);
    expect(isAllowedMediaMimeType('audio', 'image/png')).toBe(false);
  });
});
