import type { AccentColor } from '@slider/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ColorSwatches } from './ColorSwatches';

const classes = (element: Element) => element.getAttribute('class')!.split(/\s+/);

describe('ColorSwatches (fill)', () => {
  it('is a radio group of the six accents with the value checked', async () => {
    const onChange = vi.fn();
    render(
      <>
        <span id="farbe">Deine Farbe</span>
        <ColorSwatches labelledBy="farbe" value="blue" onChange={onChange} />
      </>,
    );
    expect(screen.getByRole('radiogroup', { name: 'Deine Farbe' })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    const blue = screen.getByRole('radio', { name: 'Blau' });
    expect(blue.getAttribute('aria-checked')).toBe('true');
    expect(blue.getAttribute('title')).toBe('Blau');
    expect(blue.querySelector('svg')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Rot' }).querySelector('svg')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Grün' }));
    expect(onChange).toHaveBeenCalledWith('green');
  });

  it('puts on-accent contrast on the check', () => {
    const { rerender } = render(<ColorSwatches label="Farbe" value="yellow" onChange={() => {}} />);
    expect(classes(screen.getByRole('radio', { name: 'Gelb' }).querySelector('svg')!)).toContain(
      'text-black',
    );
    rerender(<ColorSwatches label="Farbe" value="violet" onChange={() => {}} />);
    expect(classes(screen.getByRole('radio', { name: 'Violett' }).querySelector('svg')!)).toContain(
      'text-white',
    );
  });

  it('sizes 28 / 32 and paints the ring offset with a token', () => {
    const { rerender } = render(<ColorSwatches label="Farbe" value="red" onChange={() => {}} />);
    const red = () => screen.getByRole('radio', { name: 'Rot' });
    expect(classes(red())).toEqual(
      expect.arrayContaining(['size-7', 'ring-2', 'ring-fg', 'ring-offset-glass-solid']),
    );
    expect(red().querySelector('svg')!.getAttribute('width')).toBe('14');
    rerender(
      <ColorSwatches label="Farbe" value="red" size={32} ringOffset="canvas" onChange={() => {}} />,
    );
    expect(classes(red())).toEqual(expect.arrayContaining(['size-8', 'ring-offset-canvas']));
    expect(red().querySelector('svg')!.getAttribute('width')).toBe('16');
  });

  it('is one Tab stop that the arrow keys move through, keeping them from the page', async () => {
    function Harness({ onKey }: { onKey: (prevented: boolean) => void }) {
      const [value, setValue] = useState<AccentColor>('green');
      return (
        <div onKeyDown={(event) => onKey(event.defaultPrevented)}>
          <ColorSwatches label="Farbe" value={value} onChange={setValue} />
        </div>
      );
    }
    const onKey = vi.fn();
    render(<Harness onKey={onKey} />);
    const radios = screen.getAllByRole('radio');
    // Only the picked colour takes Tab.
    expect(radios.filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
    await userEvent.tab();
    const green = screen.getByRole('radio', { name: 'Grün' });
    expect(document.activeElement).toBe(green);

    await userEvent.keyboard('{ArrowRight}');
    const next = radios[radios.indexOf(green) + 1]!;
    expect(next.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(next);
    // The viewer's ←/→ slide navigation skips the handled key.
    expect(onKey).toHaveBeenLastCalledWith(true);

    await userEvent.keyboard('{Home}');
    expect(radios[0]!.getAttribute('aria-checked')).toBe('true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(radios.at(-1)!.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radios.at(-1));
  });

  it('stops reacting while disabled', async () => {
    const onChange = vi.fn();
    render(<ColorSwatches label="Farbe" value="red" disabled onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Blau' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(classes(screen.getByRole('radio', { name: 'Blau' }))).toContain('disabled:cursor-wait');
  });
});

describe('ColorSwatches (dot)', () => {
  it('is a group of pressed buttons with custom labels and title', async () => {
    const onChange = vi.fn();
    render(
      <ColorSwatches
        variant="dot"
        label="Stiftfarbe"
        colors={['green', 'red']}
        value="red"
        swatchLabel={(color) => `Farbe ${color === 'red' ? 'Rot' : 'Grün'}`}
        swatchTitle="Farbe"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('group', { name: 'Stiftfarbe' })).toBeTruthy();
    const red = screen.getByRole('button', { name: 'Farbe Rot' });
    expect(red.getAttribute('aria-pressed')).toBe('true');
    expect(red.getAttribute('title')).toBe('Farbe');
    expect(red.hasAttribute('role')).toBe(false);
    const dot = red.firstElementChild!;
    expect(classes(dot)).toEqual(
      expect.arrayContaining(['size-4', 'ring-2', 'ring-offset-placeholder']),
    );
    expect(classes(red)).toContain('hover:bg-hover');
    await userEvent.click(screen.getByRole('button', { name: 'Farbe Grün' }));
    expect(onChange).toHaveBeenCalledWith('green');
  });
});
