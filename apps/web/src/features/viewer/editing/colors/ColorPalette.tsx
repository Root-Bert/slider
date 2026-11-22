import type { TemplateColor } from '@slider/shared';
import { useId, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn, ColorMixer, Icon, usePopover } from '@/ui';
import { placeBelowOrAbove, type Placement } from '../../lib/geometry';
import { TEXT_TOOLBAR_ATTR } from '../live/model';
import { withOpacity } from './hsv';
import { sameColor, useDeckColors } from './useDeckColors';

/*
 * Every colour in the editor is picked here, the same way (the mixer itself is `ColorMixer` in
 * `@/ui`, shared with the other apps) – a text's, a fill layer's, a gradient
 * stop's, a shadow's, a border's, a slide background's, a template's: a field to pick from
 * (saturation × brightness), the hue under it, how opaque (where the colour has an opacity), the
 * colour as hex and in percent, a pipette where the browser has one, then the deck's colours –
 * the template's (else a few general ones) and its own („Eigene“).
 */

const swatchClass = (selected: boolean) =>
  cn(
    'size-5 shrink-0 rounded-full ring-1 ring-border transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
    selected && 'ring-2 ring-fg ring-offset-1 ring-offset-glass-solid',
  );

const hexName = (color: string) => color.slice(1).toUpperCase();

function Swatches({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5">
      <h3 id={id} className="text-xs text-fg-subtle">
        {label}
      </h3>
      <div className="-m-0.5 flex flex-wrap gap-2 p-0.5">{children}</div>
    </section>
  );
}

/**
 * The picker itself (see the top of the file). `onChange` gets every step while one drags;
 * `opacity` and `onOpacity`: the colour has an opacity, picked under the hue and typed in percent.
 */
export function ColorPalette({
  value,
  onChange,
  opacity,
  onOpacity,
}: {
  value: string | null;
  onChange: (color: string) => void;
  opacity?: number;
  onOpacity?: (opacity: number) => void;
}) {
  const { colors, fromTemplate, custom, addCustom, removeCustom } = useDeckColors();
  // Nothing picked yet: the mixer starts at white.
  const shown = value ?? '#ffffff';
  const swatch = ({ color, name }: TemplateColor) => {
    const title = name ? `${name} | ${hexName(color)}` : hexName(color);
    return (
      <button
        key={color + name}
        type="button"
        aria-label={title}
        title={title}
        aria-pressed={sameColor(value, color)}
        onClick={() => onChange(color)}
        className={swatchClass(sameColor(value, color))}
        style={{ backgroundColor: color }}
      />
    );
  };
  return (
    <div className="flex flex-col gap-3">
      <ColorMixer value={value} onChange={onChange} opacity={opacity} onOpacity={onOpacity} />
      <Swatches label={fromTemplate ? 'Vorlage' : 'Farben'}>{colors.map(swatch)}</Swatches>
      <Swatches label="Eigene">
        {custom.map((color) => (
          <span key={color} className="group relative">
            <button
              type="button"
              aria-label={hexName(color)}
              title={`${hexName(color)} – Entf löscht sie aus „Eigene“`}
              aria-pressed={sameColor(value, color)}
              onClick={() => onChange(color)}
              onKeyDown={(event) => {
                if (event.key !== 'Delete' && event.key !== 'Backspace') return;
                event.preventDefault();
                removeCustom(color);
              }}
              className={swatchClass(sameColor(value, color))}
              style={{ backgroundColor: color }}
            />
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              title="Aus „Eigene“ löschen"
              onClick={() => removeCustom(color)}
              className="absolute -top-1 -right-1 hidden size-3.5 items-center justify-center rounded-full bg-surface-4 text-fg group-hover:flex"
            >
              <Icon name="close" size={10} />
            </button>
          </span>
        ))}
        <button
          type="button"
          aria-label="Diese Farbe zu „Eigene“"
          title="Diese Farbe zu „Eigene“"
          disabled={custom.some((color) => sameColor(shown, color))}
          onClick={() => addCustom(shown)}
          className="flex size-5 items-center justify-center rounded-full text-fg-muted ring-1 ring-border ring-dashed hover:bg-hover disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          <Icon name="add" size={12} />
        </button>
      </Swatches>
    </div>
  );
}

/** A panel in the body beside `anchorRef`: the panels and lists it sits in would clip it. */
export function FloatingPanel({
  anchorRef,
  panelRef,
  panelId,
  label,
  className,
  flush = false,
  matchWidth = false,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  panelId: string;
  label: string;
  className?: string;
  /** No padding: a list that fills it. */
  flush?: boolean;
  /** As wide as what opens it, right under it – a dropdown's list. */
  matchWidth?: boolean;
  children: ReactNode;
}) {
  const [placement, setPlacement] = useState<Placement | null>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;
    const place = () => {
      if (matchWidth) panel.style.width = `${anchor.offsetWidth}px`;
      setPlacement(
        placeBelowOrAbove(
          anchor.getBoundingClientRect(),
          { width: panel.offsetWidth, height: panel.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight },
          8,
        ),
      );
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    if (matchWidth) observer.observe(anchor);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [anchorRef, panelRef, matchWidth]);
  return createPortal(
    <section
      ref={panelRef}
      id={panelId}
      role="dialog"
      aria-label={label}
      // Part of the format bar: typing on the slide goes on while one picks here.
      {...{ [TEXT_TOOLBAR_ATTR]: '' }}
      className={cn(
        'glass-elevated fixed z-(--z-popover) flex animate-pop-in flex-col rounded-panel',
        !flush && 'p-3',
        !placement && 'invisible',
        className,
      )}
      style={{ left: placement?.left ?? 0, top: placement?.top ?? 0 }}
    >
      {children}
    </section>,
    document.body,
  );
}

/** A colour on a dot (see-through on a checkerboard), as the picker shows it. */
export function ColorDot({
  color,
  opacity = 1,
  className,
}: {
  color: string;
  opacity?: number;
  className?: string;
}) {
  return (
    <span
      className={cn('checkerboard relative block overflow-hidden rounded-full', className)}
      aria-hidden
    >
      <span className="absolute inset-0" style={{ background: withOpacity(color, opacity) }} />
    </span>
  );
}

/**
 * A colour dot, like a pen's: a click opens the picker ({@link ColorPalette}) under it.
 * `opacity`/`onOpacity`: the colour has an opacity too.
 */
export function ColorField({
  label,
  value,
  onChange,
  opacity,
  onOpacity,
  size = 'sm',
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
  opacity?: number;
  onOpacity?: (opacity: number) => void;
  size?: 'sm' | 'md';
}) {
  const { open, triggerProps, triggerRef, wrapperRef, panelRef, panelId } = usePopover({
    hasPopup: 'dialog',
  });
  return (
    <span ref={wrapperRef} className="flex shrink-0">
      <button
        type="button"
        {...triggerProps}
        aria-label={label}
        title={label}
        className={cn(
          'mx-1 shrink-0 cursor-pointer rounded-full ring-1 ring-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
          size === 'md' ? 'size-6' : 'size-5',
          open && 'ring-2 ring-fg ring-offset-2 ring-offset-glass-solid',
        )}
      >
        <ColorDot color={value} opacity={opacity} className="size-full" />
      </button>
      {open && (
        <FloatingPanel
          anchorRef={triggerRef}
          panelRef={panelRef}
          panelId={panelId}
          label={label}
          className="w-64"
        >
          <ColorPalette value={value} onChange={onChange} opacity={opacity} onOpacity={onOpacity} />
        </FloatingPanel>
      )}
    </span>
  );
}

export { HexField, PercentField } from '@/ui';
