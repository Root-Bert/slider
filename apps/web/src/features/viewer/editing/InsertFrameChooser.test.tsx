import { act, fireEvent, render, within } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { tabStep } from '@/lib/dom';
import {
  FrameShape,
  KindChooser,
  ShapeButtons,
  type FrameKind,
  type InsertKind,
} from './InsertFrameChooser';

function Host({
  typed,
  onType,
  onPick,
  selectable = 0,
}: {
  typed: InsertKind[];
  onType: (kind: InsertKind, text: string) => void;
  onPick: (kind: FrameKind) => void;
  selectable?: number;
}) {
  const [kind, setKind] = useState<FrameKind>(selectable > 0 ? 'select' : 'text');
  return (
    <>
      <span data-testid="kind">{kind}</span>
      <KindChooser
        rect={{ x: 0.1, y: 0.1, w: 0.3, h: 0.2 }}
        kind={kind}
        typed={typed}
        selectable={selectable}
        onKind={setKind}
        onPick={onPick}
        onType={onType}
        onCancel={() => {}}
      />
      {/* „Form“'s shapes in the panel beside the frame (`FramePanelPreview`). */}
      <div data-frame-shapes="">
        <button type="button" data-shape="rectangle" />
        <button type="button" data-shape="ellipse" />
      </div>
    </>
  );
}

it('steps with Tab and types on the picked kind wherever the focus is – not on one with nowhere to go', () => {
  const onType = vi.fn();
  const onPick = vi.fn();
  const view = render(<Host typed={['text', 'image']} onType={onType} onPick={onPick} />);
  act(() => (document.activeElement as HTMLElement).blur());
  expect(document.activeElement).toBe(document.body);
  const tabs: (1 | -1 | null)[] = [];
  window.addEventListener('keydown', (e) => tabs.push(tabStep(e)), { capture: true });
  fireEvent.keyDown(document.body, { key: 'Tab' });
  expect(view.getByTestId('kind').textContent).toBe('shape');
  fireEvent.keyDown(document.body, { key: 'Tab' });
  expect(view.getByTestId('kind').textContent).toBe('image');
  fireEvent.keyDown(document.body, { key: 'Tab' });
  expect(view.getByTestId('kind').textContent).toBe('text');
  fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true });
  expect(view.getByTestId('kind').textContent).toBe('image');
  act(() => (document.activeElement as HTMLElement).blur());
  fireEvent.keyDown(document.body, { key: 'k' });
  expect(onType).toHaveBeenCalledWith('image', 'k');
  fireEvent.keyDown(document.body, { key: 'Enter' });
  expect(onPick).toHaveBeenCalledWith('image');
  expect(tabs.every((t) => t === null)).toBe(true);
  // „Form“ taken: the row stays as it is, the shapes are picked in the panel – Tab steps them
  // there, ↵ is the shape's own, Esc goes back to „Form“.
  const shapeAt = (shape: string) => view.container.querySelector(`[data-shape="${shape}"]`);
  const formButton = view.getByRole('button', { name: 'Form' });
  fireEvent.click(formButton);
  expect(onPick).not.toHaveBeenCalledWith('shape');
  expect(document.activeElement).toBe(shapeAt('rectangle'));
  expect(view.getByRole('toolbar').textContent).toBe('TextFormBild');
  fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
  expect(document.activeElement).toBe(shapeAt('ellipse'));
  fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
  expect(document.activeElement).toBe(shapeAt('rectangle'));
  onPick.mockClear();
  fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
  expect(onPick).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(document.activeElement).toBe(formButton);
  view.unmount();
  // Neither a photo service nor generation: typing on „Bild“ goes nowhere.
  const none = vi.fn();
  const bare = render(<Host typed={['text']} onType={none} onPick={vi.fn()} />);
  fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true });
  expect(bare.getByTestId('kind').textContent).toBe('image');
  fireEvent.keyDown(document.body, { key: 'x' });
  expect(none).not.toHaveBeenCalled();
  bare.unmount();
  // The frame encloses elements: „Auswählen“ comes first, picked; typing does not go on there.
  const picks = vi.fn();
  const typedOn = vi.fn();
  const around = render(<Host typed={['text']} onType={typedOn} onPick={picks} selectable={3} />);
  const row = within(around.getByRole('toolbar'));
  expect(row.getAllByRole('button').map((button) => button.textContent)).toEqual([
    'Auswählen',
    'Text',
    'Form',
    'Bild',
  ]);
  expect(around.getByTestId('kind').textContent).toBe('select');
  act(() => (document.activeElement as HTMLElement).blur());
  fireEvent.keyDown(document.body, { key: 'y' });
  expect(typedOn).not.toHaveBeenCalled();
  fireEvent.keyDown(document.body, { key: 'Enter' });
  expect(picks).toHaveBeenCalledWith('select');
  fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true });
  expect(around.getByTestId('kind').textContent).toBe('image');
  around.unmount();
  // „Form“'s shapes: the frame shows the one Tab is on at once, the one under the pointer over it,
  // the box again once neither.
  const onShow = vi.fn();
  const shapes = render(<ShapeButtons onPick={vi.fn()} onShow={onShow} />);
  const shapeButton = (shape: string) =>
    shapes.container.querySelector<HTMLElement>(`[data-shape="${shape}"]`)!;
  act(() => shapeButton('isosceles-triangle').focus());
  expect(onShow).toHaveBeenLastCalledWith('isosceles-triangle');
  fireEvent.pointerEnter(shapeButton('star5'));
  expect(onShow).toHaveBeenLastCalledWith('star5');
  fireEvent.pointerLeave(shapeButton('star5'));
  expect(onShow).toHaveBeenLastCalledWith('isosceles-triangle');
  act(() => shapeButton('isosceles-triangle').blur());
  expect(onShow).toHaveBeenLastCalledWith(null);
  shapes.unmount();
  // Drawn in the frame as LibreOffice will: the triangle's apex at the top's middle; the
  // rectangle is the box itself.
  const triangle = render(<FrameShape shape="isosceles-triangle" />);
  expect(triangle.container.querySelector('polygon')?.getAttribute('points')).toBe(
    '50,0 100,100 0,100',
  );
  triangle.unmount();
  expect(render(<FrameShape shape="rectangle" />).container.innerHTML).toBe('');
});
