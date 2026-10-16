import { ACCENT_COLORS, type AccentColor, type Author } from '@slider/shared';
import { useId, useRef, useState } from 'react';
import { ACCENT_COLOR_NAMES, accentColor, isLightAccent } from '@/lib/accent';
import { useUpdateMe } from '@/lib/api';
import { Avatar, cn, GlassPanel, Icon, useDismiss } from '@/ui';
import { useColorOverrides } from '../hooks/useColorOverrides';
import { setColorOverride } from '../lib/color-overrides';
import { slideLabel } from '../comments/lib/labels';
import { useGoToSlide } from '../hooks/useGoToSlide';
import { useLivePeople } from '../live/lib/live-people';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

const MAX_OTHERS = 5;

/**
 * Bottom right: who else is here, then you. People in the deck right now come first, with a live
 * dot (BER-104). Hovering an avatar shows the name. Clicking it filters the comments: your own
 * avatar shows the threads that @mention you, someone else's the threads they wrote in; a second
 * click shows everyone again. Right-clicking picks a colour – your own for everyone, someone
 * else's only for you (`color-overrides`) – and jumps to a live person's slide. PowerPoint
 * authors keep their orange.
 */
export function ParticipantAvatars() {
  const { deck, viewer } = useViewerData();
  const live = useLivePeople();
  const liveSlide = new Map(live.map((person) => [person.author.id, person.activeSlideId]));
  const others = [
    // You are already the last avatar – your other windows don't add you twice.
    ...live.map((person) => person.author).filter((author) => author.id !== viewer.author.id),
    ...deck.participants.filter(
      (person) => person.id !== viewer.author.id && !liveSlide.has(person.id),
    ),
  ];
  // No "+1" chip: it would take the slot the one avatar needs, so that one is shown instead.
  const shown = others.length === MAX_OTHERS + 1 ? others.length : MAX_OTHERS;
  const visible = others.slice(0, shown);
  const overflow = others.length - visible.length;

  return (
    <div role="group" aria-label="Teilnehmende" className="flex items-center gap-1.5">
      {visible.length > 0 && (
        <div className="flex items-center">
          {visible.map((person, index) => {
            const className = cn(index > 0 && '-ml-2 rounded-full ring-2 ring-canvas');
            return (
              <AvatarColorPicker
                key={person.id}
                author={person}
                live={liveSlide.has(person.id)}
                liveSlideId={liveSlide.get(person.id) ?? null}
                className={className}
              />
            );
          })}
          {overflow > 0 && (
            <span
              className="-ml-2 flex size-8 items-center justify-center rounded-full bg-[#2a2a2a] text-[10px] font-medium text-fg-muted ring-2 ring-canvas"
              title={others
                .slice(shown)
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
  /** In the deck right now: a live dot, and a jump to their slide. */
  live?: boolean;
  liveSlideId?: string | null;
  className?: string;
}

function AvatarColorPicker({
  author,
  self = false,
  live = false,
  liveSlideId = null,
  className,
}: AvatarColorPickerProps) {
  const { slideIndex } = useViewerData();
  const { personFilter } = useViewerState();
  const dispatch = useViewerDispatch();
  const filtered = personFilter === author.id;
  // PowerPoint authors are always orange: nothing to pick.
  const fixedColor = author.type === 'external';
  const goToSlide = useGoToSlide();
  const liveIndex = liveSlideId === null ? undefined : slideIndex.get(liveSlideId);
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
  const name = self ? `${author.name} (du)` : author.name;
  // Only while the filter is on: what is showing now, not what a click would do.
  const filterState = self
    ? 'Nur Kommentare, in denen du erwähnt wirst'
    : 'Nur Kommentare dieser Person';
  const heading = fixedColor ? author.name : self ? 'Deine Farbe' : `Farbe für ${author.name}`;

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
        aria-label={
          self
            ? 'Kommentare zeigen, in denen du erwähnt wirst'
            : `Nur Kommentare von ${author.name}`
        }
        aria-pressed={filtered}
        onClick={() => dispatch({ type: 'personFilterToggled', authorId: author.id })}
        onContextMenu={(event) => {
          if (fixedColor && liveIndex === undefined) return;
          event.preventDefault();
          setOpen((value) => !value);
        }}
        className={cn(
          // `flex`, not `block`: the inline avatar would sit on a text baseline and stretch the
          // filter ring below it.
          'relative flex rounded-full outline-offset-2 transition-transform hover:scale-105',
          filtered && 'z-10 ring-2 ring-white/90 ring-offset-2 ring-offset-canvas',
        )}
      >
        <Avatar author={author} size={32} nativeTitle={false} />
        {live && (
          <span
            aria-label="gerade da"
            className="absolute right-0 bottom-0 size-2.5 rounded-full bg-success ring-2 ring-canvas"
          />
        )}
      </button>

      {!open && (
        <span
          role="tooltip"
          className="pointer-events-none absolute right-0 bottom-full mb-2 hidden flex-col rounded-badge bg-glass-solid px-2 py-1 text-xs whitespace-nowrap text-fg shadow-float group-hover:flex group-has-focus-visible:flex"
        >
          <span>{name}</span>
          {filtered && <span className="text-fg-muted">{filterState}</span>}
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
          {!fixedColor && (
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
                        className={isLightAccent(color) ? 'text-black' : 'text-white'}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {liveIndex !== undefined && (
            <button
              type="button"
              onClick={() => {
                goToSlide(liveIndex);
                setOpen(false);
              }}
              className="flex items-center gap-1.5 rounded-badge bg-white/8 px-2 py-1.5 text-left text-xs text-fg transition-colors hover:bg-white/14"
            >
              <Icon name="arrowForward" size={14} />
              Zu {slideLabel(liveIndex)} springen
            </button>
          )}
          {!self && !fixedColor && (
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
