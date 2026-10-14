import { ACCENT_COLORS, type AccentColor, type Author } from '@slider/shared';
import { useId, useRef, useState } from 'react';
import { ACCENT_COLOR_NAMES, accentColor } from '@/lib/accent';
import { useUpdateMe } from '@/lib/queries';
import { Avatar, cn, GlassPanel, Icon, useDismiss } from '@/ui';
import { setColorOverride, useColorOverrides } from '../lib/color-overrides';
import { useViewerData } from '../state/viewer-data';

const MAX_OTHERS = 5;

/**
 * Bottom right: who else is here, then you. Hovering an avatar shows the name; clicking it picks
 * a colour – your own for everyone, someone else's only for you (`color-overrides`). PowerPoint
 * authors keep their orange.
 */
export function ParticipantAvatars() {
  const { deck, viewer } = useViewerData();
  const others = deck.participants.filter((person) => person.id !== viewer.author.id);
  const visible = others.slice(0, MAX_OTHERS);
  const overflow = others.length - visible.length;

  return (
    <div role="group" aria-label="Teilnehmende" className="flex items-center gap-1.5">
      {visible.length > 0 && (
        <div className="flex items-center">
          {visible.map((person, index) => {
            const className = cn(index > 0 && '-ml-2 rounded-full ring-2 ring-canvas');
            // PowerPoint authors are always orange: nothing to pick.
            return person.type === 'external' ? (
              <Avatar key={person.id} author={person} size={32} className={className} />
            ) : (
              <AvatarColorPicker key={person.id} author={person} className={className} />
            );
          })}
          {overflow > 0 && (
            <span
              className="-ml-2 flex size-8 items-center justify-center rounded-full bg-[#2a2a2a] text-[10px] font-medium text-fg-muted ring-2 ring-canvas"
              title={others
                .slice(MAX_OTHERS)
                .map((person) => person.name)
                .join(', ')}
            >
              +{overflow}
            </span>
          )}
        </div>
      )}
      <AvatarColorPicker author={viewer.author} self />
    </div>
  );
}

interface AvatarColorPickerProps {
  author: Author;
  /** The viewer's own avatar: the colour is saved to their account. */
  self?: boolean;
  className?: string;
}

function AvatarColorPicker({ author, self = false, className }: AvatarColorPickerProps) {
  const updateMe = useUpdateMe();
  const overrides = useColorOverrides();
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

  const overridden = !self && author.id in overrides;
  const label = self ? `${author.name} (du)` : author.name;
  const heading = self ? 'Deine Farbe' : `Farbe für ${author.name}`;

  const pick = (color: AccentColor) => {
    if (color === author.color) return;
    if (self) updateMe.mutate({ color });
    else setColorOverride(author.id, color);
  };

  return (
    <div ref={wrapperRef} className={cn('group relative', open && 'z-10', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={self ? 'Deine Farbe wählen' : `Farbe für ${author.name} wählen`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="block rounded-full outline-offset-2 transition-transform hover:scale-105"
      >
        <Avatar author={author} size={32} nativeTitle={false} />
      </button>

      {!open && (
        <span
          role="tooltip"
          className="pointer-events-none absolute right-0 bottom-full mb-2 hidden rounded-badge bg-glass-solid px-2 py-1 text-xs whitespace-nowrap text-fg shadow-float group-hover:block group-has-focus-visible:block"
        >
          {label}
        </span>
      )}

      {open && (
        <GlassPanel
          role="dialog"
          aria-labelledby={titleId}
          className="absolute right-0 bottom-full mb-2 flex animate-pop-in flex-col gap-2 p-3"
        >
          <span id={titleId} className="text-xs font-medium whitespace-nowrap text-fg">
            {heading}
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
                  aria-label={ACCENT_COLOR_NAMES[color]}
                  title={ACCENT_COLOR_NAMES[color]}
                  disabled={self && updateMe.isPending}
                  onClick={() => pick(color)}
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full outline-offset-2 transition-transform hover:scale-110 disabled:cursor-wait disabled:hover:scale-100',
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
          {!self && (
            <p className="max-w-48 text-[11px] text-fg-muted">
              Nur für dich sichtbar.
              {overridden && (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={() => setColorOverride(author.id, null)}
                    className="text-fg underline underline-offset-2"
                  >
                    Zurücksetzen
                  </button>
                </>
              )}
            </p>
          )}
          {self && updateMe.isError && (
            <p role="alert" className="text-[11px] text-danger">
              {updateMe.error.message}
            </p>
          )}
        </GlassPanel>
      )}
    </div>
  );
}
