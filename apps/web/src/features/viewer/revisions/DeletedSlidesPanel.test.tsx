import type { DeletedSlide } from '@slider/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeletedSlidesPanel } from './DeletedSlidesPanel';

const deleted: DeletedSlide = {
  slideId: 'gone',
  title: 'Agenda',
  previousPosition: 2,
  imageUrl: '/files/gone-2400.webp',
  thumbnailUrl: '/files/gone-640.webp',
  aspectRatio: 16 / 9,
  lastRevisionNumber: 3,
  confidence: 1,
  comments: [],
};

vi.mock('../state/viewer-state', () => ({
  useViewerState: () => ({ deletedPanelOpen: true }),
  useViewerDispatch: () => vi.fn(),
}));
vi.mock('../state/revision-data', () => ({
  useRevisionData: () => ({ deletedSlides: [deleted], deletedThreads: new Map() }),
}));
vi.mock('../state/viewer-data', () => ({
  useViewerData: () => ({ deck: { id: 'd1' }, canComment: false }),
}));
vi.mock('../hooks/useRestoreFocus', () => ({ useRestoreFocus: () => undefined }));

describe('DeletedSlidesPanel', () => {
  it('previews a deleted slide with its thumbnail, not the full-size image', () => {
    render(<DeletedSlidesPanel />);
    const image = screen.getByRole('img', { name: 'Agenda' });
    expect(image.getAttribute('src')).toBe('/files/gone-640.webp');
    expect(image.getAttribute('loading')).toBe('lazy');
  });
});
