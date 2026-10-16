import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createPortal } from 'react-dom';
import { describe, expect, it, vi } from 'vitest';
import { PopoverPanel, usePopover, type UsePopoverOptions } from '@/ui';

function Example({ portal = false, ...options }: UsePopoverOptions & { portal?: boolean }) {
  // Destructured: the React compiler lint treats a hook result holding refs as a ref itself.
  const { open, wrapperRef, panelRef, panelId, triggerProps } = usePopover(options);
  const panel = (
    <PopoverPanel ref={panelRef} id={panelId} as="section" aria-label="Liste" padding="md">
      <button type="button">Innen</button>
    </PopoverPanel>
  );
  return (
    <>
      <div ref={wrapperRef} className="relative">
        <button type="button" {...triggerProps}>
          Öffnen
        </button>
        {open && !portal && panel}
      </div>
      {open && portal && createPortal(panel, document.body)}
      <button type="button">Draußen</button>
    </>
  );
}

describe('usePopover', () => {
  it('wires aria-expanded/-controls and toggles on click', async () => {
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Öffnen' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.hasAttribute('aria-controls')).toBe(false);
    expect(trigger.hasAttribute('aria-haspopup')).toBe(false);

    await userEvent.click(trigger);
    const panel = screen.getByRole('region', { name: 'Liste' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(panel.id);

    await userEvent.click(trigger);
    expect(screen.queryByRole('region', { name: 'Liste' })).toBeNull();
  });

  it('closes on Escape and hands the focus back to the trigger', async () => {
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Öffnen' });
    await userEvent.click(trigger);
    screen.getByRole('button', { name: 'Innen' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps a portalled panel open on presses inside it, closes outside', async () => {
    render(<Example portal />);
    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Innen' }));
    expect(screen.getByRole('region', { name: 'Liste' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Draußen' }));
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('sets aria-haspopup and reports open changes', async () => {
    const onOpenChange = vi.fn();
    render(<Example hasPopup="dialog" onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole('button', { name: 'Öffnen' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await userEvent.click(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });
});

describe('PopoverPanel', () => {
  const classesOf = (testId: string) => screen.getByTestId(testId).className.split(/\s+/);

  it('defaults to an elevated panel below the trigger on the popover layer', () => {
    render(<PopoverPanel data-testid="panel" />);
    expect(classesOf('panel')).toEqual(
      expect.arrayContaining([
        'glass-elevated',
        'rounded-panel',
        'animate-pop-in',
        'z-(--z-popover)',
        'absolute',
        'top-full',
        'mt-2',
        'left-0',
        'origin-top-left',
      ]),
    );
  });

  it('maps side, align, offset, padding and tone', () => {
    render(
      <PopoverPanel
        data-testid="panel"
        side="top"
        align="end"
        offset="sm"
        padding="lg"
        tone="default"
      />,
    );
    expect(classesOf('panel')).toEqual(
      expect.arrayContaining([
        'glass-control',
        'bottom-full',
        'mb-1',
        'right-0',
        'origin-bottom-right',
        'p-3',
      ]),
    );
    expect(classesOf('panel')).not.toContain('glass-elevated');
  });

  it('leaves positioning to the caller with position="none"', () => {
    render(<PopoverPanel data-testid="panel" position="none" className="absolute inset-2" />);
    expect(classesOf('panel')).not.toContain('top-full');
    expect(classesOf('panel')).toContain('inset-2');
  });
});
