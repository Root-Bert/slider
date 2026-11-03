import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { NumberField } from './NumberField';
import { steppedValue } from './scrub';

function Radius({ changes }: { changes: number[] }) {
  const [value, setValue] = useState(8);
  return (
    <NumberField
      label="Eckenradius"
      unit="pt"
      value={value}
      onChange={(next) => {
        changes.push(next);
        setValue(next);
      }}
      min={0}
      max={20}
      step={1}
    />
  );
}

describe('NumberField', () => {
  it('steps by typing, ↑ ↓, the wheel over it and its handle, like Figma', () => {
    const none = { shiftKey: false, altKey: false };
    const range = { min: 0, max: 20, step: 0.25 };
    expect(steppedValue(1, 1, none, range)).toBe(1.25);
    expect(steppedValue(1, 1, { shiftKey: true, altKey: false }, range)).toBe(3.5);
    expect(steppedValue(1, -1, { shiftKey: false, altKey: true }, range)).toBe(0.975);
    expect(steppedValue(19.5, 1, { shiftKey: true, altKey: false }, range)).toBe(20);
    // An angle goes round.
    expect(
      steppedValue(
        355,
        1,
        { shiftKey: true, altKey: false },
        { ...range, step: 1, bigStep: 15, wrap: 360 },
      ),
    ).toBe(10);

    const changes: number[] = [];
    const { container } = render(<Radius changes={changes} />);
    const input = screen.getByRole('textbox', { name: 'Eckenradius' });
    // Typed: taken once in range, kept as typed till left.
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.change(input, { target: { value: '99' } });
    expect(changes).toEqual([12]);
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe('12');
    fireEvent.keyDown(input, { key: 'ArrowUp', shiftKey: true });
    expect(changes.at(-1)).toBe(20);
    // The wheel over the field steps it (a notch of 50 px), and the panel under it does not scroll.
    const field = input.parentElement!;
    const wheel = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    field.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(changes.slice(-2)).toEqual([19, 18]);
    // Its handle is in front of the number, dragged sideways.
    const handle = container.querySelector('[data-scrub-handle]');
    expect(handle?.nextElementSibling).toBe(input);
    expect(handle?.classList.contains('cursor-ew-resize')).toBe(true);
  });
});
