import type { Stroke } from '@slider/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { useSheetEditor } from './hooks/useSheetEditor';
import { SketchPanel } from './SketchPanel';

type Editor = ReturnType<typeof useSheetEditor>;

const line: Stroke = {
  tool: 'pen',
  color: 'red',
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.5, y: 0.5 },
  ],
};

// The sheet itself draws on a canvas; here it only shows the pen colour and the strokes, and
// lets a test draw (and select) a line.
vi.mock('./SketchSheet', () => ({
  SketchSheet: ({ editor, color, big }: { editor: Editor; color: string; big: boolean }) => (
    <div data-testid={big ? 'sheet-big' : 'sheet'} data-pen={color}>
      {editor.strokes.map((stroke, index) => (
        <span key={index} data-stroke={stroke.color} />
      ))}
      <button type="button" onClick={() => editor.commit([...editor.strokes, line], 0)}>
        draw
      </button>
    </div>
  ),
}));
vi.mock('./RecorderPanel', () => ({ RecorderPanel: () => null }));

const renderPanel = (props: Partial<Parameters<typeof SketchPanel>[0]> = {}) => {
  const onChange = vi.fn();
  render(
    <SketchPanel
      deckId="d1"
      color="blue"
      authorName="Ada"
      aspect={16 / 9}
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange };
};

describe('SketchPanel', () => {
  it('offers the own colour first as pressed pen colours', () => {
    renderPanel();
    const colours = screen.getByRole('group', { name: 'Farben' });
    const swatches = within(colours).getAllByRole('button');
    expect(swatches.map((swatch) => swatch.getAttribute('aria-label'))).toEqual([
      'Farbe Blau',
      'Farbe Rot',
      'Farbe Grün',
      'Farbe Violett',
      'Farbe Cyan',
      'Farbe Gelb',
    ]);
    expect(swatches[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(swatches[1]!.getAttribute('aria-pressed')).toBe('false');
    expect(swatches[0]!.getAttribute('title')).toBe('Farbe');
  });

  it('switches the pen colour', async () => {
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Farbe Grün' }));
    expect(screen.getByTestId('sheet').dataset.pen).toBe('green');
    expect(screen.getByRole('button', { name: 'Farbe Grün' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('recolours the selected mark and reports the drawing', async () => {
    const { onChange } = renderPanel();
    expect(onChange).toHaveBeenLastCalledWith(null);
    await userEvent.click(screen.getByRole('button', { name: 'draw' }));
    // The selected (red) line shows its colour, and the swatches say they recolour it.
    const red = screen.getByRole('button', { name: 'Farbe Rot' });
    expect(red.getAttribute('aria-pressed')).toBe('true');
    expect(red.getAttribute('title')).toBe('Farbe der Auswahl');
    expect(screen.getByRole('button', { name: 'Auswahl löschen (Entf)' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Farbe Cyan' }));
    expect(document.querySelector('[data-stroke]')?.getAttribute('data-stroke')).toBe('cyan');
    expect(onChange).toHaveBeenLastCalledWith({
      strokes: [{ ...line, color: 'cyan' }],
      memo: null,
    });
  });

  it('picks a tool and undoes', async () => {
    renderPanel();
    const pen = screen.getByRole('button', { name: 'Freihand' });
    await userEvent.click(pen);
    expect(pen.getAttribute('aria-pressed')).toBe('true');
    const undo = screen.getByRole('button', { name: 'Rückgängig (⌘Z)' });
    expect(undo).toHaveProperty('disabled', true);
    await userEvent.click(screen.getByRole('button', { name: 'draw' }));
    expect(undo).toHaveProperty('disabled', false);
    await userEvent.click(undo);
    expect(document.querySelector('[data-stroke]')).toBeNull();
  });

  it('opens the big view with the tools as a pill and closes it again', async () => {
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Groß zeichnen' }));
    const dialog = screen.getByRole('dialog', { name: 'Bild zeichnen', hidden: true });
    const tools = within(dialog).getByRole('toolbar', { name: 'Zeichenwerkzeuge', hidden: true });
    expect(tools.className).toContain('glass-control');
    expect(within(tools).getByRole('group', { name: 'Farben', hidden: true })).toBeTruthy();
    // Without send actions the big view has its own close button.
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Schließen (Esc)', hidden: true }),
    );
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  });

  it('sends from the big view', async () => {
    const onSend = vi.fn();
    renderPanel({ actions: { canSend: true, pending: false, onSend, onCancel: vi.fn() } });
    await userEvent.click(screen.getByRole('button', { name: 'Groß zeichnen' }));
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(within(dialog).queryByRole('button', { name: 'Schließen (Esc)', hidden: true })).toBe(
      null,
    );
    await userEvent.click(within(dialog).getByRole('button', { name: /Senden/, hidden: true }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  });
});
