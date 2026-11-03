import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { FillLayer } from '@slider/shared';
import { expect, it, vi } from 'vitest';
import { FillLayers } from './FillControls';
import { pictureUrl } from './bake-fills';
import { rememberPictureAspect } from './picture-aspect';
import type * as DeckColors from '../colors/useDeckColors';

vi.mock('../../state/viewer-data', () => ({
  useViewerData: () => ({ deck: { id: 'deck' }, viewer: { author: { color: 'blue' } } }),
}));
vi.mock('../../state/viewer-toast', () => ({ useViewerToast: () => vi.fn() }));
// The picker sits open in a colour layer's editor.
vi.mock('../colors/useDeckColors', async (importOriginal) => ({
  ...(await importOriginal<typeof DeckColors>()),
  useDeckColors: () => ({
    colors: [],
    fromTemplate: false,
    custom: [],
    addCustom: vi.fn(),
    removeCustom: vi.fn(),
  }),
}));
vi.mock('./useFills', () => ({
  useFillDraft: vi.fn(),
  useUploadLayerPicture: () => ({ pending: false, upload: vi.fn() }),
}));

it('keeps the same layer editor open when another layer is moved across it', () => {
  function Controls() {
    const [fills, change] = useState<FillLayer[]>(
      ['#ff0000', '#00ff00', '#0000ff'].map((color) => ({
        type: 'solid',
        color,
        opacity: 1,
        visible: true,
      })),
    );
    return <FillLayers fills={fills} change={change} first={fills[0]!} label="Füllung" />;
  }
  render(<Controls />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Ebene bearbeiten' })[1]!);
  expect(
    screen.getByRole('button', { name: 'Ebene bearbeiten', expanded: true }).textContent,
  ).toContain('00FF00');
  const rows = screen.getAllByRole('listitem');
  fireEvent.dragStart(rows[2]!, { dataTransfer: { effectAllowed: 'move', setData: vi.fn() } });
  fireEvent.dragOver(rows[0]!, { dataTransfer: {} });
  fireEvent.drop(rows[0]!);
  expect(
    screen.getByRole('button', { name: 'Ebene bearbeiten', expanded: true }).textContent,
  ).toContain('00FF00');

  // A picture filling its frame: its swatch shows the part shown (zoomed in on its left), not all.
  const picture: FillLayer = {
    type: 'image',
    src: 'Pictures/p.png',
    fit: 'fill',
    focus: { x: 0.25, y: 0.5, zoom: 2 },
    opacity: 1,
    visible: true,
  };
  rememberPictureAspect(pictureUrl('deck', picture.src), 2);
  const { container } = render(
    <FillLayers
      fills={[picture]}
      change={vi.fn()}
      first={picture}
      label="Bild"
      place={{ slideId: 's', box: { x: 0, y: 0, w: 0.5, h: 0.5 }, rotation: 0 }}
    />,
  );
  const swatch = container.querySelector<HTMLElement>('.checkerboard > span')!;
  // A 16:9 frame of a 2:1 picture, zoomed 2×: a part 0.444 wide around x 0.25 – its square middle
  // a quarter wide at x 0.125 (laid at 16.667 %), half high at y 0.25 (50 %).
  expect(swatch.style.background).toContain('16.667% 50%');
  expect(swatch.style.background).toContain('400%');
});
