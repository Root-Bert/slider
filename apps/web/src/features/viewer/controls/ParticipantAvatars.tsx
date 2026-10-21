import type { AccentColor, Author } from '@slider/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { useUpdateMe } from '@/lib/api';
import {
  Avatar,
  AvatarOverflow,
  Button,
  cn,
  ColorSwatches,
  ErrorText,
  PopoverPanel,
  TextLink,
  Tooltip,
  usePopover,
} from '@/ui';
import { useColorOverrides } from '../hooks/useColorOverrides';
import { setColorOverride } from '../lib/color-overrides';
import { slideLabel } from '../comments/lib/labels';
import { useGoToSlide } from '../hooks/useGoToSlide';
import { useLivePeople } from '../live/lib/live-people';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

const MAX_OTHERS = 5;
/** Press length (ms) that opens the picker on touch – iOS Safari fires no `contextmenu`. */
const LONG_PRESS_MS = 500;
/** Finger travel (px) that turns a long press into a scroll. */
const LONG_PRESS_SLOP = 10;

/**
 * Bottom right: who else is here, then you. People in the deck right now come first, with a live
 * dot (BER-104). Hovering an avatar shows the name. Clicking it filters the comments: your own
 * avatar shows the threads that @mention you, someone else's the threads they wrote in; a second
 * click shows everyone again. Right-clicking (or Shift+F10 / the menu key, or a long press on
 * touch) picks a colour – your own for everyone, someone else's only for you (`color-overrides`) –
 * and jumps to a live person's slide. PowerPoint authors keep their orange.
 */
export function ParticipantAvatars() {
  const { deck, viewer } = useViewerData();
  const { personFilter } = useViewerState();
  const live = useLivePeople();
  const liveSlide = new Map(live.map((person) => [person.author.id, person.activeSlideId]));
  const present = [
    // You are already the last avatar – your other windows don't add you twice.
    ...live.map((person) => person.author).filter((author) => author.id !== viewer.author.id),
    ...deck.participants.filter(
      (person) => person.id !== viewer.author.id && !liveSlide.has(person.id),
    ),
  ];
  // The avatar is the filter's only switch: while it is on, the person stays – also after they
  // left the deck (a live viewer who never commented) – so a click can turn it off again.
  const filteredPerson = useFilteredPerson(personFilter, present);
  const others =
    filteredPerson && !present.some((person) => person.id === filteredPerson.id)
      ? [...present, filteredPerson]
      : present;
  // No "+1" chip: it would take the slot the one avatar needs, so that one is shown instead.
  const shown = others.length === MAX_OTHERS + 1 ? others.length : MAX_OTHERS;
  const filteredAt = others.findIndex((person) => person.id === personFilter);
  // …and never hides in the "+n" chip, which can't be clicked: it takes the last slot.
  const listed =
    filteredAt >= shown
      ? [
          ...others.slice(0, shown - 1),
          others[filteredAt]!,
          ...others.slice(shown - 1).filter((_, index) => index !== filteredAt - shown + 1),
        ]
      : others;
  const visible = listed.slice(0, shown);
  const overflow = listed.length - visible.length;

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
            <AvatarOverflow
              count={overflow}
              size={32}
              title={listed
                .slice(shown)
                .map((person) => person.name)
                .join(', ')}
              className="-ml-2"
            />
          )}
        </div>
      )}
      <AvatarColorPicker author={viewer.author} self />
    </div>
  );
}

