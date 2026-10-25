import { describe, expect, it } from 'vitest';
import { imagesFromClipboard } from './image-file';

const png = { type: 'image/png' } as File;
const data = (files: File[], types: string[]) => ({ files, types }) as unknown as DataTransfer;

describe('imagesFromClipboard', () => {
  it('finds a screenshot, and several images', () => {
    expect(imagesFromClipboard(data([png], ['Files']))).toEqual([png]);
    expect(imagesFromClipboard(data([png, png], ['Files']))).toEqual([png, png]);
  });

  it('takes no image when text was copied too (spreadsheets bring both)', () => {
    expect(imagesFromClipboard(data([png], ['Files', 'text/plain']))).toEqual([]);
  });

  it('ignores other files and an empty clipboard', () => {
    expect(imagesFromClipboard(data([{ type: 'application/pdf' } as File], ['Files']))).toEqual([]);
    expect(imagesFromClipboard(null)).toEqual([]);
  });
});
