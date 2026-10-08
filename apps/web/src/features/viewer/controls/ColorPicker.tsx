import { ACCENT_COLORS, type AccentColor } from '@slider/shared';
import { useId, useRef, useState } from 'react';
import { accentColor } from '@/lib/accent';
import { useUpdateMe } from '@/lib/queries';
import { Avatar, cn, GlassPanel, Icon, useDismiss } from '@/ui';
import { useViewerData } from '../state/viewer-data';

const COLOR_NAMES: Record<AccentColor, string> = {
  red: 'Rot',
  blue: 'Blau',
  violet: 'Violett',
  yellow: 'Gelb',
};

/** The viewer's own avatar (bottom right). Clicking it picks their colour for pins and drawings. */
export function ColorPicker() {
  const { author } = useViewerData().viewer;
  const updateMe = useUpdateMe();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useDismiss({
    open,
    onDismiss: () => setOpen(false),
    refs: [wrapperRef],
    returnFocusTo: triggerRef,
  });

  const pick = (color: AccentColor) => {
    if (color !== author.color) updateMe.mutate({ color });
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Deine Farbe wählen"
        aria-expanded={open}
        title="Deine Farbe"
        onClick={() => setOpen((value) => !value)}
        className="block rounded-full outline-offset-2 transition-transform hover:scale-105"
      >
        <Avatar author={author} size={32} />
      </button>

      {open && (
        <GlassPanel
          role="dialog"
          aria-labelledby={titleId}
          className="absolute right-0 bottom-full mb-2 flex animate-pop-in flex-col gap-2 p-3"
        >
          <span id={titleId} className="text-xs font-medium whitespace-nowrap text-fg">
            Deine Farbe
          </span>
          <div role="radiogroup" aria-labelledby={titleId} className="flex items-center gap-2">
            {ACCENT_COLORS.map((color) => {
              const selected = color === author.color;
              return (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={COLOR_NAMES[color]}
                  title={COLOR_NAMES[color]}
                  disabled={updateMe.isPending}
                  onClick={() => pick(color)}
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full outline-offset-2 transition-transform hover:scale-110 disabled:cursor-wait',
                    selected && 'ring-2 ring-white/90 ring-offset-2 ring-offset-glass-solid',
                  )}
                  style={{ backgroundColor: accentColor(color) }}
                >
                  {selected && (
                    <Icon
                      name="check"
                      size={14}
                      className={color === 'yellow' ? 'text-black' : 'text-white'}
                    />
                  )}
                </button>
              );
            })}
          </div>
          {updateMe.isError && (
            <p role="alert" className="text-[11px] text-danger">
              {updateMe.error.message}
            </p>
          )}
        </GlassPanel>
      )}
    </div>
  );
}