/** The person the comments are filtered by, as last seen among the avatars (`null`: none). */
function useFilteredPerson(personFilter: string | null, present: readonly Author[]): Author | null {
  const current = present.find((person) => person.id === personFilter) ?? null;
  const [remembered, setRemembered] = useState<Author | null>(current);
  // Adjusted while rendering (no effect): the avatar must not blink out for a frame.
  // Compared by value: the live list hands out new objects.
  if (
    current &&
    (current.id !== remembered?.id ||
      current.name !== remembered.name ||
      current.color !== remembered.color)
  )
    setRemembered(current);
  if (personFilter === null) return null;
  return current ?? (remembered?.id === personFilter ? remembered : null);
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
  // PowerPoint authors are always orange, deleted accounts grey: nothing to pick.
  const fixedColor = author.type !== 'owner';
  const goToSlide = useGoToSlide();
  const liveIndex = liveSlideId === null ? undefined : slideIndex.get(liveSlideId);
  const updateMe = useUpdateMe();
  const overrides = useColorOverrides();
  // Opened by a right click, Shift+F10 / the menu key or a long press; a plain click filters, so
  // the trigger takes no `triggerProps`.
  const { open, setOpen, close, wrapperRef, triggerRef, panelRef } = usePopover();
  const titleId = useId();
  const hasPicker = !fixedColor || liveIndex !== undefined;
  // Opened from the keyboard: the focus moves into the picker.
  const focusPicker = useRef(false);
  // A touch press: its timer, where it started, and whether it already opened the picker (then
  // neither the click that follows filters nor Android's own `contextmenu` toggles it shut).
  const press = useRef<{ timer: number; x: number; y: number; opened: boolean } | null>(null);
  const endPress = () => {
    if (press.current) clearTimeout(press.current.timer);
  };
  useEffect(() => endPress, []);

  useEffect(() => {
    if (!open || !focusPicker.current) return;
    focusPicker.current = false;
    const panel = panelRef.current;
    // The current colour, else the first control (a PowerPoint author's jump).
    (
      panel?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      panel?.querySelector<HTMLElement>('button:not(:disabled)')
    )?.focus();
  }, [open, panelRef]);

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
    <div ref={wrapperRef} className={cn('relative', open && 'z-(--z-raised)', className)}>
      <Tooltip
        display="flex"
        align="end"
        maxWidth="none"
        disabled={open}
        label={
          <>
            <span>{name}</span>
            {filtered && <span className="text-fg-muted">{filterState}</span>}
          </>
        }
      >
        <button
          ref={triggerRef}
          type="button"
          aria-label={
            self
              ? 'Kommentare zeigen, in denen du erwähnt wirst'
              : `Nur Kommentare von ${author.name}`
          }
          aria-pressed={filtered}
          aria-keyshortcuts={hasPicker ? 'Shift+F10' : undefined}
          onClick={() => {
            // The click that ends a long press: the picker is open, no filter.
            if (press.current?.opened) {
              press.current = null;
              return;
            }
            dispatch({ type: 'personFilterToggled', authorId: author.id });
          }}
          onContextMenu={(event) => {
            if (!hasPicker) return;
            event.preventDefault();
            // Android's long press: our timer may have opened it already – keep it open.
            if (press.current) setOpen(true);
            else setOpen((value) => !value);
          }}
          onKeyDown={(event) => {
            // macOS has no menu key and fires no `contextmenu` for Shift+F10: handle both here
            // (prevented, so Windows doesn't send its own `contextmenu` on top).
            if (!hasPicker) return;
            if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
            event.preventDefault();
            focusPicker.current = true;
            setOpen(true);
          }}
          onPointerDown={(event) => {
            endPress();
            press.current = null;
            if (!hasPicker || event.pointerType === 'mouse') return;
            const current = {
              x: event.clientX,
              y: event.clientY,
              opened: false,
              timer: window.setTimeout(() => {
                current.opened = true;
                setOpen(true);
              }, LONG_PRESS_MS),
            };
            press.current = current;
          }}
          onPointerMove={(event) => {
            const current = press.current;
            if (!current || current.opened) return;
            if (
              Math.hypot(event.clientX - current.x, event.clientY - current.y) > LONG_PRESS_SLOP
            ) {
              endPress();
              press.current = null;
            }
          }}
          onPointerUp={() => {
            endPress();
            // A short tap: the click filters as usual.
            if (press.current && !press.current.opened) press.current = null;
          }}
          onPointerCancel={() => {
            endPress();
            press.current = null;
          }}
          className={cn(
            // `flex`, not `block`: the inline avatar would sit on a text baseline and stretch the
            // filter ring below it. No text selection or iOS callout on a long press.
            'relative flex rounded-full outline-offset-2 transition-transform select-none [-webkit-touch-callout:none] hover:scale-105',
            filtered && 'z-(--z-raised) ring-2 ring-fg ring-offset-2 ring-offset-canvas',
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
      </Tooltip>

      {open && (
        <PopoverPanel
          ref={panelRef}
          role="dialog"
          aria-labelledby={titleId}
          side="top"
          align="end"
          tone="default"
          padding="lg"
          className="gap-2"
        >
          <span id={titleId} className="text-xs font-medium whitespace-nowrap text-fg">
            {heading}
          </span>
          {!fixedColor && (
            <ColorSwatches
              // Only PowerPoint authors and deleted accounts have these, and they get no swatches.
              value={
                author.color === 'powerpoint' || author.color === 'deleted' ? null : author.color
              }
              onChange={pick}
              labelledBy={titleId}
              disabled={self && updateMe.isPending}
              className="gap-2"
            />
          )}
          {liveIndex !== undefined && (
            <Button
              variant="soft"
              size="xs"
              weight="normal"
              icon="arrowForward"
              onClick={() => {
                goToSlide(liveIndex);
                close();
              }}
              className="self-start"
            >
              Zu {slideLabel(liveIndex)} springen
            </Button>
          )}
          {!self && !fixedColor && (
            <p className="max-w-48 text-caption text-fg-muted">
              Nur für dich sichtbar.
              {overridden && (
                <>
                  {' '}
                  <TextLink variant="inline" onClick={() => setColorOverride(author.id, null)}>
                    Zurücksetzen
                  </TextLink>
                </>
              )}
            </p>
          )}
          {self && updateMe.isError && (
            <ErrorText role="alert" size="xs">
              {updateMe.error.message}
            </ErrorText>
          )}
        </PopoverPanel>
      )}
    </div>
  );
}
